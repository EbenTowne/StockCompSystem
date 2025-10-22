import django.db.models.deletion
from django.db import migrations, models
from django.utils.timezone import now


def backfill_stockclass_series(apps, schema_editor):
    """
    For any StockClass that has a NULL series, create (or reuse) an
    'Unassigned (Temporary)' Series for that StockClass's company and assign it.
    """
    Series = apps.get_model('equity', 'Series')
    StockClass = apps.get_model('equity', 'StockClass')

    # Find all stock classes with NULL series
    missing = StockClass.objects.filter(series__isnull=True)
    if not missing.exists():
        return

    # Cache the temporary series per company to avoid repeated queries
    unassigned_by_company = {}

    for sc in missing.select_related('company'):
        company = sc.company
        company_id = getattr(company, 'id', None)
        if not company_id:
            continue
        if company_id not in unassigned_by_company:
            unassigned, _ = Series.objects.get_or_create(
                company=company,
                name="Unassigned (Temporary)",
                defaults={"share_type": "COMMON"},
            )
            unassigned_by_company[company_id] = unassigned
        sc.series = unassigned_by_company[company_id]
        sc.save(update_fields=['series'])


class Migration(migrations.Migration):

    # IMPORTANT: make this migration non-atomic so Postgres can commit
    # between operations and avoid "pending trigger events".
    atomic = False

    dependencies = [
        ('equity', '0003_alter_series_options_alter_stockclass_options_and_more'),
    ]

    operations = [
        # --- Do ALL Series schema changes first (before touching data) ---
        migrations.AlterModelOptions(
            name='series',
            options={'ordering': ['company_id', 'name']},
        ),
        migrations.AlterField(
            model_name='series',
            name='name',
            field=models.CharField(max_length=128),
        ),
        migrations.AlterField(
            model_name='series',
            name='share_type',
            field=models.CharField(
                choices=[('COMMON', 'Common Stock'), ('PREFERRED', 'Preferred Stock')],
                default='COMMON',
                max_length=16,
            ),
        ),

        # --- StockClass options & columns that don't touch Series yet ---
        migrations.AlterModelOptions(
            name='stockclass',
            options={'ordering': ['company_id', 'name']},
        ),
        migrations.AddField(
            model_name='stockclass',
            name='created_at',
            # Use callable default to backfill existing rows; no DB default afterward.
            field=models.DateTimeField(default=now, auto_now_add=False),
            preserve_default=False,
        ),

        # --- Backfill StockClass.series safely BEFORE making FK hard non-null ---
        migrations.RunPython(backfill_stockclass_series, migrations.RunPython.noop),

        # --- Now it's safe to enforce FK and other StockClass schema tweaks ---
        migrations.AlterField(
            model_name='stockclass',
            name='name',
            field=models.CharField(max_length=128),
        ),
        migrations.AlterField(
            model_name='stockclass',
            name='total_class_shares',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AlterField(
            model_name='stockclass',
            name='series',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='stock_classes',
                to='equity.series',
            ),
        ),
    ]