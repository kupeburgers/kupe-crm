/**
 * update-data.cjs — Script de actualización COMPLETA de datos CRM
 *
 * Actualiza 4 fuentes de datos:
 *   1. Delivery (entregas)
 *   2. Pedidos pendientes
 *   3. Artículos vendidos
 *   4. Clientes (snapshot del ERP) — para campos del Kupe Club: puntos, mail, fecha_nacimiento, codigo
 *
 * Pasos:
 *   1. Lee delivery.xlsx → UPSERT stg_entregas_raw
 *   2. Lee pedidos*.xlsx → UPSERT stg_pedidos_pendiente_raw
 *   3. Lee articulos*.xlsx → UPSERT stg_articulos_ventas_raw
 *   4. Lee clientes*.xlsx → TRUNCATE + INSERT stg_clientes_erp
 *   5. rebuild_clientes_from_crudo()
 *   6. sync_clientes_from_erp()  ← copia puntos/mail/fecha_nac/codigo a clientes
 *   7. calcular_transiciones_segmento_hoy()
 *   8. refresh_dashboard_snapshot_from_crudo()
 *   9. snapshot_segmentos_diario()
 */

const XLSX  = require('xlsx')
const https = require('https')
const path  = require('path')
const fs    = require('fs')

// ── Cargar credenciales desde .env (en raíz del proyecto) ────────────────────
;(function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
})()

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en .env')
  console.error('   Editá: C:/Users/kupeb/OneDrive/Escritorio/supabase crm/.env')
  process.exit(1)
}

const DELIVERY_DIR  = 'C:/Users/kupeb/OneDrive/Escritorio/supabase crm/datos/delivery'
const PEDIDOS_DIR   = 'C:/Users/kupeb/OneDrive/Escritorio/supabase crm/datos/pedidos'
const ARTICULOS_DIR = 'C:/Users/kupeb/OneDrive/Escritorio/supabase crm/datos/articulos'
const CLIENTES_DIR  = 'C:/Users/kupeb/OneDrive/Escritorio/supabase crm/datos/clientes'
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
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
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

function rpc(fn, body = {}) {
  return request('POST', `/rest/v1/rpc/${fn}`, body)
}

