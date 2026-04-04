 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/README.md b/README.md
index 2524ffd6a34095c97bc34ccd21802282e8541b72..a68c25939a3c5b562c7ce9b221ea903cc925fdac 100644
--- a/README.md
+++ b/README.md
@@ -1,16 +1,177 @@
 # kupe-crm
 
 ## Nota sobre deploy y actualización de datos
 
 Este dashboard actualmente **no consulta Supabase en tiempo real**.
 
 Los datos de gráficos/clientes (`MON`, `SEGS`, `CLIENTES`, `PRODS`, etc.) están embebidos directamente en `index.html`, por lo que:
 
 1. Actualizar tablas en Supabase **no cambia** el dashboard por sí solo.
 2. Para ver cambios en producción, hay que:
    - regenerar el dataset,
    - commitear cambios en `index.html`,
    - hacer push,
    - esperar el deploy de GitHub Pages.
 
 Si se quiere sincronización automática con Supabase, hay que agregar fetch/API en el frontend y mover estos arrays a una fuente externa (JSON/endpoint).
+
+## Deploy directo en GitHub (sin Actions)
+
+Este repo quedó preparado para deploy **directo desde GitHub Pages** (sin workflow de Actions).
+
+### Configuración en GitHub
+
+1. Ir a **Settings → Pages**.
+2. En **Source**, elegir **Deploy from a branch**.
+3. Seleccionar:
+   - **Branch:** `main` (o la rama que uses para producción)
+   - **Folder:** `/ (root)`
+4. Guardar.
+
+### Operativa
+
+- Cada push a la rama configurada actualiza el sitio.
+- Si cambiás datos, el cambio debe quedar en `index.html` y commiteado.
+- Si no ves cambios al instante, esperar 1–3 minutos y refrescar con **Ctrl/Cmd + Shift + R**.
+
+## Camino B (recomendado): actualización diaria automática con Supabase
+
+El frontend ahora intenta leer un snapshot desde Supabase **antes** de renderizar.
+Si no encuentra configuración, usa el dataset embebido como fallback.
+
+### 1) Crear tabla de snapshot
+
+En Supabase SQL Editor correr:
+
+```sql
+create table if not exists public.dashboard_snapshot (
+  id bigserial primary key,
+  payload jsonb not null,
+  updated_at timestamptz not null default now()
+);
+```
+
+### 2) Política de lectura pública (solo SELECT)
+
+```sql
+alter table public.dashboard_snapshot enable row level security;
+
+drop policy if exists "dashboard_snapshot_public_read" on public.dashboard_snapshot;
+
+create policy "dashboard_snapshot_public_read"
+on public.dashboard_snapshot
+for select
+using (true);
+```
+
+> Si te aparece “policy ... already exists”, está bien: significa que ya quedó creada antes.
+
+### 3) Cargar un snapshot nuevo (todos los días)
+
+```sql
+insert into public.dashboard_snapshot (payload)
+values (
+  '{
+    "MON": {"meses":[],"pedidos":[],"revenue":[],"ticket":[],"clientes":[]},
+    "SEGS": [],
+    "CLIENTES": [],
+    "PRODS": [],
+    "MAR_PRODS": [],
+    "MAR_PEDS": [],
+    "MAR_DIAS": []
+  }'::jsonb
+);
+```
+
+> Se toma el snapshot más reciente por `updated_at`.
+
+> ⚠️ Ese ejemplo tiene arrays vacíos solo como plantilla. Para producción cargá datos reales; si el payload viene incompleto, el frontend ahora ignora ese snapshot y usa fallback local.
+
+### 4) Configuración de credenciales
+
+El proyecto ya incluye por defecto `SUPABASE_URL` y `SUPABASE_ANON_KEY` de este entorno, así que no hace falta pegar nada en consola para empezar.
+
+Si querés sobreescribir esos valores en un navegador específico, ejecutá:
+
+```js
+localStorage.setItem('KUPE_SUPABASE_URL','https://TU-PROYECTO.supabase.co');
+localStorage.setItem('KUPE_SUPABASE_ANON_KEY','TU_ANON_PUBLIC_KEY');
+location.reload();
+```
+
+### 5) Verificar
+
+- Si el snapshot existe y las keys están bien, el dashboard carga datos desde Supabase.
+- Si falta algo, vuelve automáticamente al dataset embebido en `index.html`.
+
+### Troubleshooting rápido
+
+Si el dashboard aparece vacío o sin datos:
+
+1. Limpiá overrides viejos y recargá:
+
+```js
+localStorage.removeItem('KUPE_SUPABASE_URL');
+localStorage.removeItem('KUPE_SUPABASE_ANON_KEY');
+location.reload();
+```
+
+2. Verificá que el último `payload` en `dashboard_snapshot` tenga datos reales (no arrays vacíos).
+3. Si el snapshot remoto viene incompleto, el frontend lo ignora y usa fallback local.
+
+## Flujo diario recomendado (staging crudo ERP -> snapshot)
+
+Se agregó script SQL en `sql/refresh_dashboard_snapshot_from_crudo.sql`.
+
+### Pasos diarios
+
+1. Subir los archivos crudos del ERP a tus tablas (`deliverys`, `articulos_vendidos`, `clientes`).
+2. Ejecutar una sola vez el script `sql/refresh_dashboard_snapshot_from_crudo.sql` (crea funciones y objetos idempotentes).
+3. En adelante, cada día correr:
+
+```sql
+select public.refresh_dashboard_snapshot_from_crudo();
+```
+
+4. Verificar el último payload:
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
+### Automatización diaria (para no olvidarte)
+
+Si no querés ejecutar manualmente la función, podés programarla con `pg_cron` en Supabase.
+
+Ejemplo (07:10 AM Argentina = 10:10 UTC):
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
+Verificar jobs:
+
+```sql
+select jobid, jobname, schedule, active
+from cron.job
+order by jobid desc;
+```
 
EOF
)

- Si el snapshot existe y las keys están bien, el dashboard carga datos desde Supabase.
- Si falta algo, vuelve automáticamente al dataset embebido en `index.html`.
