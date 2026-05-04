🏗️ ARQUITECTURA KUPE CRM
1. BACKEND (Base de Datos)
Ubicación: Supabase (en la nube)

Tablas principales:

stg_entregas_raw — Datos crudos de delivery (se cargan y procesan)
stg_pedidos_pendiente_raw — Datos crudos de pedidos (se cargan y procesan)
stg_articulos_ventas_raw — Datos crudos de artículos (se cargan y procesan)
clientes_live — Clientes recalculados automáticamente (resultado de los datos crudos)
dashboard_snapshot — Métricas consolidadas para el dashboard
cliente_movimiento_segmento — Historial de transiciones entre segmentos
¿Cómo funciona?

Tu archivo .xlsx 
    ↓
update-data.cjs (Node.js) 
    ↓
Sube a stg_entregas_raw (datos crudos)
    ↓
RPC rebuild_clientes_from_crudo()
    ↓
Recalcula clientes_live automáticamente
    ↓
RPC refresh_dashboard_snapshot_from_crudo()
    ↓
Genera métricas en dashboard_snapshot
2. SCRIPTS DE ACTUALIZACIÓN
Ubicación: /scripts/update-data.cjs y EJECUTAR-ACTUALIZAR-CRM.bat

¿Qué hace?

Busca el archivo .xlsx más reciente en cada carpeta:
/datos/delivery/ → stg_entregas_raw
/datos/pedidos/ → stg_pedidos_pendiente_raw
/datos/articulos/ → stg_articulos_ventas_raw
Desduplicar automáticamente
Ejecuta 4 RPCs en orden:
rebuild_clientes_from_crudo() — Recalcula clientes
refresh_dashboard_snapshot_from_crudo() — Genera dashboard con timestamps
snapshot_segmentos_diario() — Guarda segmentos del día
calcular_transiciones_segmento_hoy() — Registra movimientos
¿Cuándo ejecutar?

Después de copiar archivos .xlsx nuevos en /datos/delivery/, /datos/pedidos/, /datos/articulos/
Doble click en EJECUTAR-ACTUALIZAR-CRM.bat (o node scripts/update-data.cjs)
Tarda ~10-15 segundos
3. FRONTEND (Lo que ves en navegador)
Ubicación: https://kupecrm.vercel.app (deploy automático en Vercel)

Dos páginas principales:

📊 Dashboard
/src/pages/Dashboard.jsx

Muestra:

KPIs del mes: Pedidos, Revenue, Ticket promedio, Clientes únicos, Retención
Timestamps: Cuándo se actualizó cada fuente (delivery, pedidos, artículos)
Alertas: Clientes Perdidos, En Riesgo, Tibios (automáticas)
Gráficos: Pedidos por mes, Revenue mensual, Retención %
Segmentos hoy: Activo, Tibio, Enfriando, En riesgo, Perdido (con números y movimientos)
¿Cómo obtiene datos?

Hook useSnapshot() → Trae de dashboard_snapshot tabla
Se actualiza cada vez que ejecutas update-data.cjs
👥 CRM — Acción comercial
/src/pages/CRM.jsx

Muestra:

Hoy: Top 20 clientes a contactar (por score, recencia > 7 días)
Acciones: Contactar, registrar resultado (Compró, Rechazó, No disponible, etc.)
Clientes: Tabla completa con búsqueda por teléfono
Conversiones: Métricas de contacto-a-pedido últimos 30 días
Productos: Top artículos vendidos con fechas
¿Cómo funciona?

Hooks que traen datos de clientes_live, gestion_comercial, resumen_articulos
Al contactar un cliente, se registra en gestion_comercial
El segmento se recalcula automáticamente
4. BASE DE DATOS — FLUJO COMPLETO
Tú copias archivos .xlsx
    ↓
EJECUTAR-ACTUALIZAR-CRM.bat
    ↓
update-data.cjs procesa:
    • delivery.xlsx → stg_entregas_raw
    • pedidos.xlsx → stg_pedidos_pendiente_raw
    • articulos.xlsx → stg_articulos_ventas_raw
    ↓
