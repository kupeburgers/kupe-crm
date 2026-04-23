-- RPC Function: calcular_conversiones_30dias()
-- Purpose: Calculate contact-to-order conversion metrics for last 30 days
-- Returns: JSON object with total contacts, conversions, rate, avg days, and segment breakdown
-- Fix 2026-04-23: reemplaza p.ord=1 (solo primer pedido del periodo) por DISTINCT ON
-- que toma el primer pedido DESPUÉS de cada contacto, lo cual es la definición correcta.

CREATE OR REPLACE FUNCTION public.calcular_conversiones_30dias()
RETURNS TABLE (
  total_contactados BIGINT,
  total_conversiones BIGINT,
  tasa_conversion NUMERIC,
  dias_promedio_a_orden NUMERIC,
  por_segmento JSONB
) LANGUAGE SQL STABLE AS $$
  WITH fecha_rango AS (
    SELECT
      CURRENT_DATE - 30 as fecha_desde,
      CURRENT_DATE      as fecha_hasta
  ),

  contactos_30d AS (
    -- Contactos completados (con resultado) en los últimos 30 días
    SELECT DISTINCT ON (ch.cliente_telefono, ch.fecha_contacto)
      ch.cliente_telefono,
      ch.fecha_contacto,
      cl.segmento
    FROM public.contactos_historial ch
    LEFT JOIN public.clientes_live cl ON cl.telefono = ch.cliente_telefono
    CROSS JOIN fecha_rango
    WHERE ch.fecha_contacto >= fecha_rango.fecha_desde
      AND ch.resultado IS NOT NULL
    ORDER BY ch.cliente_telefono, ch.fecha_contacto
  ),

  entregas_src AS (
    -- Usa stg_entregas_raw si existe, sino entregas (compatibilidad)
    SELECT
      nullif(trim(coalesce(src.j->>'Telefono', src.j->>'telefono', '')), '') as telefono,
      public.parse_date_mixed(
        nullif(trim(coalesce(src.j->>'Fecha', src.j->>'fecha', '')), '')
      ) as fecha,
      nullif(trim(coalesce(src.j->>'Estado', src.j->>'estado', '')), '') as estado
    FROM (SELECT to_jsonb(e) as j FROM public.stg_entregas_raw e) src
    WHERE EXISTS (SELECT 1 FROM public.stg_entregas_raw LIMIT 1)

    UNION ALL

    SELECT telefono::text, fecha, estado::text
    FROM public.entregas
    WHERE NOT EXISTS (SELECT 1 FROM public.stg_entregas_raw LIMIT 1)
  ),

  pedidos_entregados AS (
    SELECT telefono, fecha
    FROM entregas_src
    WHERE initcap(estado) = 'Entregado'
      AND fecha IS NOT NULL
      AND telefono IS NOT NULL
  ),

  conversiones AS (
    -- Para cada contacto, buscar el primer pedido entregado DESPUÉS del contacto
    SELECT DISTINCT ON (c.cliente_telefono, c.fecha_contacto)
      c.cliente_telefono,
      c.fecha_contacto,
      c.segmento,
      p.fecha                               AS fecha_pedido,
      (p.fecha - c.fecha_contacto)::int     AS dias_a_pedido
    FROM contactos_30d c
    LEFT JOIN pedidos_entregados p
      ON p.telefono = c.cliente_telefono
     AND p.fecha > c.fecha_contacto
    ORDER BY c.cliente_telefono, c.fecha_contacto, p.fecha ASC NULLS LAST
  ),

  totales AS (
    SELECT
      COUNT(*)::BIGINT AS total_contactados,
      COUNT(*) FILTER (WHERE dias_a_pedido IS NOT NULL)::BIGINT AS total_conversiones,
      CASE WHEN COUNT(*) > 0
        THEN ROUND((COUNT(*) FILTER (WHERE dias_a_pedido IS NOT NULL)::NUMERIC / COUNT(*)) * 100, 1)
        ELSE 0
      END::NUMERIC AS tasa_conversion,
      CASE WHEN COUNT(*) FILTER (WHERE dias_a_pedido IS NOT NULL) > 0
        THEN ROUND(AVG(dias_a_pedido) FILTER (WHERE dias_a_pedido IS NOT NULL)::NUMERIC, 1)
        ELSE NULL
      END::NUMERIC AS dias_promedio
    FROM conversiones
  ),

  por_segmento_agg AS (
    SELECT
      COALESCE(segmento, 'Sin segmento') AS segmento,
      COUNT(*)::BIGINT AS cant_contactados,
      COUNT(*) FILTER (WHERE dias_a_pedido IS NOT NULL)::BIGINT AS cant_conversiones,
      CASE WHEN COUNT(*) > 0
        THEN ROUND((COUNT(*) FILTER (WHERE dias_a_pedido IS NOT NULL)::NUMERIC / COUNT(*)) * 100, 1)
        ELSE 0
      END::NUMERIC AS tasa,
      CASE WHEN COUNT(*) FILTER (WHERE dias_a_pedido IS NOT NULL) > 0
        THEN ROUND(AVG(dias_a_pedido) FILTER (WHERE dias_a_pedido IS NOT NULL)::NUMERIC, 1)
        ELSE NULL
      END::NUMERIC AS dias_prom
    FROM conversiones
    GROUP BY segmento
  ),

  por_segmento_json AS (
    SELECT jsonb_object_agg(
      segmento,
      jsonb_build_object(
        'contactados', cant_contactados,
        'conversiones', cant_conversiones,
        'tasa', tasa,
        'dias_promedio', dias_prom
      )
    ) AS segmento_json
    FROM por_segmento_agg
  )

  SELECT
    t.total_contactados,
    t.total_conversiones,
    t.tasa_conversion,
    t.dias_promedio,
    COALESCE(ps.segmento_json, '{}'::JSONB) AS por_segmento
  FROM totales t
  LEFT JOIN por_segmento_json ps ON true;
$$;
