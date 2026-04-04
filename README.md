diff --git a/README.md b/README.md
index 2524ffd6a34095c97bc34ccd21802282e8541b72..35d59b243f68756b58ca5d0e508d9ac01b4b8a35 100644
--- a/README.md
+++ b/README.md
@@ -1,16 +1,90 @@
 # kupe-crm
 
-## Nota sobre deploy y actualización de datos
+Dashboard estático en GitHub Pages con **fallback embebido** y carga opcional del snapshot más reciente desde Supabase.
 
-Este dashboard actualmente **no consulta Supabase en tiempo real**.
+## Estado actual (sin repetir pasos ya hechos)
 
-Los datos de gráficos/clientes (`MON`, `SEGS`, `CLIENTES`, `PRODS`, etc.) están embebidos directamente en `index.html`, por lo que:
+- El frontend **sí intenta leer Supabase** (`dashboard_snapshot`) al cargar.
+- Si no hay snapshot válido, usa el dataset embebido en `index.html`.
+- La configuración de Pages y el script SQL son **idempotentes**: se corren una vez y luego solo se refresca snapshot.
 
-1. Actualizar tablas en Supabase **no cambia** el dashboard por sí solo.
-2. Para ver cambios en producción, hay que:
-   - regenerar el dataset,
-   - commitear cambios en `index.html`,
-   - hacer push,
-   - esperar el deploy de GitHub Pages.
+## Operación diaria (lo único que hay que hacer)
 
-Si se quiere sincronización automática con Supabase, hay que agregar fetch/API en el frontend y mover estos arrays a una fuente externa (JSON/endpoint).
+1. Cargar CSV crudo del ERP en:
+   - `public.stg_entregas_raw`
+   - `public.stg_articulos_vendidos_raw`
+   - `public.clientes` (si hubo cambios)
+2. Ejecutar:
+
+```sql
+select public.refresh_dashboard_snapshot_from_crudo();
+```
+
+3. Verificar último snapshot:
+
+```sql
+select id, updated_at,
+  jsonb_array_length(coalesce(payload->'SEGS','[]'::jsonb)) as segs_len,
+  jsonb_array_length(coalesce(payload->'CLIENTES','[]'::jsonb)) as clientes_len,
+  jsonb_array_length(coalesce(payload->'PRODS','[]'::jsonb)) as prods_len,
+  jsonb_array_length(coalesce(payload->'MAR_PRODS','[]'::jsonb)) as mar_prods_len,
+  jsonb_array_length(coalesce(payload->'MAR_PEDS','[]'::jsonb)) as mar_peds_len,
+  jsonb_array_length(coalesce(payload->'MAR_DIAS','[]'::jsonb)) as mar_dias_len
+from public.dashboard_snapshot
+order by updated_at desc
+limit 1;
+```
+
+---
+
+## Setup inicial (solo 1 vez por proyecto)
+
+> Si esto ya está hecho en tu entorno, **saltealo**.
+
+1. Ejecutar `sql/refresh_dashboard_snapshot_from_crudo.sql` en Supabase SQL Editor.
+   - Crea/actualiza objetos necesarios (`dashboard_snapshot`, policy de lectura, funciones de parseo y `refresh_dashboard_snapshot_from_crudo`).
+   - Mantiene compatibilidad con crudo heterogéneo y staging raw.
+
+2. (Opcional) Programar refresh automático con `pg_cron`:
+
+```sql
+create extension if not exists pg_cron;
+
+select cron.unschedule(jobid)
+from cron.job
+where jobname = 'refresh_dashboard_snapshot_daily';
+
+select cron.schedule(
+  'refresh_dashboard_snapshot_daily',
+  '10 10 * * *',
+  $$select public.refresh_dashboard_snapshot_from_crudo();$$
+);
+```
+
+## Deploy GitHub Pages (solo si cambiás frontend)
+
+- Source: `Deploy from a branch`
+- Branch: rama de producción
+- Folder: `/ (root)`
+
+Para cambios visuales o de lógica del dashboard (`index.html`), sí hace falta commit/push.
+Para refresh diario de datos vía Supabase, **no** hace falta tocar `index.html`.
+
+## Overrides locales (solo debugging)
+
+El proyecto ya trae URL y anon key por defecto.
+Si querés forzar credenciales en tu navegador:
+
+```js
+localStorage.setItem('KUPE_SUPABASE_URL','https://TU-PROYECTO.supabase.co');
+localStorage.setItem('KUPE_SUPABASE_ANON_KEY','TU_ANON_PUBLIC_KEY');
+location.reload();
+```
+
+Limpiar overrides:
+
+```js
+localStorage.removeItem('KUPE_SUPABASE_URL');
+localStorage.removeItem('KUPE_SUPABASE_ANON_KEY');
+location.reload();
+```