Ejecuta RPCs automáticamente:
    ↓
1. rebuild_clientes_from_crudo()
   • Toma datos de stg_entregas_raw
   • Calcula: recencia, frecuencia, ticket, valor_total, score
   • Asigna segmento automático (Activo/Tibio/Enfriando/En riesgo/Perdido)
   • Actualiza clientes_live
    ↓
2. refresh_dashboard_snapshot_from_crudo()
   • Calcula MON (meses, pedidos, revenue, ticket, clientes, retención)
   • Calcula SEGS (segmentos con números y movimientos)
   • Captura META (timestamps: última entrega, último pedido, último artículo)
   • Inserta en dashboard_snapshot
    ↓
3. snapshot_segmentos_diario()
   • Registra cuántos clientes hay en cada segmento hoy
   ↓
4. calcular_transiciones_segmento_hoy()
   • Compara segmento anterior con segmento nuevo
   • Registra en cliente_movimiento_segmento
    ↓
Dashboard y CRM se actualizan automáticamente en navegador
5. ARCHIVOS DE CONFIGURACIÓN
No tocar (salvo indicación):

/sql/ — Scripts SQL de setup (crear tablas, funciones, índices)
CLAUDE.md — Protocolo de trabajo (confirmación antes de cambios)
COMO-USAR-EL-CRM.txt — Instrucciones de uso
6. DESARROLLO (Worktree)
stupefied-burnell — Rama aislada para trabajar sin afectar main

Flujo:

Cambio en stupefied-burnell
    ↓
Testeo local
    ↓
git push
    ↓
Vercel deploy automático
    ↓
kupecrm.vercel.app actualizada
7. CICLO DE USO REAL
Lunes a viernes:

Recibes archivos .xlsx de ERP (delivery, pedidos, artículos)
Copias en /datos/delivery/, /datos/pedidos/, /datos/articulos/
Doble click en EJECUTAR-ACTUALIZAR-CRM.bat
Esperas 10-15 segundos
Abres https://kupecrm.vercel.app
Ves en Dashboard:
Métricas actualizadas
Timestamps de cuándo se cargaron los datos
Alertas automáticas de clientes en riesgo
Vas a CRM:
Ves Top 20 a contactar
Haces llamadas/contactos
Registras resultado
Automáticamente se recalcula segmento del cliente
8. QUÉ SE BORRA vs QUÉ NO
Cosa	¿Se borra?	¿Se modifica?
Archivos .xlsx en /datos/	❌ No (solo si quieres historizar)	✅ Se reemplazan con nuevos
stg_entregas_raw, stg_pedidos_pendiente_raw, stg_articulos_ventas_raw	❌ No (son staging)	✅ Se limpian y refrescan cada ejecución
clientes_live	❌ No (es la fuente de verdad)	✅ Se recalcula cada ejecución
dashboard_snapshot	❌ No (es histórico)	✅ Se agrega nuevo snapshot cada ejecución
Scripts en /src/	❌ No (salvo refactor)	✅ Se mejoran según necesidad
Base de datos	❌ NO NUNCA	✅ Solo mediante migraciones en Supabase

---

## 4.A — IMPLEMENTACIÓN FINAL (BASELINE CONOCIDO)

### RPC: refresh_dashboard_snapshot_from_crudo() — Estructura completa

**Ubicación:** `/sql/refresh_dashboard_snapshot_from_crudo.sql`

**Propósito:** Genera un snapshot completo del dashboard con 4 secciones JSONB (MON, SEGS, MOV_SEGS, META). Se ejecuta en el paso 6 del flujo ETL.

#### MON — Métricas mensuales

**Datos:** 15 meses históricos (hoy - 14 meses atrás hasta hoy)

**CTEs principales:**
1. `ent_src` → Extrae datos crudos de stg_entregas_raw (fallback a entregas si staging vacía)
   - Campos: fecha_txt, telefono_txt, total_txt, estado_txt
   - Filtro: Solo registros con estado = 'Entregado'

