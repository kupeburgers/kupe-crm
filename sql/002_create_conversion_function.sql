-- RPC Function: calcular_conversiones_30dias()
-- Purpose: Calculate contact-to-order conversion metrics for last 30 days
-- Returns: JSON object with total contacts, conversions, rate, avg days, and segment breakdown
-- Date: 2026-04-10

CREATE OR REPLACE FUNCTION public.calcular_conversiones_30dias()
RETURNS TABLE (
  total_contactados BIGINT,
  total_conversiones BIGINT,
  tasa_conversion NUMERIC,
  dias_promedio_a_orden NUMERIC,
  por_segmento JSONB
) LANGUAGE SQL STABLE AS $$
  WITH fecha_rango AS (
    -- Define 30-day window
    SELECT
      CURRENT_DATE - 30 as fecha_desde,
      CURRENT_DATE as fecha_hasta
  ),

  contactos_30d AS (
    -- Get all contacts in last 30 days
    SELECT DISTINCT
      ch.cliente_telefono,
      ch.fecha_contacto,
      cl.segmento
    FROM public.contactos_historial ch
    LEFT JOIN public.clientes_live cl ON cl.telefono = ch.cliente_telefono
    CROSS JOIN fecha_rango
    WHERE ch.fecha_contacto >= fecha_rango.fecha_desde
      AND ch.resultado IS NOT NULL  -- Only count completed contacts
  ),

  pedidos_30d AS (
    -- Get all orders/deliveries
    SELECT
      e.telefono,
      e.fecha,
      ROW_NUMBER() OVER (PARTITION BY e.telefono ORDER BY e.fecha) as ord
    FROM public.entregas e
    CROSS JOIN fecha_rango
    WHERE e.estado = 'Entregado'
      AND e.fecha >= fecha_rango.fecha_desde
  ),

  conversiones AS (
    -- Match contacts to next order after contact date
    SELECT
      c.cliente_telefono,
      c.fecha_contacto,
      c.segmento,
      p.fecha as fecha_pedido,
      (p.fecha - c.fecha_contacto)::int as dias_a_pedido,
      CASE WHEN p.fecha > c.fecha_contacto THEN 1 ELSE 0 END as es_conversion
    FROM contactos_30d c
    LEFT JOIN pedidos_30d p ON p.telefono = c.cliente_telefono
      AND p.fecha >= c.fecha_contacto
      AND p.ord = 1  -- Only first order after contact
  ),

  conversiones_consolidadas AS (
    -- Consolidate: 1 row per contact with conversion flag
    SELECT DISTINCT ON (cliente_telefono, fecha_contacto)
      cliente_telefono,
      fecha_contacto,
      segmento,
      dias_a_pedido,
      (dias_a_pedido IS NOT NULL AND dias_a_pedido > 0) as convertio
    FROM conversiones
    WHERE dias_a_pedido IS NULL OR dias_a_pedido > 0
    ORDER BY cliente_telefono, fecha_contacto, dias_a_pedido NULLS LAST
  ),

  totales AS (
    SELECT
      COUNT(*)::BIGINT as total_contactados,
      COUNT(*) FILTER (WHERE convertio)::BIGINT as total_conversiones,
      CASE
        WHEN COUNT(*) > 0
        THEN ROUND((COUNT(*) FILTER (WHERE convertio)::NUMERIC / COUNT(*)) * 100, 1)
        ELSE 0
      END::NUMERIC as tasa_conversion,
      CASE
        WHEN COUNT(*) FILTER (WHERE convertio) > 0
        THEN ROUND(AVG(dias_a_pedido) FILTER (WHERE convertio)::NUMERIC, 1)
        ELSE NULL
      END::NUMERIC as dias_promedio
    FROM conversiones_consolidadas
  ),

  por_segmento_agg AS (
    SELECT
      COALESCE(cc.segmento, 'Sin segmento') as segmento,
      COUNT(*)::BIGINT as cant_contactados,
      COUNT(*) FILTER (WHERE cc.convertio)::BIGINT as cant_conversiones,
      CASE
        WHEN COUNT(*) > 0
        THEN ROUND((COUNT(*) FILTER (WHERE cc.convertio)::NUMERIC / COUNT(*)) * 100, 1)
        ELSE 0
      END::NUMERIC as tasa,
      CASE
        WHEN COUNT(*) FILTER (WHERE cc.convertio) > 0
        THEN ROUND(AVG(cc.dias_a_pedido) FILTER (WHERE cc.convertio)::NUMERIC, 1)
        ELSE NULL
      END::NUMERIC as dias_prom
    FROM conversiones_consolidadas cc
    GROUP BY cc.segmento
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
    ) as segmento_json
    FROM por_segmento_agg
  )

  SELECT
    t.total_contactados,
    t.total_conversiones,
    t.tasa_conversion,
    t.dias_promedio,
    COALESCE(ps.segmento_json, '{}'::JSONB) as por_segmento
  FROM totales t, por_segmento_json ps;
$$;
