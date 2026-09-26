-- ============================================================
-- Dashboard: historial abr 2021 - dic 2022 (sistema anterior)
-- Fecha: 2026-09-26 · Aplicado vía apply_migration dashboard_historico_2021_2022
-- ============================================================
-- Fuente: exports "pedidos_cerrados" 2021/2022 del proveedor anterior
-- (soporte de BCN). Sin teléfono ni estado: todos son pedidos cerrados
-- (delivery ~99% + take away ~1%). clientes/retención = 0.
-- La función del snapshot no cambia: m_range ya arranca en min(mes).
-- ============================================================

insert into public.dashboard_historico_mensual (mes,pedidos,revenue,ticket,clientes,retencion,retencion_mes_siguiente,origen) values
('2021-04-01',435,527711.0,1213,0,0,null,'sistema_anterior'),
('2021-05-01',740,867227.5,1172,0,0,null,'sistema_anterior'),
('2021-06-01',668,906450.79,1357,0,0,null,'sistema_anterior'),
('2021-07-01',798,1061277.5,1330,0,0,null,'sistema_anterior'),
('2021-08-01',767,1023011.0,1334,0,0,null,'sistema_anterior'),
('2021-09-01',773,995322.5,1288,0,0,null,'sistema_anterior'),
('2021-10-01',1038,1295847.5,1248,0,0,null,'sistema_anterior'),
('2021-11-01',972,1398638.5,1439,0,0,null,'sistema_anterior'),
('2021-12-01',1120,1623202.5,1449,0,0,null,'sistema_anterior'),
('2022-01-01',1060,1491300.25,1407,0,0,null,'sistema_anterior'),
('2022-02-01',1025,1799026.5,1755,0,0,null,'sistema_anterior'),
('2022-03-01',1062,1824340.0,1718,0,0,null,'sistema_anterior'),
('2022-04-01',1189,2072953.5,1743,0,0,null,'sistema_anterior'),
('2022-05-01',1096,2323470.0,2120,0,0,null,'sistema_anterior'),
('2022-06-01',996,2137210.5,2146,0,0,null,'sistema_anterior'),
('2022-07-01',1182,2772947.5,2346,0,0,null,'sistema_anterior'),
('2022-08-01',1055,2623518.0,2487,0,0,null,'sistema_anterior'),
('2022-09-01',1125,3058985.5,2719,0,0,null,'sistema_anterior'),
('2022-10-01',1161,3238086.5,2789,0,0,null,'sistema_anterior'),
('2022-11-01',1113,3139779.0,2821,0,0,null,'sistema_anterior'),
('2022-12-01',1196,3777427.5,3158,0,0,null,'sistema_anterior')
on conflict (mes) do nothing;

select public.refresh_dashboard_snapshot_from_crudo();