2. `d_ok` → Datos limpios y parseados
   - fecha: `parse_date_mixed(fecha_txt)` — función personalizada que maneja múltiples formatos
   - total: `parse_num_ar(total_txt)` — parsea números con coma decimal
   - Filtro: fecha NOT NULL AND estado = 'Entregado'

3. `m_range` → Rango de meses (15 meses)
   - Genera series mensual desde (max_fecha - 14 meses) hasta max_fecha

4. `clientes_mes` → CRÍTICO para retención
   ```
   Por cada mes:
     - cliente_count: COUNT(DISTINCT telefono)
     - total: SUM(total)
     - pedidos: COUNT(*)
   Almacena para comparar meses consecutivos
   ```

5. `retencion_calc` → Cálculo de retención
   ```
   FÓRMULA: (Clientes mes N que también compraron en mes N-1) / (Clientes mes N-1) × 100
   
   Pseudo-código:
   Para cada mes M:
     clientes_hoy = clientes únicos en mes M
     clientes_mes_anterior = clientes únicos en mes M-1
     clientes_en_ambos = COUNT(DISTINCT telefono donde compró en M Y en M-1)
     
     retencion_M = (clientes_en_ambos / clientes_mes_anterior) × 100
     
   Si clientes_mes_anterior = 0 → retencion = 0
   ```

6. `m_agg` → Agregación final por mes
   ```
   SELECT mes_ini, pedidos, revenue, ticket, clientes, retencion
   ```

7. `mon_json` → Payload MON
   ```json
   {
     "meses": ["Ene", "Feb", ...],
     "pedidos": [12, 15, ...],
     "revenue": [15000, 18500, ...],
     "ticket": [1250, 1233, ...],
     "clientes": [12, 15, ...],
     "retencion": [0, 85.7, 80, ...]
   }
   ```

---

#### SEGS — Estadísticas de segmentos (estado actual)

**Fuente:** `clientes_live` (VIEW que contiene clientes recalculados)

**CTEs principales:**
1. `seg_data` → Agrupa clientes_live por segmento
   ```
   SELECT
     segmento,
     COUNT(*) as cliente_count,
     SUM(valor_total) as seg_revenue,
     AVG(ticket_promedio) as seg_ticket,
     AVG(score_comercial) as seg_score
   FROM clientes_live
   WHERE segmento IS NOT NULL
   ```

2. `seg_with_meta` → Enriquece con colores, iconos y recomendaciones
   ```
   Mapeo automático:
     'Activo' → #00a65a (verde), 🟢, "Mantener activos"
     'Tibio' → #d97700 (naranja claro), 🎯, "Reactivar"
     'Enfriando' → #c05a00 (naranja), 🟠, "Urgente"
     'En riesgo' → #cc2222 (rojo), 🔴, "Crítico"
     'Perdido' → #666 (gris), ⬛, "Recuperar"
   ```

3. `segs_json` → Payload SEGS (ordenado por score DESC)
   ```json
   [
     {
       "segmento": "Activo",
       "col": "#00a65a",
       "ic": "🟢",
       "clientes": 1250,
       "rec": "Mantener activos",
       "revenue": 145000,
       "ticket": 1160,
       "score_prom": 92
     },
     ...
   ]
   ```

---

#### MOV_SEGS — Movimientos de segmento (últimas 24h)

**Fuente:** `cliente_movimiento_segmento` (tabla de auditoría)

**Estructura de tabla cliente_movimiento_segmento:**
```
id (bigint)
cliente_telefono (text) — clave para unir con clientes_live
fecha (date) — fecha del movimiento
segmento_anterior (text) — segmento antes
segmento_nuevo (text) — segmento después
created_at (timestamp) — cuando se registró
```

**CTEs principales:**
1. `mov_data` → Agregación por segmento en CURRENT_DATE
   ```
   SELECT
     segmento,
     COUNT(*) FILTER (WHERE cambio_tipo = 'entrada') as entraron,
     COUNT(*) FILTER (WHERE cambio_tipo = 'salida') as salieron
   FROM cliente_movimiento_segmento
   WHERE fecha = CURRENT_DATE
   ```

   **Lógica de cambio_tipo:**
   - 'entrada' = segmento_nuevo = segmento (cliente entró HOY a este segmento)
   - 'salida' = segmento_anterior = segmento (cliente salió HOY de este segmento)

