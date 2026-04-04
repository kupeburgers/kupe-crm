-- Setup inicial (correr 1 vez): ejecutar TODO este archivo en Supabase SQL Editor.
-- Flujo diario (luego del setup):
-- 1) Subir crudo ERP a public.stg_entregas_raw y public.stg_articulos_vendidos_raw (+ clientes si aplica)
-- 2) Ejecutar: select public.refresh_dashboard_snapshot_from_crudo();
-- 3) Verificar métricas del último payload

create table if not exists public.dashboard_snapshot (
  id bigserial primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_snapshot enable row level security;
drop policy if exists "dashboard_snapshot_public_read" on public.dashboard_snapshot;
create policy "dashboard_snapshot_public_read"
on public.dashboard_snapshot
for select
using (true);

create or replace function public.parse_num_ar(v text)
returns numeric
language plpgsql
immutable
as $$
declare
  s text;
  has_comma boolean;
  has_dot boolean;
  dec_sep text;
begin
  if v is null or btrim(v) = '' then
    return null;
  end if;

  s := btrim(v);
  s := regexp_replace(s, '[[:space:]\$€£]', '', 'g');
  s := regexp_replace(s, '[^0-9,.\-]', '', 'g');

  if s = '' then
    return null;
  end if;

  has_comma := position(',' in s) > 0;
  has_dot := position('.' in s) > 0;

  if has_comma and has_dot then
    -- Si trae ambos, el último separador suele ser el decimal.
    if strpos(reverse(s), ',') < strpos(reverse(s), '.') then
      dec_sep := ',';
    else
      dec_sep := '.';
    end if;
  elsif has_comma then
    dec_sep := ',';
  elsif has_dot then
    dec_sep := '.';
  else
    dec_sep := null;
  end if;

  if dec_sep = ',' then
    s := replace(s, '.', '');
    s := replace(s, ',', '.');
  elsif dec_sep = '.' then
    s := replace(s, ',', '');
  else
    s := replace(replace(s, '.', ''), ',', '');
  end if;

  if s !~ '^-?[0-9]+(\.[0-9]+)?$' then
    return null;
  end if;

  return s::numeric;
end;
$$;

create or replace function public.parse_date_mixed(v text)
returns date
language plpgsql
immutable
as $$
declare
  s text;
  d date;
begin
  if v is null or btrim(v) = '' then
    return null;
  end if;

  s := btrim(v);

  -- Excel serial date (admite 5-6 dígitos).
  if s ~ '^[0-9]{5,6}$' then
    return date '1899-12-30' + s::int;
  end if;

  if s ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' then
    d := to_date(s, 'DD/MM/YYYY');
    if to_char(d, 'DD/MM/YYYY') = s then
      return d;
    end if;
    return null;
  end if;

  if s ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    d := to_date(s, 'YYYY-MM-DD');
    if to_char(d, 'YYYY-MM-DD') = s then
      return d;
    end if;
    return null;
  end if;

  -- Timestamp ISO: tomamos solo fecha.
  if s ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T]' then
    s := substr(s, 1, 10);
    d := to_date(s, 'YYYY-MM-DD');
    if to_char(d, 'YYYY-MM-DD') = s then
      return d;
    end if;
  end if;

  return null;
end;
$$;



create or replace function public.ensure_dashboard_source_schema()
returns void
language plpgsql
as $$
declare
  col text;
  delivery_cols text[] := array['numero_pedido','fecha','hora','cliente','telefono','total','tarifa_de_envio','estado','monto_cupon','monto_efectivo'];
  artic_cols text[] := array['articulo','cantidad','total'];
  clientes_cols text[] := array['nombre','telefono','frecuencia','valor_total','ticket_promedio','recencia_dias','ultima_compra','segmento','meses_activo'];
