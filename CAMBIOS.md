# Registro de cambios — Kupe CRM

> Última actualización: 2026-06-17
> Conversación de referencia: diagnóstico de duplicados + migración a arquitectura cloud-only

---

## Contexto de partida

El CRM funcionaba con un ciclo ETL manual:
- El dueño exportaba archivos `.xlsx` del ERP (BCN Resto)
- Los copiaba a carpetas locales en su PC
- Ejecutaba `EJECUTAR-ACTUALIZAR-CRM.bat` que corría `update-data.cjs`
- El script subía los datos a Supabase y recalculaba clientes

**Problema:** desde el 1 de junio 2026, la hamburguesería opera 100% con la web propia (`kupeburgers.com`). El ERP quedó congelado como historial. El ciclo manual dejó de tener sentido.

---

## Problema detectado: duplicados en segmentos

**Síntoma reportado:** el número 1533958753 aparecía en distintos segmentos del CRM.

**Causa raíz encontrada:** dos bugs combinados:

1. **Umbrales distintos entre la DB y el UI.**
   La función `rebuild_clientes_from_crudo()` asignaba segmentos con umbrales `≤14/30/60/90` días, pero el glosario y la vista `clientes_live` mostraban criterios distintos (`<30/60/90/120`). Resultado: un cliente con 23 días de recencia aparecía como "Tibio" en la DB pero su recencia en pantalla decía "debería ser Activo".

2. **Dos fuentes de fecha para recencia.**
   La vista `clientes_live` calcula `recencia_dias` dinámicamente como `GREATEST(fecha_ultimo_pedido, ultima_compra)` — toma la fecha más reciente entre pedidos y ERP. Pero el ETL solo usaba pedidos para asignar el segmento. Si el ERP tenía una compra más reciente que los pedidos, la recencia en pantalla no coincidía con el segmento guardado.

**Escala del problema:** 446 clientes con segmento incorrecto al momento del diagnóstico.

---

## Cambio 1 — Umbrales de segmento unificados

**Qué se hizo:**
- Se restauraron los umbrales originales en `rebuild_clientes_from_crudo()`: `≤14 / ≤30 / ≤60 / ≤90 días`
- Se actualizó el glosario y la UI del CRM (`src/pages/CRM.jsx`) para mostrar exactamente esos mismos criterios
- Se corrigió el cálculo de "días para Perdido" (era 120, ahora 90)
- Se actualizaron los colores de recencia en la tabla de clientes (`>30` rojo, `>14` amarillo, `≤14` verde)

**Criterios vigentes:**

| Segmento | Recencia | Color |
|---|---|---|
| 🟢 Activo | ≤ 14 días | Verde |
| 🎯 Tibio | 15–30 días | Naranja |
| 🟠 Enfriando | 31–60 días | Naranja oscuro |
| 🔴 En riesgo | 61–90 días | Rojo |
| ⬛ Perdido | > 90 días | Gris |

**Archivos tocados:**
- `src/pages/CRM.jsx` — glosario (líneas ~873-877), color de recencia en tabla, cálculo diasParaPerdido
- DB: función `rebuild_clientes_from_crudo()` (migración `fix_segmento_umbrales_rebuild_clientes` y `revert_segmento_umbrales_originales`)

**Después del cambio:** se ejecutó `crm_recalcular_completo()` → 2138 clientes recalculados, 626 transiciones de segmento registradas.

---

## Cambio 2 — Actualización automática del CRM al entregar un pedido

**Problema:** el CRM solo se actualizaba una vez por día (cron nocturno a las 01:30 ARG). Los pedidos del día no se reflejaban hasta la madrugada siguiente.

**Solución:** trigger en `deliverys_web` que dispara `crm_recalcular_completo()` de forma asíncrona cada vez que un pedido pasa a estado Entregado + pagado.

