-- ============================================================
-- Dashboard: historial completo + año en las etiquetas
-- Fecha: 2026-09-26
-- ============================================================
-- Problema:
--   MON (Pedidos por mes / Revenue mensual / Retención) mostraba solo
--   los últimos 15 meses (max(fecha) - interval '14 month'). Ene–Jun 2025
--   estaban en la base pero no se veían. Además las etiquetas eran solo
--   el mes en inglés ("Jul" aparecía dos veces) y el mes en curso se leía
--   como si fuera una caída.
--
-- Cambio (solo MON; SEGS, MOV_SEGS y META quedan idénticos):
--   1) m_range arranca en el primer mes con datos (min(fecha)), no en -14 meses.
--   2) Etiquetas en español con año: 'Ene 25', 'Sep 26'.
--   3) El mes en curso lleva '*' (parcial): 'Sep 26*'.
--
-- Base: definición EN VIVO de la función al 2026-09-26 (incluye el UNION
-- con deliverys_web). El archivo refresh_dashboard_snapshot_from_crudo.sql
-- del repo está desactualizado respecto de producción.
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_dashboard_snapshot_from_crudo()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare
  v_new_id bigint;
  v_bad_dates int;
  v_bad_totals int;
begin

  -- =========================
  -- PRE-CHECK (VALIDACIÓN)
  -- =========================
  with ent_src as (
    select fecha_txt, total_txt
    from (
      select
        nullif(trim(coalesce(src.j->>'Fecha', src.j->>'fecha_raw', src.j->>'fecha', '')), '') as fecha_txt,
        nullif(trim(coalesce(src.j->>'Total', src.j->>'total_raw', src.j->>'total', '')), '') as total_txt
      from (select to_jsonb(e) as j from public.stg_entregas_raw e) src
      UNION ALL
      SELECT dw.fecha::text, dw.total::text
      FROM public.deliverys_web dw
      WHERE dw.estado_erp = 'Entregado'
    ) z
  )
  select
    count(*) filter (
      where nullif(trim(fecha_txt),'') is not null
      and public.parse_date_mixed(fecha_txt) is null
    ),
    count(*) filter (
      where nullif(trim(total_txt),'') is not null
      and public.parse_num_ar(total_txt) is null
    )
  into v_bad_dates, v_bad_totals
  from ent_src;

  if v_bad_dates > 0 or v_bad_totals > 0 then
    raise exception
      'ERROR: % fechas inválidas, % importes inválidos',
      v_bad_dates, v_bad_totals;
  end if;

  -- =========================
  -- DATA LIMPIA Y AGREGACIÓN
  -- =========================
  with ent_src as (
    select
      fecha_txt,
      nullif(trim(coalesce(telefono_txt,'')), '') as telefono_txt,
      total_txt,
      coalesce(estado_txt,'') as estado_txt
    from (
      select
        nullif(trim(coalesce(src.j->>'Fecha', src.j->>'fecha_raw', src.j->>'fecha', '')), '') as fecha_txt,
        nullif(trim(coalesce(src.j->>'Telefono', src.j->>'telefono', src.j->>'teléfono', '')), '') as telefono_txt,
        nullif(trim(coalesce(src.j->>'Total', src.j->>'total_raw', src.j->>'total', '')), '') as total_txt,
        nullif(trim(coalesce(src.j->>'Estado', src.j->>'estado', '')), '') as estado_txt
      from (select to_jsonb(e) as j from public.stg_entregas_raw e) src
      UNION ALL
      SELECT
        dw.fecha::text,
        dw.telefono,
        dw.total::text,
        'Entregado'
      FROM public.deliverys_web dw
      WHERE dw.estado_erp = 'Entregado'
    ) z
  ),

  d as (
    select
      public.parse_date_mixed(fecha_txt) as fecha,
      telefono_txt as telefono,
      coalesce(public.parse_num_ar(total_txt),0) as total,
      initcap(estado_txt) as estado
    from ent_src
  ),

  d_ok as (
    select * from d
    where estado = 'Entregado'
      and fecha is not null
  ),

  -- CAMBIO 1: todo el historial disponible (antes: max - 14 meses).
  m_range as (
    select generate_series(
      date_trunc('month', (select min(fecha) from d_ok)),
      date_trunc('month', (select max(fecha) from d_ok)),
      interval '1 month'
    )::date as mes_ini
  ),

  clientes_mes as (
    select
      date_trunc('month', fecha)::date as mes,
      count(*) as pedidos_mes,
      sum(total)::numeric as revenue_mes,
      round(avg(total))::numeric as ticket_mes,
      count(distinct telefono)::int as clientes_mes
    from d_ok
    group by date_trunc('month', fecha)
  ),

  retencion_calc as (
    select
      cm.mes,
      cm.clientes_mes,
      coalesce(
        round(
          100.0 * count(distinct case when cm_prev.mes is not null then t_curr.telefono end) /
          nullif(cm_prev.clientes_mes, 0)
        )::int,
        0
      ) as retencion
    from clientes_mes cm
    left join clientes_mes cm_prev on cm_prev.mes = cm.mes - interval '1 month'
    left join d_ok t_curr on date_trunc('month', t_curr.fecha)::date = cm.mes
    left join d_ok t_prev on date_trunc('month', t_prev.fecha)::date = cm_prev.mes
      and t_prev.telefono = t_curr.telefono
    where t_prev.telefono is not null or cm_prev.mes is null
    group by cm.mes, cm.clientes_mes, cm_prev.clientes_mes
  ),

  m_agg as (
    select
      mr.mes_ini,
      coalesce(cm.pedidos_mes, 0)::int as pedidos,
      coalesce(cm.revenue_mes, 0)::numeric as revenue,
      coalesce(cm.ticket_mes, 0)::numeric as ticket,
      coalesce(cm.clientes_mes, 0)::int as clientes,
      coalesce(rc.retencion, 0)::int as retencion
    from m_range mr
    left join clientes_mes cm on cm.mes = mr.mes_ini
    left join retencion_calc rc on rc.mes = mr.mes_ini
  ),

  -- CAMBIO 2 y 3: etiqueta 'Ene 25' en español con año; '*' = mes en curso (parcial).
  mon_json as (
    select jsonb_build_object(
      'meses',    jsonb_agg(
                    (array['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'])[extract(month from mes_ini)::int]
                    || ' ' || to_char(mes_ini, 'YY')
                    || case when mes_ini = date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date
                            then '*' else '' end
                    order by mes_ini),
      'pedidos',  jsonb_agg(pedidos  order by mes_ini),
      'revenue',  jsonb_agg(revenue  order by mes_ini),
      'ticket',   jsonb_agg(ticket   order by mes_ini),
      'clientes', jsonb_agg(clientes order by mes_ini),
      'retencion',jsonb_agg(retencion order by mes_ini)
    ) as mon
    from m_agg
  ),

  seg_data as (
    select
      cl.segmento,
      count(*) as cliente_count,
      coalesce(sum(cl.valor_total), 0)::numeric as seg_revenue,
      coalesce(round(avg(cl.ticket_promedio)), 0)::numeric as seg_ticket,
      coalesce(round(avg(cl.score_comercial)), 0)::numeric as seg_score
    from public.clientes_live cl
    where cl.segmento is not null
    group by cl.segmento
  ),

  seg_with_meta as (
    select
      sd.segmento, sd.cliente_count, sd.seg_revenue, sd.seg_ticket, sd.seg_score,
      case sd.segmento
        when 'Activo'    then '#00a65a'
        when 'Tibio'     then '#d97700'
        when 'Enfriando' then '#c05a00'
        when 'En riesgo' then '#cc2222'
        when 'Perdido'   then '#666'
        else '#999'
      end as col,
      case sd.segmento
        when 'Activo'    then '🟢'
        when 'Tibio'     then '🎯'
        when 'Enfriando' then '🟠'
        when 'En riesgo' then '🔴'
        when 'Perdido'   then '⬛'
        else '⚪'
      end as ic,
      case sd.segmento
        when 'Activo'    then 'Mantener activos'
        when 'Tibio'     then 'Reactivar'
        when 'Enfriando' then 'Urgente'
        when 'En riesgo' then 'Crítico'
        when 'Perdido'   then 'Recuperar'
        else 'Seguimiento'
      end as rec
    from seg_data sd
  ),

  segs_json as (
    select jsonb_agg(
      jsonb_build_object(
        'segmento', segmento, 'col', col, 'ic', ic,
        'clientes', cliente_count, 'rec', rec,
        'revenue', seg_revenue, 'ticket', seg_ticket, 'score_prom', seg_score
      ) order by seg_score desc
    ) as segs
    from seg_with_meta
  ),

  mov_entrada_raw as (
    select segmento_nuevo as segmento, coalesce(segmento_anterior,'Nuevo') as desde, count(*) as cnt
    from public.cliente_movimiento_segmento where fecha = current_date
    group by segmento_nuevo, segmento_anterior
  ),
  mov_salida_raw as (
    select segmento_anterior as segmento, segmento_nuevo as hacia, count(*) as cnt
    from public.cliente_movimiento_segmento
    where fecha = current_date and segmento_anterior is not null
    group by segmento_anterior, segmento_nuevo
  ),
  mov_entrada_agg as (
    select segmento, sum(cnt)::int as entraron, jsonb_object_agg(desde, cnt) as entraron_desde
    from mov_entrada_raw group by segmento
  ),
  mov_salida_agg as (
    select segmento, sum(cnt)::int as salieron, jsonb_object_agg(hacia, cnt) as salieron_hacia
    from mov_salida_raw group by segmento
  ),
  movs_combined as (
    select
      coalesce(me.segmento, ms.segmento) as segmento,
      coalesce(me.entraron, 0) as entraron,
      coalesce(me.entraron_desde, '{}'::jsonb) as entraron_desde,
      coalesce(ms.salieron, 0) as salieron,
      coalesce(ms.salieron_hacia, '{}'::jsonb) as salieron_hacia
    from mov_entrada_agg me
    full outer join mov_salida_agg ms on me.segmento = ms.segmento
  ),
  movs_json as (
    select jsonb_agg(
      jsonb_build_object(
        'segmento', segmento, 'entraron', entraron, 'salieron', salieron,
        'entraron_desde', entraron_desde, 'salieron_hacia', salieron_hacia
      ) order by (entraron + salieron) desc
    ) as movs
    from movs_combined
  ),

  meta_info as (
    select
      max(case when estado = 'Entregado' then fecha else null end)::text as ultima_entrega,
      (select max(created_at)::text from public.stg_pedidos_pendiente_raw) as ultima_pedido,
      (select max(created_at)::text from public.stg_articulos_ventas_raw) as ultima_articulo,
      now()::text as actualizado_at
    from d_ok
  ),
  meta_json as (
    select jsonb_build_object(
      'ultima_entrega', ultima_entrega,
      'ultima_pedido',  ultima_pedido,
      'ultima_articulo',ultima_articulo,
      'actualizado_at', actualizado_at
    ) as meta
    from meta_info
  ),

  ins as (
    insert into public.dashboard_snapshot(payload)
    select jsonb_build_object(
      'MON',     mon_json.mon,
      'SEGS',    coalesce(segs_json.segs, '[]'::jsonb),
      'MOV_SEGS',coalesce(movs_json.movs, '[]'::jsonb),
      'META',    meta_json.meta
    )
    from mon_json, segs_json, movs_json, meta_json
    returning id
  )

  select id into v_new_id from ins;

  return v_new_id;

end;
$function$;

-- Aplicado en Supabase (kupe-burgers) vía apply_migration el 2026-09-26; snapshot id 723.
-- Regenerar el snapshot para que el dashboard lo muestre ya (sin esperar al cron).
select public.refresh_dashboard_snapshot_from_crudo();
