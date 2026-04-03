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

## Deploy directo en GitHub (sin Actions)

Este repo quedó preparado para deploy **directo desde GitHub Pages** (sin workflow de Actions).

### Configuración en GitHub

1. Ir a **Settings → Pages**.
2. En **Source**, elegir **Deploy from a branch**.
3. Seleccionar:
   - **Branch:** `main` (o la rama que uses para producción)
   - **Folder:** `/ (root)`
4. Guardar.

### Operativa

- Cada push a la rama configurada actualiza el sitio.
- Si cambiás datos, el cambio debe quedar en `index.html` y commiteado.
- Si no ves cambios al instante, esperar 1–3 minutos y refrescar con **Ctrl/Cmd + Shift + R**.

## Camino B (recomendado): actualización diaria automática con Supabase

El frontend ahora intenta leer un snapshot desde Supabase **antes** de renderizar.
Si no encuentra configuración, usa el dataset embebido como fallback.

### 1) Crear tabla de snapshot

En Supabase SQL Editor correr:

```sql
create table if not exists public.dashboard_snapshot (
  id bigserial primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
```

### 2) Política de lectura pública (solo SELECT)

```sql
alter table public.dashboard_snapshot enable row level security;

create policy "dashboard_snapshot_public_read"
on public.dashboard_snapshot
for select
using (true);
```

### 3) Cargar un snapshot nuevo (todos los días)

```sql
insert into public.dashboard_snapshot (payload)
values (
  '{
    "MON": {"meses":[],"pedidos":[],"revenue":[],"ticket":[],"clientes":[]},
    "SEGS": [],
    "CLIENTES": [],
    "PRODS": [],
    "MAR_PRODS": [],
    "MAR_PEDS": [],
    "MAR_DIAS": []
  }'::jsonb
);
```

> Se toma el snapshot más reciente por `updated_at`.

### 4) Configurar credenciales en el navegador (una sola vez)

Abrí la consola del navegador y ejecutá:

```js
localStorage.setItem('KUPE_SUPABASE_URL','https://TU-PROYECTO.supabase.co');
localStorage.setItem('KUPE_SUPABASE_ANON_KEY','TU_ANON_PUBLIC_KEY');
location.reload();
```

### 5) Verificar

- Si el snapshot existe y las keys están bien, el dashboard carga datos desde Supabase.
- Si falta algo, vuelve automáticamente al dataset embebido en `index.html`.
