# Changelog — kupe-burgers CRM

## 2026-04-16 15:30 — Fix Dashboard Snapshot
- **Cambio**: Modificar RPC refresh_dashboard_snapshot_from_crudo()
- **Qué se arregló**: SEGS y MOV_SEGS ahora aparecen en el dashboard
- **Archivos**: sql/migrations/002_fix_dashboard_snapshot.sql
- **Reversible**: sí → sql/rollback/002_rollback.sql
- **Riesgo**: bajo

## 2026-04-16 15:20 — Create Staging Tables
- **Cambio**: Crear stg_articulos_ventas_raw y RPC upsert_articulos_ventas
- **Qué se arregló**: Script unificado puede procesar artículos
- **Archivos**: sql/migrations/003_crear_staging_tables.sql
- **Reversible**: sí
- **Riesgo**: bajo