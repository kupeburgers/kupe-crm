/**
 * update-data.cjs — Script de actualización COMPLETA de datos CRM
 *
 * Actualiza 3 fuentes de datos:
 *   1. Delivery (entregas)
 *   2. Pedidos pendientes
 *   3. Artículos vendidos
 *
 * Pasos:
 *   1. Lee delivery.xlsx → UPSERT stg_entregas_raw
 *   2. Lee pedidos*.xlsx → UPSERT stg_pedidos_pendiente_raw
 *   3. Lee articulos*.xlsx → UPSERT stg_articulos_ventas_raw
 *   4. rebuild_clientes_from_crudo()
 *   5. refresh_dashboard_snapshot_from_crudo()
 *   6. snapshot_segmentos_diario()
 */

const XLSX  = require('xlsx')
const https = require('https')
const path  = require('path')
const fs    = require('fs')

const SUPABASE_URL = 'lqpzhzworncmcuptesjh.supabase.co'
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxcHpoendvcm5jbWN1cHRlc2poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDI2NDYsImV4cCI6MjA4OTUxODY0Nn0.sa4SrtesQLLpP898P4zKUGeYbbILxQ2PUoaOy-dXFjI'

const DELIVERY_DIR  = 'C:/Users/kupeb/OneDrive/Escritorio/supabase crm/datos/delivery'
const PEDIDOS_DIR   = 'C:/Users/kupeb/OneDrive/Escritorio/supabase crm/datos/pedidos'
const ARTICULOS_DIR = 'C:/Users/kupeb/OneDrive/Escritorio/supabase crm/datos/articulos'
const BATCH_SIZE    = 100

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function request(method, urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req  = https.request({
      hostname: SUPABASE_URL,
      path:     urlPath,
      method,
      headers: {
        'Content-Type':  'application/json',
        'apikey':        ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Prefer':        'return=minimal,resolution=merge-duplicates',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...extraHeaders
      }
    }, res => {
      let buf = ''
      res.on('data', d => buf += d)
      res.on('end', () => resolve({ status: res.statusCode, body: buf }))
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

function rpc(fn) {
  return request('POST', `/rest/v1/rpc/${fn}`, {})
}

// ── Leer xlsx genérico ──────────────────────────────────────────────────────────

function readXlsxFiles(dir, transformer) {
  const files = fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.xlsx'))
    .sort()
  if (files.length === 0) {
    console.log(`   ⚠️  No se encontraron archivos .xlsx en ${dir}`)
    return []
  }
  console.log(`   📂 Archivos (${files.length}):`)
  let all = []
  for (const fname of files) {
    const fullPath = `${dir}/${fname}`
    try {
      const wb   = XLSX.readFile(fullPath)
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null })
      // Siempre skip la primera fila (contiene headers)
      const dataRows = rows.length > 0 ? rows.slice(1) : rows
      const transformed = dataRows.map(transformer).filter(r => r && Object.keys(r).length > 0)
      console.log(`      ${fname}: ${transformed.length} filas`)
      all = all.concat(transformed)
    } catch (e) {
      console.error(`      ❌ Error leyendo ${fname}: ${e.message}`)
    }
  }
  return all
}

// Transformadores específicos

function transformDelivery(r) {
  if (typeof r[0] !== 'number' || !Number.isInteger(r[0])) return null
  return {
    'Pedido':    r[0]  != null ? String(r[0])  : null,
    'Fecha':     r[1]  != null ? String(r[1])  : null,
    'Hora':      r[2]  != null ? String(r[2])  : null,
    'Cliente':   r[3]  != null ? String(r[3])  : null,
    'Direccion': r[4]  != null ? String(r[4])  : null,
    'Telefono':  r[5]  != null ? String(r[5])  : null,
    'Total':     r[6]  != null ? String(r[6])  : null,
    'Delivery':  r[7]  != null ? String(r[7])  : null,
    'Empresa':   r[8]  != null ? String(r[8])  : null,
    'N Ped':     r[9]  != null ? String(r[9])  : null,
    'Estado':    r[10] != null ? String(r[10]) : null,
    'Desc %':    r[11] != null ? String(r[11]) : null,
    'Cupon':     r[12] != null ? String(r[12]) : null,
    'Cup':       r[13] != null ? String(r[13]) : null,
    'Efect':     r[14] != null ? String(r[14]) : null,
    'Entrega':   r[15] != null ? String(r[15]) : null,
  }
}

function transformPedidos(r) {
  if (!r[0]) return null // Sin Pedido ID
  return {
    'id_pedido':        r[0]  != null ? String(r[0])  : null,
    'fecha_pedido':     r[1]  != null ? String(r[1])  : null,
    'cliente':          r[2]  != null ? String(r[2])  : null,
    'telefono':         r[3]  != null ? String(r[3])  : null,
    'producto':         r[4]  != null ? String(r[4])  : null,
    'cantidad':         r[5]  != null ? String(r[5])  : null,
    'precio_unitario':  r[6]  != null ? String(r[6])  : null,
    'total':            r[7]  != null ? String(r[7])  : null,
    'estado':           r[8]  != null ? String(r[8])  : null,
    'fecha_entrega':    r[9]  != null ? String(r[9])  : null,
  }
}

function transformArticulos(r) {
  if (!r[0]) return null // Sin producto
  // Skip header rows (detectar por nombres de columnas comunes)
  const firstCell = String(r[0]).toLowerCase()
  if (firstCell === 'producto' || firstCell === 'articulo' || firstCell === 'item') return null
  // Validar que cantidad sea numérica (no header)
  if (r[2] !== null && String(r[2]).toLowerCase() === 'cantidad') return null

  return {
    'producto':         r[0]  != null ? String(r[0])  : null,
    'fecha_venta':      r[1]  != null ? String(r[1])  : null,
    'cantidad':         r[2]  != null ? String(r[2])  : null,
    'precio_unitario':  r[3]  != null ? String(r[3])  : null,
    'total':            r[4]  != null ? String(r[4])  : null,
    'cliente':          r[5]  != null ? String(r[5])  : null,
    'telefono':         r[6]  != null ? String(r[6])  : null,
  }
}

// ── UPSERT genérico por lotes vía RPC ───────────────────────────────────────

async function upsertData(records, rpcFn, tableName, step, totalSteps) {
  if (records.length === 0) {
    console.log(`\n${step}/${totalSteps} — ${tableName}: Sin datos`)
    return
  }
  console.log(`\n${step}/${totalSteps} — UPSERT ${tableName} (${records.length} filas, lotes de ${BATCH_SIZE})`)
  let done = 0

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)
    const res = await request('POST', `/rest/v1/rpc/${rpcFn}`, { data: batch })
    if (res.status !== 200 && res.status !== 204) {
      console.error(`   ❌ Error en lote ${i}: status ${res.status}`)
      console.error(`   ${res.body.slice(0, 300)}`)
      process.exit(1)
    }
    done += batch.length
    process.stdout.write(`\r   ${done}/${records.length}`)
  }
  console.log(`\n   ✅ ${tableName} actualizado`)
}

