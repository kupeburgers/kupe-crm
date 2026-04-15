-- Setup inicial (correr 1 vez): ejecutar TODO este archivo en Supabase SQL Editor.
-- Flujo diario (luego del setup):
-- 1) Subir crudo ERP a public.stg_entregas_raw y public.stg_articulos_vendidos_raw (+ clientes si aplica)
-- 2) Ejecutar: select public.refresh_dashboard_snapshot_from_crudo();
-- 3) Verificar métricas del último payload

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
  -- DATA LIMPIA
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

  -- Retención mensual: % de clientes del mes anterior que volvieron a comprar
  mes_clientes as (
    select distinct
      date_trunc('month', fecha)::date as mes,
      telefono
    from d_ok
    where telefono is not null
  ),

  prev_count as (
    select mes, count(*) as total
    from mes_clientes
    group by mes
  ),

  retained as (
    select c.mes, count(*) as retenidos
    from mes_clientes c
    join mes_clientes p
      on p.telefono = c.telefono
      and p.mes = (c.mes - interval '1 month')::date
    group by c.mes
  ),

  ret_agg as (
    select
      mr.mes_ini,
      coalesce(
        case
          when coalesce(pc.total, 0) = 0 then 0
          else round(100.0 * coalesce(r.retenidos, 0) / pc.total)::int
        end, 0
      ) as retencion
    from m_range mr
    left join prev_count pc on pc.mes = (mr.mes_ini - interval '1 month')::date
    left join retained r on r.mes = mr.mes_ini
  ),

  mon_json as (
    select jsonb_build_object(
      'meses',     jsonb_agg(initcap(to_char(ma.mes_ini,'Mon')) order by ma.mes_ini),
      'pedidos',   jsonb_agg(ma.pedidos   order by ma.mes_ini),
      'revenue',   jsonb_agg(ma.revenue   order by ma.mes_ini),
      'ticket',    jsonb_agg(ma.ticket    order by ma.mes_ini),
      'clientes',  jsonb_agg(ma.clientes  order by ma.mes_ini),
      'retencion', jsonb_agg(coalesce(ra.retencion, 0) order by ma.mes_ini)
    ) as mon
    from m_agg ma
    left join ret_agg ra on ra.mes_ini = ma.mes_ini
  ),

  ins as (
    insert into public.dashboard_snapshot(payload)
    select jsonb_build_object(
      'MON', mon_json.mon
    )
    from mon_json
    returning id
  )

  select id into v_new_id from ins;

  return v_new_id;

end;
$$;