/**
 * update-data.js — Script de actualización de datos CRM
 *
 * Uso:
 *   node scripts/update-data.js
 *   node scripts/update-data.js "C:/ruta/delivery.xlsx"
 *
 * Pasos:
 *   1. Lee delivery.xlsx
 *   2. UPSERT en stg_entregas_raw (sin duplicar, por número de Pedido)
 *   3. rebuild_clientes_from_crudo()
 *   4. refresh_dashboard_snapshot_from_crudo()
 *   5. snapshot_segmentos_diario()
 */

const XLSX  = require('xlsx')
const https = require('https')
const path  = require('path')

const SUPABASE_URL = 'lqpzhzworncmcuptesjh.supabase.co'
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxcHpoendvcm5jbWN1cHRlc2poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDI2NDYsImV4cCI6MjA4OTUxODY0Nn0.sa4SrtesQLLpP898P4zKUGeYbbILxQ2PUoaOy-dXFjI'

const DELIVERY_DIR = 'C:/Users/kupeb/OneDrive/Escritorio/supabase crm/datos/delivery'
const BATCH_SIZE   = 500

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

// ── Leer xlsx ────────────────────────────────────────────────────────────────

const fs = require('fs')

function readDeliveryFile(filePath) {
  const wb   = XLSX.readFile(filePath)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null })
  const valid = rows.filter(r => typeof r[0] === 'number' && Number.isInteger(r[0]))
  return valid.map(r => ({
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
  }))
}

function readDelivery() {
  const files = fs.readdirSync(DELIVERY_DIR)
    .filter(f => f.toLowerCase().endsWith('.xlsx'))
    .sort()
  if (files.length === 0) {
    console.error('❌ No se encontraron archivos .xlsx en la carpeta delivery.')
    process.exit(1)
  }
  console.log(`\n📂 Archivos detectados (${files.length}):`)
  let all = []
  for (const fname of files) {
    const fullPath = `${DELIVERY_DIR}/${fname}`
    const rows = readDeliveryFile(fullPath)
    console.log(`   ${fname}: ${rows.length} filas`)
    all = all.concat(rows)
  }
  // Deduplicar en memoria por Pedido (el más reciente gana, igual que el UPSERT)
  const map = new Map()
  for (const r of all) { if (r['Pedido']) map.set(r['Pedido'], r) }
  const deduped = Array.from(map.values())
  console.log(`   Total único por Pedido: ${deduped.length}`)
  return deduped
}

// ── UPSERT por lotes vía RPC ─────────────────────────────────────────────────

async function upsertStaging(records) {
  console.log(`\n📤 Paso 1/4 — UPSERT stg_entregas_raw (${records.length} filas, lotes de ${BATCH_SIZE})`)
  let done = 0

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)
    const res = await request('POST', '/rest/v1/rpc/upsert_entregas', { data: batch })
    if (res.status !== 200) {
      console.error(`   ❌ Error en lote ${i}: status ${res.status}`)
      console.error(`   ${res.body.slice(0, 300)}`)
      process.exit(1)
    }
    done += batch.length
    process.stdout.write(`\r   Insertado: ${done}/${records.length}`)
  }
  console.log(`\n   ✅ stg_entregas_raw actualizado`)
}

// ── Paso a paso ──────────────────────────────────────────────────────────────

async function recalcClientes() {
  console.log('\n👥 Paso 2/4 — Recalculando clientes...')
  const res = await rpc('rebuild_clientes_from_crudo')
  if (res.status !== 200) {
    console.error(`   ❌ Error: ${res.body.slice(0, 300)}`)
    process.exit(1)
  }
  const count = JSON.parse(res.body)
  console.log(`   ✅ ${count} clientes recalculados`)
}

async function refreshSnapshot() {
  console.log('\n📊 Paso 3/4 — Generando dashboard snapshot...')
  const res = await rpc('refresh_dashboard_snapshot_from_crudo')
  if (res.status !== 200) {
    console.error(`   ❌ Error: ${res.body.slice(0, 300)}`)
    process.exit(1)
  }
  const id = JSON.parse(res.body)
  console.log(`   ✅ Snapshot ID ${id} generado`)
}

async function snapshotSegmentos() {
  console.log('\n📈 Paso 4/4 — Snapshot de segmentos del día...')
  const res = await rpc('snapshot_segmentos_diario')
  if (res.status !== 200 && res.status !== 204) {
    console.error(`   ❌ Error: ${res.body.slice(0, 300)}`)
    process.exit(1)
  }
  console.log(`   ✅ Segmentos registrados`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now()
  console.log('═══════════════════════════════════════')
  console.log('  🚀 Kupe CRM — Actualización de datos')
  console.log('═══════════════════════════════════════')

  const records = readDelivery()
  await upsertStaging(records)
  await recalcClientes()
  await refreshSnapshot()
  await snapshotSegmentos()

  const secs = ((Date.now() - start) / 1000).toFixed(1)
  console.log('\n═══════════════════════════════════════')
  console.log(`  ✅ Completado en ${secs}s`)
  console.log('═══════════════════════════════════════\n')
}

main().catch(e => {
  console.error('\n❌ Error fatal:', e.message)
  process.exit(1)
})