begin
  -- Crea tablas base si no existen (esquema mínimo para que no rompa la carga)
  execute 'create table if not exists public.entregas (id bigserial primary key)';
  execute 'create table if not exists public.articulos_vendidos (id bigserial primary key)';
  execute 'create table if not exists public.clientes (id bigserial primary key)';
  execute 'create table if not exists public.stg_entregas_raw (pedido text, fecha_raw text, hora_raw text, cliente text, direccion text, telefono text, total_raw text, delivery_raw text, empresa text, n_ped_raw text, estado text, desc_pct_raw text, cupon text, cup_raw text, efect_raw text, entrega_raw text, imported_at timestamptz default now())';
  execute 'create table if not exists public.stg_articulos_vendidos_raw (fecha_raw text, articulo text, codigo text, cantidad_raw text, neto_raw text, total_raw text, costo_raw text, utilidad_raw text, utilidad_neto_raw text, imported_at timestamptz default now())';

  -- Agrega columnas faltantes como text (tolerante a archivos crudos heterogéneos)
  foreach col in array delivery_cols loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='entregas' and column_name=col
    ) then
      execute format('alter table public.entregas add column %I text', col);
    end if;
  end loop;

  foreach col in array artic_cols loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='articulos_vendidos' and column_name=col
    ) then
      execute format('alter table public.articulos_vendidos add column %I text', col);
    end if;
  end loop;

  foreach col in array clientes_cols loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='clientes' and column_name=col
    ) then
      execute format('alter table public.clientes add column %I text', col);
    end if;
  end loop;
end;
$$;

create or replace function public.refresh_dashboard_snapshot_from_crudo()
returns bigint
language plpgsql
as $$
declare
  v_new_id bigint;
  v_bad_dates int;
  v_bad_totals int;
