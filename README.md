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
