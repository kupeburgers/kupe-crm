-- ============================================================
-- Dashboard: sumar historial 2023-2024 (dashboard_historico_mensual)
-- Fecha: 2026-09-26
-- ============================================================
-- Los exports ERP 2023/2024 se cargan como TOTALES MENSUALES precalculados
-- (tabla dashboard_historico_mensual, 24 filas), no fila a fila: solo los
-- usa el Dashboard. clientes / scores / CRM no cambian (decisión del dueño:
-- inflación + lo reciente pesa más).
--   ene-sep 2023: sistema anterior (sin teléfono/estado, se asume Entregado)
--   oct 2023: mixto · nov 2023 en adelante: BCN Resto
-- Cambios sobre 2026-09-26_dashboard_historial_completo.sql: m_range y m_agg.
-- ============================================================

-- 1) Tabla de totales mensuales (aplicado vía apply_migration dashboard_historico_mensual)
create table if not exists public.dashboard_historico_mensual (
  mes                     date primary key,
  pedidos                 integer not null,
  revenue                 numeric not null,
  ticket                  numeric not null,
  clientes                integer not null,
  retencion               integer not null,
  retencion_mes_siguiente integer,   -- solo dic 2024: retención de ene 2025
  origen                  text not null,
  created_at              timestamptz not null default now()
);
alter table public.dashboard_historico_mensual enable row level security;

insert into public.dashboard_historico_mensual (mes,pedidos,revenue,ticket,clientes,retencion,retencion_mes_siguiente,origen) values
('2023-01-01',1145,4076190.0,3560,0,0,null,'sistema_anterior'),
('2023-02-01',1027,3903298.0,3801,0,0,null,'sistema_anterior'),
('2023-03-01',1226,4703821.5,3837,0,0,null,'sistema_anterior'),
('2023-04-01',1154,5278066.5,4574,0,0,null,'sistema_anterior'),
('2023-05-01',1261,5785666.0,4588,0,0,null,'sistema_anterior'),
('2023-06-01',1407,7545280.0,5363,0,0,null,'sistema_anterior'),
('2023-07-01',1515,8879658.5,5861,0,0,null,'sistema_anterior'),
('2023-08-01',1295,8075908.5,6236,0,0,null,'sistema_anterior'),
('2023-09-01',1222,9152620.0,7490,0,0,null,'sistema_anterior'),
('2023-10-01',1157,9604572.5,8301,9,0,null,'mixto'),
('2023-11-01',941,9039992.5,9607,668,0,null,'bcn'),
('2023-12-01',881,9761826.5,11080,646,36,null,'bcn'),
('2024-01-01',731,9636386.5,13182,560,33,null,'bcn'),
('2024-02-01',661,10067100.0,15230,523,32,null,'bcn'),
('2024-03-01',630,10513412.0,16688,482,34,null,'bcn'),
('2024-04-01',606,11854696.5,19562,472,34,null,'bcn'),
('2024-05-01',789,14149044.6,17933,578,42,null,'bcn'),
('2024-06-01',849,15395813.0,18134,599,35,null,'bcn'),
('2024-07-01',719,14992210,20851,525,31,null,'bcn'),
('2024-08-01',713,16275597.5,22827,515,36,null,'bcn'),
('2024-09-01',643,13896032.5,21611,441,35,null,'bcn'),
('2024-10-01',527,12861898,24406,387,33,null,'bcn'),
('2024-11-01',533,13915929.5,26109,389,35,null,'bcn'),
('2024-12-01',584,15053916,25777,415,40,37,'bcn')
on conflict (mes) do nothing;

-- 2) Función del snapshot (aplicado vía apply_migration dashboard_historico_2023_2024)
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

  -- Todo el historial: el primer mes entre los datos vivos y el histórico
  -- precalculado 2023-2024 (dashboard_historico_mensual).
  m_range as (
    select generate_series(
      least(
        date_trunc('month', (select min(fecha) from d_ok))::date,
        coalesce((select min(mes) from public.dashboard_historico_mensual),
                 date_trunc('month', (select min(fecha) from d_ok))::date)
      ),
      date_trunc('month', (select max(fecha) from d_ok))::date,
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
    -- Mes con datos vivos → datos vivos; si no, el histórico precalculado.
    -- Retención del primer mes vivo (ene 2025): viene del histórico
    -- (retencion_mes_siguiente de dic 2024), porque el mes previo no está en d_ok.
    select
      mr.mes_ini,
      coalesce(cm.pedidos_mes,  h.pedidos,  0)::int     as pedidos,
      coalesce(cm.revenue_mes,  h.revenue,  0)::numeric as revenue,
      coalesce(cm.ticket_mes,   h.ticket,   0)::numeric as ticket,
      coalesce(cm.clientes_mes, h.clientes, 0)::int     as clientes,
      (case
         when cm.mes is not null and cm_prev.mes is null and hp.retencion_mes_siguiente is not null
           then hp.retencion_mes_siguiente
         else coalesce(rc.retencion, h.retencion, 0)
       end)::int as retencion
    from m_range mr
    left join clientes_mes cm      on cm.mes = mr.mes_ini
    left join clientes_mes cm_prev on cm_prev.mes = (mr.mes_ini - interval '1 month')::date
    left join retencion_calc rc    on rc.mes = mr.mes_ini
    left join public.dashboard_historico_mensual h
           on h.mes = mr.mes_ini and cm.mes is null
    left join public.dashboard_historico_mensual hp
           on hp.mes = (mr.mes_ini - interval '1 month')::date
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

select public.refresh_dashboard_snapshot_from_crudo();