// ── Recalcular clientes y snapshots ──────────────────────────────────────────

async function recalcClientes(step, totalSteps) {
  console.log(`\n${step}/${totalSteps} — Recalculando clientes...`)
  const res = await rpc('rebuild_clientes_from_crudo')
  if (res.status !== 200) {
    console.error(`   ❌ Error: ${res.body.slice(0, 300)}`)
    process.exit(1)
  }
  const count = JSON.parse(res.body)
  console.log(`   ✅ ${count} clientes recalculados`)
}

async function refreshSnapshot(step, totalSteps) {
  console.log(`\n${step}/${totalSteps} — Generando dashboard snapshot...`)
  const res = await rpc('refresh_dashboard_snapshot_from_crudo')
  if (res.status !== 200) {
    console.error(`   ❌ Error: ${res.body.slice(0, 300)}`)
    process.exit(1)
  }
  const id = JSON.parse(res.body)
  console.log(`   ✅ Snapshot ID ${id} generado`)
}

async function snapshotSegmentos(step, totalSteps) {
  console.log(`\n${step}/${totalSteps} — Snapshot de segmentos del día...`)
  const res = await rpc('snapshot_segmentos_diario')
  if (res.status !== 200 && res.status !== 204) {
    console.error(`   ❌ Error: ${res.body.slice(0, 300)}`)
    process.exit(1)
  }
  console.log(`   ✅ Segmentos registrados`)
}