**Arquitectura:**
```
Cocina marca "Entregado" en comanda.html
         ↓
deliverys_web.estado → 'entregado'
         ↓  TRIGGER AFTER UPDATE (no bloquea la comanda)
net.http_post → crm_recalcular_completo()  [async via pg_net]
         ↓  ~5 segundos después
CRM actualizado — segmentos, scores, dashboard
```

**Condición del trigger:** solo dispara cuando:
- `estado_erp` pasa a `'Entregado'` (no dispara en actualizaciones de otros campos)
- Y `pago_estado IN ('efectivo', 'aprobado')` (no dispara pedidos pendientes de pago)

**Autenticación:** la `service_role` key de Supabase se guarda encriptada en **Supabase Vault** (`vault.create_secret`). El trigger la lee en tiempo de ejecución — nunca queda expuesta en logs ni código.

**Objetos creados en DB:**
- Función: `trigger_crm_recalcular_on_entrega()` (SECURITY DEFINER)
- Trigger: `crm_recalcular_on_entrega` en `public.deliverys_web` (AFTER INSERT OR UPDATE, FOR EACH ROW)
- Secret en Vault: `supabase_service_key`

**Migraciones aplicadas:**
- `trigger_crm_recalcular_on_entrega`
- `trigger_crm_usa_vault_para_service_key`
- `fix_trigger_schema_net` (corrección: el schema es `net`, no `pg_net`)

**Cron nocturno existente (no modificado):** `crm_recalcular_nocturno` corre igual a las 04:30 UTC (01:30 ARG) como respaldo diario.

---

## Cambio 3 — Eliminación del ETL manual, script de emergencia

**Problema:** `scripts/update-data.cjs` (362 líneas) ya no tenía uso:
- Leía archivos `.xlsx` del ERP desde rutas hardcodeadas en Windows local
- El ERP está congelado desde el 31/05/2026 — no entra más información
- Los pedidos nuevos vienen de la web y se guardan directo en Supabase
- El recálculo ya lo cubre el trigger (tiempo real) + cron (diario)

**Qué se hizo:**
- `scripts/update-data.cjs` eliminado
- Creado `scripts/recalcular-crm.cjs` — script de emergencia mínimo (83 líneas)

**Cuándo usar `recalcular-crm.cjs`:**
- Después de importar datos históricos del ERP manualmente en Supabase
- Para forzar un recálculo inmediato sin esperar el cron de la madrugada
- Requiere `.env` con `SUPABASE_URL` y `SUPABASE_SERVICE_KEY`

```bash
node scripts/recalcular-crm.cjs
# Output: clientes actualizados, transiciones, dashboard rows, tiempo
```

---

## Arquitectura resultante (estado actual)

```
ERP BCN Resto (congelado al 31/05/2026)
  └─ stg_entregas_raw  ← histórico, no crece más
  └─ stg_*_raw         ← histórico, no crece más

Web kupeburgers.com (desde 01/06/2026)
  └─ deliverys_web     ← pedidos nuevos
       │
       └─ TRIGGER crm_recalcular_on_entrega
            │  (dispara al marcar Entregado)
            ▼
       crm_recalcular_completo()   ← pipeline completo
            │
            ▼
       clientes (tabla maestra)
            │
            ├─ clientes_live (vista, API del CRM)
            └─ crm_accion_hoy (top 20 contactar hoy)

Cron nocturno 01:30 ARG
  └─ crm_recalcular_completo()   ← respaldo diario
```

---

## Datos de referencia

| Item | Valor |
|---|---|
| Proyecto Supabase | `lqpzhzworncmcuptesjh` |
| Función principal ETL | `crm_recalcular_completo()` |
| Trigger en DB | `crm_recalcular_on_entrega` en `deliverys_web` |
| Cron nocturno | `crm_recalcular_nocturno` — 04:30 UTC / 01:30 ARG |
| Secret en Vault | `supabase_service_key` |
| Clientes en DB | ~2.138 |
| ERP congelado desde | 31/05/2026 |
| Web activa desde | 01/06/2026 |
