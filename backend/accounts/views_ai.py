from __future__ import annotations

import os
from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional

from django.conf import settings
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from openai import OpenAI

from .models import Company, UserProfile, CompanyFinancial
from .permissions import IsEmployer

try:
    from equity.models import EquityGrant
except Exception:
    EquityGrant = None


# -----------------------------
# Helpers
# -----------------------------

def _dec(x: Any) -> float:
    if x is None:
        return 0.0
    try:
        return float(x)
    except Exception:
        try:
            return float(Decimal(str(x)))
        except Exception:
            return 0.0


def _name_for(profile: UserProfile) -> str:
    u = profile.user
    return (u.first_name or u.username or "").strip() or f"Employee {profile.pk}"


def _vesting_units(g) -> int:
    vesting_start = getattr(g, "vesting_start", None)
    vesting_end = getattr(g, "vesting_end", None)
    if not vesting_start or not vesting_end:
        return 0
    delta_days = (vesting_end - vesting_start).days
    freq = (getattr(g, "vesting_frequency", "") or "").lower()
    if freq == "daily":
        return max(delta_days, 0)
    if freq == "weekly":
        return max(delta_days // 7, 0)
    if freq == "biweekly":
        return max(delta_days // 14, 0)
    if freq == "yearly":
        years = max(((vesting_end.year - vesting_start.year) or 0), 0)
        return years
    months = (vesting_end.year - vesting_start.year) * 12 + (vesting_end.month - vesting_start.month)
    return max(months, 0)


def _latest_financial(company: Company) -> Dict[str, Any]:
    f = company.financials.order_by("-year").first()
    return {
        "year": f.year if f else None,
        "revenue": _dec(getattr(f, "revenue", None)) if f else None,
        "net_income": _dec(getattr(f, "net_income", None)) if f else None,
    }


def pack_financials(company: Company) -> List[Dict[str, Any]]:
    """
    Serialize *all* CompanyFinancial rows for the company (ascending by year).
    """
    rows = company.financials.order_by("year").all()
    return [
        {
            "year": r.year,
            "revenue": _dec(r.revenue),
            "net_income": _dec(r.net_income),
        }
        for r in rows
    ]


def pack_company(c: Company) -> Dict[str, Any]:
    """
    Snapshot of company valuation inputs + full financial history.
    """
    return {
        "name": c.name,
        "total_authorized_shares": int(getattr(c, "total_authorized_shares", 0) or 0),
        "current_fmv": _dec(getattr(c, "current_share_price", None)),
        "current_market_value": _dec(getattr(c, "current_market_value", None)),
        "volatility": _dec(getattr(c, "volatility", None)),
        "risk_free_rate": _dec(getattr(c, "risk_free_rate", None)),
        "latest_financials": _latest_financial(c),
        "financials": pack_financials(c),  # <-- full history
    }


def pack_409a_like(c: Company) -> List[Dict[str, Any]]:
    return [{
        "as_of": date.today().isoformat(),
        "method": "company.current_share_price",
        "fmv_common": _dec(getattr(c, "current_share_price", None)),
        "volatility": _dec(getattr(c, "volatility", None)),
        "risk_free_rate": _dec(getattr(c, "risk_free_rate", None)),
        "notes": "Derived from Company fields; no standalone 409A table in schema.",
    }]


def pack_grant(g, company_fmv: float) -> Dict[str, Any]:
    try:
        profile = g.user
        employee_id = getattr(profile, "unique_id", None)
        employee_name = _name_for(profile)
    except Exception:
        employee_id = None
        employee_name = None

    units = _vesting_units(g)
    shares_total = int(getattr(g, "num_shares", 0) or 0)
    shares_per_period = (shares_total // units) if units > 0 else 0

    vested = 0
    try:
        if hasattr(g, "vested_shares"):
            vested = int(g.vested_shares(on_date=timezone.now().date()))
    except Exception:
        pass
    unvested = shares_total - vested

    iso_sh = int(getattr(g, "iso_shares", 0) or 0)
    nqo_sh = int(getattr(g, "nqo_shares", 0) or 0)
    rsu_sh = int(getattr(g, "rsu_shares", 0) or 0)
    common_sh = int(getattr(g, "common_shares", 0) or 0)
    pref_sh = int(getattr(g, "preferred_shares", 0) or 0)

    strike = _dec(getattr(g, "strike_price", None))
    purchase = _dec(getattr(g, "purchase_price", None))

    per_period_value = shares_per_period * (
        strike if (iso_sh or nqo_sh) else
        company_fmv if rsu_sh else
        purchase
    )

    stock_class_name = None
    try:
        stock_class = getattr(g, "stock_class", None)
        stock_class_name = getattr(stock_class, "name", None)
    except Exception:
        pass

    grant_date = getattr(g, "grant_date", None) or date.today()

    return {
        "grant_id": g.pk,
        "employee_id": employee_id,
        "employee_name": employee_name,
        "stock_class": stock_class_name,
        "num_shares": shares_total,
        "iso_shares": iso_sh,
        "nqo_shares": nqo_sh,
        "rsu_shares": rsu_sh,
        "common_shares": common_sh,
        "preferred_shares": pref_sh,
        "strike_price": strike,
        "purchase_price": purchase,
        "grant_date": grant_date.isoformat(),
        "vesting_start": getattr(g, "vesting_start", None).isoformat() if getattr(g, "vesting_start", None) else None,
        "vesting_end": getattr(g, "vesting_end", None).isoformat() if getattr(g, "vesting_end", None) else None,
        "vesting_frequency": getattr(g, "vesting_frequency", None),
        "cliff_months": int(getattr(g, "cliff_months", 0) or 0),
        "shares_per_period": shares_per_period,
        "vested_shares": vested,
        "unvested_shares": unvested,
        "fmv": company_fmv,
        "per_period_value": per_period_value,
    }


def pack_company_grants(company: Company, employee_unique_id: Optional[str]) -> List[Dict[str, Any]]:
    if EquityGrant is None:
        return []

    qs = EquityGrant.objects.filter(user__company=company).select_related("user", "stock_class")
    if employee_unique_id:
        qs = qs.filter(user__unique_id=employee_unique_id)

    fmv = _dec(getattr(company, "current_share_price", None))
    return [pack_grant(g, fmv) for g in qs]


# -----------------------------
#  System prompt
# -----------------------------

SYSTEM_PROMPT = (
    "You are StockComp Assistant for an internal stock-based compensation tool. "
    "Answer ONLY from the JSON context provided ('company', 'market', 'valuations', 'financials', 'grants'). "
    "Audience is employer/admin; do not expose PII. Always include: "
    "'This is general product guidance, not financial or tax advice.' "
    "Discuss 409A ONLY if asked. When asked, do a conservative, transparent illustration:\n"
    "1) List available inputs; ask for missing ones. Prefer: company.current_market_value, "
    "company.current_fmv, total_authorized_shares, market.yearly_revenue, market.volatility, market.risk_free_rate.\n"
    "2) Choose method by data: Market (Revenue × multiple → EV), Income (DCF) if inputs exist, "
    "Asset if appropriate, or Hybrid/OPM if capital stack & vols are available. Do NOT invent numbers.\n"
    "3) Equity = EV − debt + cash (if provided). Allocate preferences if capital stack exists; otherwise explain limits. "
    "FMV(common) = residual common equity / fully diluted shares. If insufficient data, stop and ask.\n"
    "Strike planning (only if asked): baseline = latest FMV (prefer current_fmv, else prior valuation, else illustrated FMV); "
    "buffer = 2%–10% based on volatility/time since last valuation; recommended_strike = round_up(baseline*(1+buffer)). "
    "Vested value: ISO/NSO = vested_shares*max(current_fmv − strike,0); RSU = vested_shares*current_fmv; "
    "Common/Preferred at cost = vested_shares*purchase_price when the user requests cost basis.\n"
    "Cite which sources/blocks you used. If uncertain, state the exact additional data needed."
)


# -----------------------------
#  Employer-only AI endpoint
# -----------------------------

class EmployerChatView(APIView):
    """
    POST /accounts/ai/employer-query/
    Body: { "query": "...", "employee_id": "<optional unique_id>" }
    Requires IsAuthenticated + IsEmployer.
    """
    permission_classes = [IsAuthenticated, IsEmployer]

    def post(self, request):
        query_text = (request.data.get("query") or "").strip()
        if not query_text:
            return Response({"detail": "query is required"}, status=status.HTTP_400_BAD_REQUEST)

        # employer scope
        user = request.user
        company = user.profile.company
        employee_id = request.data.get("employee_id") or request.data.get("unique_id")

        # Build structured context
        company_block = pack_company(company)
        valuations_block = pack_409a_like(company)

        # Financials (entire history) & small trimmed block for the LLM
        financials_block_all = company_block.get("financials", [])
        FINANCIALS_MAX = 20  # keep token usage reasonable; still gives long history
        financials_block_trim = financials_block_all[-FINANCIALS_MAX:]

        latest_fin = company_block.get("latest_financials") or {}
        market_block = {
            "enterprise_value": company_block.get("current_market_value"),
            "yearly_revenue": latest_fin.get("revenue"),
            "volatility": company_block.get("volatility"),
            "risk_free_rate": company_block.get("risk_free_rate"),
        }

        grants_block = pack_company_grants(company, employee_id)

        # Compose prompt
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content":
                "User question:\n"
                f"{query_text}\n\n"
                "Context JSON (use to ground your answer):\n"
                f"company: {company_block}\n"
                f"market: {market_block}\n"
                f"valuations: {valuations_block}\n"
                f"financials: {financials_block_trim}\n"
                f"grants: {grants_block[:50]}\n"
            }
        ]

        # Call OpenAI (fail soft if key missing/misconfigured)
        answer = (
            "AI is not available right now. Please check the OpenAI configuration. "
            "Here is the data I would use to answer:\n"
            f"company={company_block}\nmarket={market_block}\n"
            f"valuations={valuations_block}\nfinancials={financials_block_trim}\n"
        )
        try:
            api_key = getattr(settings, "OPENAI_API_KEY", None) or os.getenv("OPENAI_API_KEY")
            model = getattr(settings, "OPENAI_MODEL", None) or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
            if api_key:
                client = OpenAI(api_key=api_key)
                resp = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=0.2,
                    max_tokens=700,
                )
                answer = resp.choices[0].message.content
        except Exception as e:
            answer = f"(AI unavailable: {e})"

        return Response(
            {
                "answer": answer,
                "sources": [
                    "db:company",
                    "db:company_financials_all",
                    "db:equity_grants" if grants_block else "db:equity_grants:none",
                ],
                "debug": {
                    "company": company_block,
                    "market": market_block,
                    "valuations": valuations_block,
                    "financials_count": len(financials_block_all),
                    "financials_preview": financials_block_trim[:5],
                    "grants_count": len(grants_block),
                    "grants_preview": grants_block[:5],
                },
            },
            status=status.HTTP_200_OK,
        )