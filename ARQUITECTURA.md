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