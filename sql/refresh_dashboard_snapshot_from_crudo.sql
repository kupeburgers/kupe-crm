-- Setup inicial (correr 1 vez): ejecutar TODO este archivo en Supabase SQL Editor.
-- Flujo diario (luego del setup):
-- 1) Subir crudo ERP a public.stg_entregas_raw, stg_pedidos_pendiente_raw, stg_articulos_ventas_raw
-- 2) Ejecutar: select public.refresh_dashboard_snapshot_from_crudo();
-- 3) Verificar métricas completas: MON, SEGS, MOV_SEGS, META

create or replace function public.refresh_dashboard_snapshot_from_crudo()
returns bigint
language plpgsql
as $$
declare
  v_new_id bigint;
  v_bad_dates int;
  v_bad_totals int;
begin

  -- =========================
  -- PRE-CHECK (VALIDACIÓN)
  -- =========================
  with ent_src as (
    select
      fecha_txt,
      total_txt
    from (
      select
        nullif(trim(coalesce(src.j->>'Fecha', src.j->>'fecha_raw', src.j->>'fecha', '')), '') as fecha_txt,
        nullif(trim(coalesce(src.j->>'Total', src.j->>'total_raw', src.j->>'total', '')), '') as total_txt
      from (
        select to_jsonb(e) as j
        from public.stg_entregas_raw e
      ) src

      union all

      select
        en.fecha::text,
        en.total::text
      from public.entregas en
      where not exists (select 1 from public.stg_entregas_raw)
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
      from (
        select to_jsonb(e) as j
        from public.stg_entregas_raw e
      ) src

      union all

      select
        en.fecha::text,
        coalesce(en.telefono::text,''),
        en.total::text,
        coalesce(en.estado::text,'')
      from public.entregas en
      where not exists (select 1 from public.stg_entregas_raw)
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

  m_range as (
    select generate_series(
      date_trunc('month', (select max(fecha) from d_ok)) - interval '14 month',
      date_trunc('month', (select max(fecha) from d_ok)),
      interval '1 month'
    )::date as mes_ini
  ),

  m_agg as (
    select
      mr.mes_ini,
      count(d_ok.*)::int as pedidos,
      coalesce(sum(d_ok.total),0)::numeric as revenue,
      case when count(d_ok.*)>0 then round(avg(d_ok.total)) else 0 end::numeric as ticket,
      count(distinct d_ok.telefono)::int as clientes
    from m_range mr
    left join d_ok on date_trunc('month', d_ok.fecha) = mr.mes_ini
    group by mr.mes_ini
    order by mr.mes_ini
  ),

  mon_json as (
    select jsonb_build_object(
      'meses', jsonb_agg(initcap(to_char(mes_ini,'Mon')) order by mes_ini),
      'pedidos', jsonb_agg(pedidos order by mes_ini),
      'revenue', jsonb_agg(revenue order by mes_ini),
      'ticket', jsonb_agg(ticket order by mes_ini),
      'clientes', jsonb_agg(clientes order by mes_ini),
      'retencion', jsonb_agg(0 order by mes_ini)
    ) as mon
    from m_agg
  ),

  -- SEGS: Estadísticas actuales por segmento (desde clientes_live)
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
      sd.segmento,
      sd.cliente_count,
      sd.seg_revenue,
      sd.seg_ticket,
      sd.seg_score,
      case sd.segmento
        when 'Activo' then '#00a65a'
        when 'Tibio' then '#d97700'
        when 'Enfriando' then '#c05a00'
        when 'En riesgo' then '#cc2222'
        when 'Perdido' then '#666'
        else '#999'
      end as col,
      case sd.segmento
        when 'Activo' then '🟢'
        when 'Tibio' then '🎯'
        when 'Enfriando' then '🟠'
        when 'En riesgo' then '🔴'
        when 'Perdido' then '⬛'
        else '⚪'
      end as ic,
      case sd.segmento
        when 'Activo' then 'Mantener activos'
        when 'Tibio' then 'Reactivar'
        when 'Enfriando' then 'Urgente'
        when 'En riesgo' then 'Crítico'
        when 'Perdido' then 'Recuperar'
        else 'Seguimiento'
      end as rec
    from seg_data sd
  ),

  segs_json as (
    select jsonb_agg(
      jsonb_build_object(
        'segmento', segmento,
        'col', col,
        'ic', ic,
        'clientes', cliente_count,
        'rec', rec,
        'revenue', seg_revenue,
        'ticket', seg_ticket,
        'score_prom', seg_score
      ) order by seg_score desc
    ) as segs
    from seg_with_meta
  ),

  -- MOV_SEGS: Movimientos hoy desde segmento_historial
  mov_data as (
    select
      segmento,
      count(*) filter (where cambio_tipo = 'entrada') as entraron,
      count(*) filter (where cambio_tipo = 'salida') as salieron
    from public.segmento_historial
    where fecha = current_date
    group by segmento
  ),

  movs_json as (
    select jsonb_agg(
      jsonb_build_object(
        'segmento', segmento,
        'entraron', coalesce(entraron, 0),
        'salieron', coalesce(salieron, 0),
        'entraron_desde', '{}'::jsonb,
        'salieron_hacia', '{}'::jsonb
      )
    ) as movs
    from (
      select distinct segmento from public.segmento_historial where fecha = current_date
      union
      select distinct segmento from seg_with_meta
    ) seg_list
    left join mov_data using (segmento)
  ),

  -- META: Fechas de última actualización de cada fuente
  meta_info as (
    select
      max(case when estado = 'Entregado' then fecha else null end)::text as ultima_entrega,
      (select max(fecha_pedido)::text from public.stg_pedidos_pendiente_raw) as ultima_pedido,
      (select max(fecha_venta)::text from public.stg_articulos_ventas_raw) as ultima_articulo,
      now()::text as actualizado_at
    from d_ok
  ),

  meta_json as (
    select jsonb_build_object(
      'ultima_entrega', ultima_entrega,
      'ultima_pedido', ultima_pedido,
      'ultima_articulo', ultima_articulo,
      'actualizado_at', actualizado_at
    ) as meta
    from meta_info
  ),

  -- INSERTAR PAYLOAD COMPLETO
  ins as (
    insert into public.dashboard_snapshot(payload)
    select jsonb_build_object(
      'MON', mon_json.mon,
      'SEGS', coalesce(segs_json.segs, '[]'::jsonb),
      'MOV_SEGS', coalesce(movs_json.movs, '[]'::jsonb),
      'META', meta_json.meta
    )
    from mon_json, segs_json, movs_json, meta_json
    returning id
  )

  select id into v_new_id from ins;

  return v_new_id;

end;
$$;