2. `movs_json` → Payload MOV_SEGS
   ```json
   [
     {
       "segmento": "Activo",
       "entraron": 5,
       "salieron": 2,
       "entraron_desde": {"Tibio": 3, "Enfriando": 2},
       "salieron_hacia": {"Tibio": 2}
     },
     ...
   ]
   ```

   **Nota:** entraron_desde y salieron_hacia son `{}` en la implementación actual (cálculo futuro)

---

#### META — Metadata de actualización

**CTEs principales:**
1. `meta_info` → Extrae timestamps de 3 fuentes
   ```
   ultima_entrega: MAX(fecha) WHERE estado = 'Entregado' (de d_ok)
   ultima_pedido: MAX(created_at) FROM stg_pedidos_pendiente_raw
   ultima_articulo: MAX(created_at) FROM stg_articulos_ventas_raw
   actualizado_at: NOW()
   ```

   **Estrategia de timestamps:**
   - Entregas: Se parsea "Fecha" de los datos crudos con `parse_date_mixed()`
   - Pedidos/Artículos: Se usa `created_at` (timestamp que genera Supabase al UPSERT)
   - Actualización: `NOW()` al momento de generar el snapshot

2. `meta_json` → Payload META
   ```json
   {
     "ultima_entrega": "2026-04-17",
     "ultima_pedido": "2026-04-17T15:32:00",
     "ultima_articulo": "2026-04-17T15:32:00",
     "actualizado_at": "2026-04-17T15:32:45.123456"
   }
   ```

---

#### PAYLOAD FINAL — Estructura JSONB completa

```json
{
  "MON": {
    "meses": ["Dic", "Ene", ..., "Abr"],
    "pedidos": [12, 15, ..., 18],
    "revenue": [15000, 18500, ..., 22000],
    "ticket": [1250, 1233, ..., 1222],
    "clientes": [12, 15, ..., 18],
    "retencion": [0, 85.7, ..., 88.9]
  },
  "SEGS": [
    {
      "segmento": "Activo",
      "col": "#00a65a",
      "ic": "🟢",
      "clientes": 1250,
      "rec": "Mantener activos",
      "revenue": 145000,
      "ticket": 1160,
      "score_prom": 92
    },
    ...
  ],
  "MOV_SEGS": [
    {
      "segmento": "Activo",
      "entraron": 5,
      "salieron": 2,
      "entraron_desde": {},
      "salieron_hacia": {}
    },
    ...
  ],
  "META": {
    "ultima_entrega": "2026-04-17",
    "ultima_pedido": "2026-04-17T15:32:00",
    "ultima_articulo": "2026-04-17T15:32:00",
    "actualizado_at": "2026-04-17T15:32:45.123456"
  }
}
```

---

### ETL: 8 pasos en order (update-data.cjs)

1. **LEER archivos Excel**
   - /datos/delivery/ → lectura del más reciente
   - /datos/pedidos/ → lectura de todos, deduplicación por id_pedido (mantiene más reciente)
   - /datos/articulos/ → lectura de todos

2. **UPSERT stg_entregas_raw** (RPC: upsert_entregas)
   - Trunca tabla anterior (limpia)
   - Inserta nuevos registros en lotes de 100

3. **UPSERT stg_pedidos_pendiente_raw** (RPC: upsert_pedidos_pendientes)
   - Trunca tabla anterior
   - Inserta deduplicated en lotes de 100

4. **UPSERT stg_articulos_ventas_raw** (RPC: upsert_articulos_ventas)
   - Trunca tabla anterior
   - Inserta en lotes de 100

5. **RPC: rebuild_clientes_from_crudo()**
   - Recalcula clientes_live desde stg_entregas_raw
   - Asigna segmentos automáticamente
   - Calcula recencia, frecuencia, ticket, score, etc.
   - Retorna: cantidad de clientes recalculados