// ── Main: Flujo completo ─────────────────────────────────────────────────────

async function main() {
  const start = Date.now()
  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║  🚀 Kupe CRM — Actualización COMPLETA de datos (3 tipos)  ║')
  console.log('╚═══════════════════════════════════════════════════════════╝')

  // Leer datos de las 3 fuentes
  console.log('\n📂 Leyendo archivos de entrada...')
  console.log('\n📦 DELIVERY:')
  const delivery = readXlsxFiles(DELIVERY_DIR, transformDelivery)

  console.log('\n📋 PEDIDOS PENDIENTES:')
  const pedidosRaw = readXlsxFiles(PEDIDOS_DIR, transformPedidos)

  // Deduplicar por id_pedido, manteniendo el registro más reciente (por fecha_pedido)
  const pedidosMap = new Map()
  for (const p of pedidosRaw) {
    const existing = pedidosMap.get(p.id_pedido)
    // Si no existe o la fecha actual es más reciente, actualizar
    if (!existing || (p.fecha_pedido && (!existing.fecha_pedido || p.fecha_pedido > existing.fecha_pedido))) {
      pedidosMap.set(p.id_pedido, p)
    }
  }
  const pedidos = Array.from(pedidosMap.values())
  console.log(`   ℹ️  Deduplicación: ${pedidosRaw.length} → ${pedidos.length} únicas (mantiene más reciente)`)

  console.log('\n🍔 ARTÍCULOS VENDIDOS:')
  const articulos = readXlsxFiles(ARTICULOS_DIR, transformArticulos)

  // UPSERT con paso a paso
  const totalSteps = 8
  let currentStep = 1

  await upsertData(delivery, 'upsert_entregas', 'stg_entregas_raw', `${currentStep++}/${totalSteps} 📤`, totalSteps)
  await upsertData(pedidos, 'upsert_pedidos_pendientes', 'stg_pedidos_pendiente_raw', `${currentStep++}/${totalSteps} 📋`, totalSteps)
  await upsertData(articulos, 'upsert_articulos_ventas', 'stg_articulos_ventas_raw', `${currentStep++}/${totalSteps} 🍔`, totalSteps)

  // Recalcular datos
  await recalcClientes(`${currentStep++}/${totalSteps} 👥`, totalSteps)

  // Calcular transiciones de segmento (movimientos hoy) ANTES de generar snapshot
  console.log(`\n${currentStep}/${totalSteps} — Calculando transiciones de segmento...`)
  const resTransiciones = await rpc('calcular_transiciones_segmento_hoy')
  if (resTransiciones.status !== 200 && resTransiciones.status !== 204) {
    console.error(`   ❌ Error: ${resTransiciones.body.slice(0, 300)}`)
    process.exit(1)
  }
  console.log(`   ✅ Transiciones de segmento calculadas`)
  currentStep++

  // Ahora generar snapshot (puede leer movimientos)
  await refreshSnapshot(`${currentStep++}/${totalSteps} 📊`, totalSteps)

  await snapshotSegmentos(`${currentStep++}/${totalSteps} 📈`, totalSteps)

  const secs = ((Date.now() - start) / 1000).toFixed(1)
  console.log('\n╔═══════════════════════════════════════════════════════════╗')
  console.log(`║  ✅ Actualización completada en ${secs}s${' '.repeat(32 - secs.length)}║`)
  console.log('╚═══════════════════════════════════════════════════════════╝\n')
}

main().catch(e => {
  console.error('\n❌ Error fatal:', e.message)
  process.exit(1)
})