// Convierte serial de fecha de Excel (Windows 1900) a 'YYYY-MM-DD' o null
function excelDateToIso(serial) {
  if (serial == null || serial === '' || !Number.isFinite(Number(serial))) return null
  const n = Number(serial)
  if (n <= 0) return null
  const ms = Date.UTC(1899, 11, 30) + n * 86400 * 1000
  const d  = new Date(ms)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

// ── Leer xlsx genérico ──────────────────────────────────────────────────────────

function readXlsxFiles(dir, transformer) {
  if (!fs.existsSync(dir)) {
    console.log(`   ⚠️  Carpeta no existe: ${dir}`)
    return []
  }
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
  if (!r[0]) return null
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
  if (!r[0]) return null
  const firstCell = String(r[0]).toLowerCase()
  if (firstCell === 'producto' || firstCell === 'articulo' || firstCell === 'item') return null
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

// Excel del listado de clientes del ERP:
// r[0]=Codigo  r[1]=Nombre  r[2]=Puntos  r[3]=Telefono
// r[4]=Direccion  r[5]=Mail  r[6]=Fecha Nac. (serial Excel)
function transformClientes(r) {
  if (r[0] == null && r[3] == null) return null
  if (String(r[0]).toLowerCase() === 'codigo') return null

  // Telefono: solo dígitos (descarta paréntesis, guiones, espacios)
  let tel = r[3] != null ? String(r[3]).replace(/\D/g, '') : null
  if (tel === '') tel = null

  return {
    codigo:           r[0] != null && r[0] !== '' ? String(Math.trunc(Number(r[0]))) : null,
    nombre:           r[1] != null ? String(r[1]).trim() : null,
    puntos:           r[2] != null && r[2] !== '' ? String(Math.trunc(Number(r[2]))) : null,
    telefono:         tel,
    direccion:        r[4] != null ? String(r[4]).trim() : null,
    mail:             r[5] != null ? String(r[5]).trim() : null,
    fecha_nacimiento: excelDateToIso(r[6]),
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

async function syncClientesFromErp(step, totalSteps) {
  console.log(`\n${step}/${totalSteps} — Sincronizando puntos/mail/fecha_nac/codigo a clientes...`)
  const res = await rpc('sync_clientes_from_erp')
  if (res.status !== 200) {
    console.error(`   ❌ Error: ${res.body.slice(0, 300)}`)
    process.exit(1)
  }
  const r = JSON.parse(res.body)
  console.log(`   ✅ ERP: ${r.total_erp} | clientes match: ${r.clientes_actualizados} | con puntos: ${r.clientes_con_puntos}`)
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
  console.log('║  🚀 Kupe CRM — Actualización COMPLETA de datos (4 tipos)  ║')
  console.log('╚═══════════════════════════════════════════════════════════╝')

  console.log('\n📂 Leyendo archivos de entrada...')
  console.log('\n📦 DELIVERY:')
  const delivery = readXlsxFiles(DELIVERY_DIR, transformDelivery)

  console.log('\n📋 PEDIDOS PENDIENTES:')
  const pedidosRaw = readXlsxFiles(PEDIDOS_DIR, transformPedidos)
  const pedidosMap = new Map()
  for (const p of pedidosRaw) {
    const existing = pedidosMap.get(p.id_pedido)
    if (!existing || (p.fecha_pedido && (!existing.fecha_pedido || p.fecha_pedido > existing.fecha_pedido))) {
      pedidosMap.set(p.id_pedido, p)
    }
  }
  const pedidos = Array.from(pedidosMap.values())
  console.log(`   ℹ️  Deduplicación: ${pedidosRaw.length} → ${pedidos.length} únicas (mantiene más reciente)`)

  console.log('\n🍔 ARTÍCULOS VENDIDOS:')
  const articulos = readXlsxFiles(ARTICULOS_DIR, transformArticulos)

  console.log('\n👤 CLIENTES (snapshot del ERP):')
  const clientes = readXlsxFiles(CLIENTES_DIR, transformClientes)

  const totalSteps = 10
  let currentStep = 1

  await upsertData(delivery, 'upsert_entregas',           'stg_entregas_raw',         `${currentStep++}/${totalSteps} 📤`, totalSteps)
  await upsertData(pedidos,  'upsert_pedidos_pendientes', 'stg_pedidos_pendiente_raw', `${currentStep++}/${totalSteps} 📋`, totalSteps)
  await upsertData(articulos,'upsert_articulos_ventas',   'stg_articulos_ventas_raw', `${currentStep++}/${totalSteps} 🍔`, totalSteps)

  // Clientes ERP: truncate primero, después insert por lotes
  if (clientes.length > 0) {
    console.log(`\n${currentStep}/${totalSteps} 👤 — UPSERT stg_clientes_erp (${clientes.length} filas)`)
    const tres = await rpc('truncate_stg_clientes_erp')
    if (tres.status !== 200 && tres.status !== 204) {
      console.error(`   ❌ Error truncate: ${tres.body.slice(0, 300)}`)
      process.exit(1)
    }
    let done = 0
    for (let i = 0; i < clientes.length; i += BATCH_SIZE) {
      const batch = clientes.slice(i, i + BATCH_SIZE)
      const res = await rpc('upsert_clientes_erp', { data: batch })
      if (res.status !== 200 && res.status !== 204) {
        console.error(`   ❌ Error en lote ${i}: status ${res.status}`)
        console.error(`   ${res.body.slice(0, 300)}`)
        process.exit(1)
      }
      done += batch.length
      process.stdout.write(`\r   ${done}/${clientes.length}`)
    }
    console.log(`\n   ✅ stg_clientes_erp actualizado`)
  } else {
    console.log(`\n${currentStep}/${totalSteps} 👤 — stg_clientes_erp: Sin datos`)
  }
  currentStep++

  await recalcClientes(`${currentStep++}/${totalSteps} 👥`, totalSteps)
  await syncClientesFromErp(`${currentStep++}/${totalSteps} 🔄`, totalSteps)

  console.log(`\n${currentStep}/${totalSteps} — Calculando transiciones de segmento...`)
  const resTransiciones = await rpc('calcular_transiciones_segmento_hoy')
  if (resTransiciones.status !== 200 && resTransiciones.status !== 204) {
    console.error(`   ❌ Error: ${resTransiciones.body.slice(0, 300)}`)
    process.exit(1)
  }
  console.log(`   ✅ Transiciones de segmento calculadas`)
  currentStep++

  await refreshSnapshot(`${currentStep++}/${totalSteps} 📊`, totalSteps)
  await snapshotSegmentos(`${currentStep++}/${totalSteps} 📈`, totalSteps)

  const secs = ((Date.now() - start) / 1000).toFixed(1)
  console.log('\n╔═══════════════════════════════════════════════════════════╗')
  console.log(`║  ✅ Actualización completada en ${secs}s${' '.repeat(Math.max(0, 32 - secs.length))}║`)
  console.log('╚═══════════════════════════════════════════════════════════╝\n')
}

main().catch(e => {
  console.error('\n❌ Error fatal:', e.message)
  process.exit(1)
})