6. **RPC: calcular_transiciones_segmento_hoy()**
   - Compara segmento anterior vs nuevo en clientes_live
   - Registra en cliente_movimiento_segmento
   - Retorna: cantidad de movimientos registrados
   - **Debe ejecutarse DESPUÉS de rebuild_clientes_from_crudo()**

7. **RPC: refresh_dashboard_snapshot_from_crudo()** ← ESTAMOS ACÁ
   - Genera MON, SEGS, MOV_SEGS, META
   - Inserta en dashboard_snapshot
   - Retorna: ID del nuevo snapshot

8. **RPC: snapshot_segmentos_diario()**
   - Registra estado de segmentos para auditoría histórica
   - Captura: fecha, segmento, cantidad de clientes
   - Retorna: cantidad de registros guardados

---

### Validaciones PRE-SNAPSHOT

Antes de insertar en dashboard_snapshot, la RPC valida:

1. **Fechas válidas:** Todas las fechas deben ser parseables con `parse_date_mixed()`
   - Acepta: "2026-04-17", "17/04/2026", "04-17-2026", etc.
   - Si falla: levanta exception y detiene la ejecución

2. **Totales numéricos:** Todos los totales deben ser parseables con `parse_num_ar()`
   - Acepta: "1500", "1.500", "1,50", etc.
   - Si falla: levanta exception y detiene la ejecución

**Si hay errores, la RPC aborta y retorna el error al script Node.js.**

---

### Timeline de ejecución esperada

```
Paso 1 (LEER): ~2 seg
Paso 2 (stg_entregas): ~3 seg
Paso 3 (stg_pedidos): ~2 seg
Paso 4 (stg_articulos): ~1 seg
Paso 5 (rebuild_clientes): ~15 seg
Paso 6 (calcular_transiciones): ~10 seg
Paso 7 (refresh_snapshot): ⏱️ ~50 seg (más lento)
Paso 8 (snapshot_segmentos): ~5 seg
─────────────────────────
TOTAL: ~90 segundos
```

El paso 7 es el más lento porque calcula 15 meses de retención y 5 segmentos con agregaciones complejas.

---

### Fuentes de verdad

| Componente | Fuente | Lectura | Escritura |
|---|---|---|---|
| MON (meses) | stg_entregas_raw | ✅ | ❌ |
| SEGS (segmentos hoy) | clientes_live | ✅ | ❌ |
| MOV_SEGS (movimientos hoy) | cliente_movimiento_segmento | ✅ | ❌ |
| META (timestamps) | stg_entregas_raw, stg_pedidos_pendiente_raw, stg_articulos_ventas_raw | ✅ | ❌ |
| dashboard_snapshot | INSERT nuevo record | ❌ | ✅ |

---

### Si algo falla en el futuro

**1. Retención no calcula / es 0:**
- Verificar `cliente_movimiento_segmento` tenga registros de movimientos
- Verificar `clientes_live` tenga registros de los meses comparados
- Revisar la fórmula en `retencion_calc` CTE

**2. MOV_SEGS vacío:**
- Verificar `cliente_movimiento_segmento` tabla exista y tenga datos
- Verificar `fecha = CURRENT_DATE` (verificar la fecha del servidor)
- Revisar que `calcular_transiciones_segmento_hoy()` se ejecutó antes

**3. META timestamps incompletos:**
- Verificar stg_* tablas tengan datos
- Verificar `parse_date_mixed()` existe (función personalizada)
- Revisar que UPSERT de archivos Excel fue exitoso

**4. Timeout (>60 segundos):**
- Verificar índices en `clientes_live.segmento`
- Verificar índices en `cliente_movimiento_segmento.fecha`
- Considerar agregar índice compuesto: `(fecha, cliente_telefono)`

**PUNTO DE RETORNO:** Este documento describe el estado funcional en fecha 2026-04-17. Si algo se rompe, volver a esta arquitectura y revisar qué cambió.