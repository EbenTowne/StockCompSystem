import React, { useEffect, useRef, useState } from "react";

type Msg = { id: string; role: "user" | "assistant" | "system"; content: string };

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "";
const CHAT_URL = `${API_BASE}/ai/employer-query/`;

function getToken(): string | null {
  return (
    localStorage.getItem("access") ||
    localStorage.getItem("accessToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("jwt")
  );
}

async function callChatEndpoint(message: string, history: Msg[]): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({
      message,
      history: history.map(({ role, content }) => ({ role, content })),
    }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json().catch(() => ({} as any));
  const reply =
    data.reply ??
    data.answer ??
    data.message ??
    (Array.isArray(data.choices) && data.choices[0]?.message?.content) ??
    "";
  return typeof reply === "string" && reply ? reply : JSON.stringify(data);
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: "hello",
      role: "assistant",
      content:
        "Hi! I’m your equity assistant. Ask me about grants, vesting, 409A, expenses, employees, etc.",
    },
  ]);

  // --- robust wiring: event + global function
  useEffect(() => {
    const toggle = () => setOpen((v) => !v);
    const openFn = () => setOpen(true);
    const closeFn = () => setOpen(false);

    window.addEventListener("chat:toggle", toggle);
    window.addEventListener("chat:open", openFn);
    window.addEventListener("chat:close", closeFn);

    (window as any).chatWidget = {
      toggle,
      open: openFn,
      close: closeFn,
    };

    return () => {
      window.removeEventListener("chat:toggle", toggle);
      window.removeEventListener("chat:open", openFn);
      window.removeEventListener("chat:close", closeFn);
      delete (window as any).chatWidget;
    };
  }, []);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setBusy(true);
    try {
      const reply = await callChatEndpoint(text, [...messages, userMsg]);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: reply }]);
    } catch (err: any) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `⚠️ ${err?.message || "Failed to reach AI service"}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    setMessages((m) => m.slice(0, 1));
  }

  // NOTE: bottom-right so it’s definitely visible; once verified you can move it next to the rail.
  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-50 rounded-full shadow-lg px-4 py-3 bg-indigo-600 text-white hover:bg-indigo-700"
        aria-label={open ? "Close chat" : "Open chat"}
      >
        {open ? "Close" : "Chat"}
      </button>

      {open && (
        <div className="fixed bottom-24 right-4 z-50 w-96 max-w-[95vw] rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <div className="font-semibold">AI Assistant</div>
            <div className="flex gap-2">
              <button onClick={clearChat} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">
                Clear
              </button>
              <button onClick={() => setOpen(false)} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">
                ✕
              </button>
            </div>
          </div>

          <div ref={listRef} className="h-80 overflow-y-auto px-3 py-2 space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  "whitespace-pre-wrap break-words rounded-lg px-3 py-2 " +
                  (m.role === "user"
                    ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-900 dark:text-indigo-100 ml-10"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 mr-10")
                }
              >
                {m.content}
              </div>
            ))}
            {busy && (
              <div className="mr-10 rounded-lg px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                Thinking…
              </div>
            )}
          </div>

          <form onSubmit={send} className="border-t border-gray-200 dark:border-gray-700 p-2 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message…"
              className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="px-3 py-2 rounded-md bg-indigo-600 text-white disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
