-- ============================================================
-- Migration: Crear VIEW consolidada crm_accion_hoy
-- Propósito: Top 20 clientes a contactar CON sugerencias automáticas
-- ============================================================

CREATE OR REPLACE VIEW public.crm_accion_hoy AS
SELECT
  cl.id,
  cl.nombre,
  cl.telefono,
  cl.segmento,
  cl.recencia_dias,
  cl.score_comercial,
  cl.rank_prioridad,
  cl.producto_favorito,
  cl.ultimo_producto,
  cl.pan_favorito,
  cl.fecha_ultimo_pedido,
  cl.total_pedidos_historial,
  cl.ticket_promedio,
  cl.hora_habitual,

  -- ACCIÓN SUGERIDA: tipo de contacto recomendado
  CASE
    WHEN cl.segmento = 'Perdido' AND cl.recencia_dias > 90
      THEN 'Reactivación urgente'
    WHEN cl.segmento = 'En riesgo' AND cl.recencia_dias BETWEEN 61 AND 90
      THEN 'Seguimiento crítico'
    WHEN cl.segmento = 'Enfriando'
      THEN 'Oferta especial'
    WHEN cl.segmento = 'Tibio'
      THEN 'Oferta o incentivo'
    WHEN cl.segmento = 'Activo'
      THEN 'Contacto de rutina'
    ELSE 'Seguimiento'
  END AS accion_sugerida,

  -- MENSAJE SUGERIDO: personalizado por segmento y recencia
  CASE
    WHEN cl.segmento = 'Perdido' AND cl.recencia_dias > 90
      THEN 'Hola ' || cl.nombre || ', hace ' || cl.recencia_dias || ' días que no compras. ¿Podemos ofrecerte algo especial?'
    WHEN cl.segmento = 'En riesgo' AND cl.recencia_dias BETWEEN 61 AND 90
      THEN 'Hola ' || cl.nombre || ', extrañamos tu compra. Tenemos ' || COALESCE(cl.producto_favorito, 'promociones') || ' con descuento.'
    WHEN cl.segmento = 'Enfriando'
      THEN 'Hola ' || cl.nombre || '! Hace ' || cl.recencia_dias || ' días que no nos visitas. Mira nuestras ofertas.'
    WHEN cl.segmento = 'Tibio'
      THEN 'Hola ' || cl.nombre || '! Tenemos ' || COALESCE(cl.producto_favorito, 'ofertas') || ' que te encantará.'
    ELSE 'Hola ' || cl.nombre || ', aquí tienes lo que te gusta: ' || COALESCE(cl.producto_favorito, 'nuestros productos')
  END AS mensaje_sugerido,

  -- URGENCIA: nivel de prioridad visual
  CASE
    WHEN cl.segmento = 'Perdido'
      THEN 'alta'
    WHEN cl.segmento = 'En riesgo' AND cl.recencia_dias > 75
      THEN 'alta'
    WHEN cl.segmento = 'En riesgo'
      THEN 'media'
    WHEN cl.segmento IN ('Enfriando', 'Tibio')
      THEN 'media'
    ELSE 'baja'
  END AS urgencia,

  -- CONTEXTO: gestiones del día actual
  COALESCE(COUNT(gc.id) OVER (PARTITION BY cl.telefono), 0) AS contactos_hoy,
  MAX(gc.fecha_contacto) OVER (PARTITION BY cl.telefono) AS ultima_contacto_fecha

FROM public.clientes_live cl
LEFT JOIN public.gestion_comercial gc
  ON gc.telefono = cl.telefono
  AND gc.fecha_contacto = CURRENT_DATE
WHERE cl.recencia_dias > 7
  AND cl.segmento IS NOT NULL
  AND cl.segmento != 'Pendiente'
ORDER BY cl.score_comercial DESC
LIMIT 20;

-- Comentario de la VIEW
COMMENT ON VIEW public.crm_accion_hoy IS
'Top 20 clientes a contactar hoy con sugerencias automáticas de acción, mensaje y urgencia basadas en segmento y recencia.';

COMMENT ON COLUMN public.crm_accion_hoy.accion_sugerida IS
'Tipo de acción recomendada: Reactivación urgente, Seguimiento crítico, Oferta especial, etc.';

COMMENT ON COLUMN public.crm_accion_hoy.mensaje_sugerido IS
'Mensaje personalizado pre-escrito para enviar por WhatsApp/email';

COMMENT ON COLUMN public.crm_accion_hoy.urgencia IS
'Nivel de urgencia: alta, media, baja (para styling visual)';

COMMENT ON COLUMN public.crm_accion_hoy.contactos_hoy IS
'Cuántas gestiones comerciales se registraron hoy para este cliente';