begin
  perform public.ensure_dashboard_source_schema();

  with ent_src as (
    select
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
        en.fecha::text,
        en.total::text
      from public.entregas en
      where not exists (select 1 from public.stg_entregas_raw)
    ) z
  )
  select
    count(*) filter (where nullif(trim(fecha_txt),'') is not null and public.parse_date_mixed(fecha_txt) is null),
    count(*) filter (where nullif(trim(total_txt),'') is not null and public.parse_num_ar(total_txt) is null)
  into v_bad_dates, v_bad_totals
  from ent_src;

  if v_bad_dates > 0 or v_bad_totals > 0 then
    raise exception
      'refresh_dashboard_snapshot_from_crudo cancelado: % fechas inválidas y % importes inválidos en origen',
      v_bad_dates, v_bad_totals;
  end if;

  with
  ent_src as (
    select
ent_src as (
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
    select * from d where estado = 'Entregado' and fecha is not null
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
      'clientes', jsonb_agg(clientes order by mes_ini)
    ) as mon
    from m_agg
  ),
  segs_json as (
    select jsonb_agg(
      jsonb_build_object(
        'segmento', segmento_lbl,
        'ic', ic,
        'col', col,
        'clientes', clientes_cnt,
        'revenue', revenue_sum,
        'ticket', ticket_avg,
        'rec', rec_txt
      )
      order by ord
    ) as segs
    from (
      select
        case
          when lower(c.segmento) like 'activo%' then 'Activo'
          when lower(c.segmento) like 'tibio%' then 'Tibio'
          when lower(c.segmento) like 'enfriando%' then 'Enfriando'
          when lower(c.segmento) like 'en riesgo%' then 'En riesgo'
          else 'Perdido'
        end as segmento_lbl,
        count(*)::int as clientes_cnt,
        coalesce(sum(public.parse_num_ar(c.valor_total::text)),0)::numeric as revenue_sum,
        coalesce(round(avg(public.parse_num_ar(c.ticket_promedio::text))),0)::numeric as ticket_avg,
        case
          when lower(c.segmento) like 'activo%' then '0–14 días'
          when lower(c.segmento) like 'tibio%' then '15–30 días'
          when lower(c.segmento) like 'enfriando%' then '31–60 días'
          when lower(c.segmento) like 'en riesgo%' then '61–90 días'
          else '90+ días'
        end as rec_txt,
        case
          when lower(c.segmento) like 'activo%' then '🟢'
          when lower(c.segmento) like 'tibio%' then '🎯'
          when lower(c.segmento) like 'enfriando%' then '🟠'
          when lower(c.segmento) like 'en riesgo%' then '🔴'
          else '⬛'
        end as ic,
        case
          when lower(c.segmento) like 'activo%' then '#00a65a'
          when lower(c.segmento) like 'tibio%' then '#d97700'
          when lower(c.segmento) like 'enfriando%' then '#c05a00'
          when lower(c.segmento) like 'en riesgo%' then '#cc2222'
          else '#999'
        end as col,
        case
          when lower(c.segmento) like 'activo%' then 1
          when lower(c.segmento) like 'tibio%' then 2
          when lower(c.segmento) like 'enfriando%' then 3
          when lower(c.segmento) like 'en riesgo%' then 4
          else 5
        end as ord
      from public.clientes c
      group by 1,5,6,7,8
    ) s
  ),
  clientes_json as (
    select jsonb_agg(
      jsonb_build_object(
        'n', coalesce(nombre::text,''),
        't', coalesce(telefono::text,''),
        'f', coalesce(frecuencia,0),
        'v', coalesce(public.parse_num_ar(valor_total::text),0),
        'tk', coalesce(public.parse_num_ar(ticket_promedio::text),0),
        're', coalesce(recencia_dias,999),
        'ult', coalesce(ultima_compra::text,''),
        's', coalesce(segmento::text,'Perdido'),
        'ma', coalesce(meses_activo,1)
      )
      order by coalesce(public.parse_num_ar(valor_total::text),0) desc
    ) as clientes
    from public.clientes
  ),
  a_src as (
    select
      articulo,
      cantidad_txt,
      total_txt
    from (
      select
        a.articulo::text as articulo,
        a.cantidad_raw as cantidad_txt,
        a.total_raw as total_txt
      from public.stg_articulos_vendidos_raw a
      union all
      select
        av.articulo::text,
        av.cantidad::text,
        av.total::text
      from public.articulos_vendidos av
      where not exists (select 1 from public.stg_articulos_vendidos_raw)
    ) q
  ),
  prods_top as (
    select
      articulo::text as producto,
      coalesce(sum(public.parse_num_ar(cantidad_txt)),0)::numeric as unidades,
      coalesce(sum(public.parse_num_ar(total_txt)),0)::numeric as importe
    from a_src
    where coalesce(articulo::text,'') !~* '^total'
      and coalesce(articulo::text,'') !~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
    group by articulo::text
    order by sum(public.parse_num_ar(cantidad_txt)) desc
    limit 15
  ),
  prods_json as (
    select jsonb_agg(
      jsonb_build_object(
        'producto', producto,
        'unidades', unidades,
        'importe', importe
      )
      order by unidades desc
    ) as prods
    from prods_top
  ),
  mar_base as (
    select date_trunc('month', max(fecha))::date as mes_ini from d_ok
  ),
  mar_days as (
    select
      extract(day from d_ok.fecha)::int as dia,
      count(*)::int as pedidos
    from d_ok, mar_base
    where date_trunc('month', d_ok.fecha) = mar_base.mes_ini
    group by 1
    order by 1
  ),
  mar_json as (
    select
      jsonb_agg(lpad(dia::text,2,'0') order by dia) as mar_dias,
      jsonb_agg(pedidos order by dia) as mar_peds
    from mar_days
  ),
  mar_prods_json as (
    select jsonb_agg(
      jsonb_build_object(
        'p', producto,
        'u', unidades,
        'new', false
      )
      order by unidades desc
    ) as mar_prods
    from (
      select
        articulo::text as producto,
        coalesce(sum(public.parse_num_ar(cantidad_txt)),0)::numeric as unidades
      from a_src
      where coalesce(articulo::text,'') !~* '^total'
        and coalesce(articulo::text,'') !~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
      group by articulo::text
      order by sum(public.parse_num_ar(cantidad_txt)) desc
      limit 10
    ) t
  ),
  ins as (
    insert into public.dashboard_snapshot(payload)
    select jsonb_build_object(
      'MON', mon_json.mon,
      'SEGS', segs_json.segs,
      'CLIENTES', clientes_json.clientes,
      'PRODS', prods_json.prods,
      'MAR_PRODS', mar_prods_json.mar_prods,
      'MAR_PEDS', mar_json.mar_peds,
      'MAR_DIAS', mar_json.mar_dias
    )
    from mon_json, segs_json, clientes_json, prods_json, mar_json, mar_prods_json
    returning id
  )
  select id into v_new_id from ins;

  return v_new_id;
end;
$$;

-- Ejecutar cada vez que subís staging crudo del ERP:
-- select public.refresh_dashboard_snapshot_from_crudo();


-- Opcional: automatizar con pg_cron (Supabase)
-- Ejemplo: todos los días 07:10 AM Argentina (UTC-3) => 10:10 UTC
create extension if not exists pg_cron;

do $do$
begin
  -- Evita duplicados si ya existe job previo
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'refresh_dashboard_snapshot_daily';

  perform cron.schedule(
    'refresh_dashboard_snapshot_daily',
    '10 10 * * *',
    $job$select public.refresh_dashboard_snapshot_from_crudo();$job$
  );
exception
  when undefined_table then
    raise notice 'pg_cron no disponible en este entorno. Configuralo desde Supabase Integrations/Extensions.';
end $do$;

-- Ver jobs programados:
-- select jobid, jobname, schedule, active from cron.job order by jobid desc;
