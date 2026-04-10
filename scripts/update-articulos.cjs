/**
 * update-articulos.cjs — Carga artículos vendidos al CRM
 *
 * Lee todos los .xlsx de datos/articulos/, parsea por fecha/producto,
 * y hace UPSERT en stg_articulos_ventas via RPC (SECURITY DEFINER).
 *
 * Deduplicación: PRIMARY KEY (fecha, articulo) — recargar es seguro.
 */

const XLSX  = require('xlsx')
const https = require('https')
const fs    = require('fs')
const path  = require('path')

const SUPABASE_URL = 'lqpzhzworncmcuptesjh.supabase.co'
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxcHpoendvcm5jbWN1cHRlc2poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDI2NDYsImV4cCI6MjA4OTUxODY0Nn0.sa4SrtesQLLpP898P4zKUGeYbbILxQ2PUoaOy-dXFjI'

const ARTICULOS_DIR = 'C:/Users/kupeb/OneDrive/Escritorio/supabase crm/datos/articulos'
const BATCH_SIZE    = 500

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function rpcPost(fn, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req  = https.request({
      hostname: SUPABASE_URL,
      path:     `/rest/v1/rpc/${fn}`,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'apikey':         ANON_KEY,
        'Authorization':  `Bearer ${ANON_KEY}`,
        'Content-Length': Buffer.byteLength(data),
      }
    }, res => {
      let buf = ''
      res.on('data', d => buf += d)
      res.on('end', () => resolve({ status: res.statusCode, body: buf }))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

// ── Parsear un xlsx de artículos ─────────────────────────────────────────────
// Formato: fila de título, fila de headers, fila vacía, luego bloques por fecha
// Separadores de fecha: celda[0] con formato DD/MM/YYYY
// Totales: celda[0] empieza con "Total"
// Productos: los demás

function parseArchivoArticulos(filePath) {
  const wb   = XLSX.readFile(filePath)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null })

  const records = []
  let fechaActual = null

  for (const row of rows) {
    const c0 = row[0] != null ? String(row[0]).trim() : ''
    if (!c0) continue

    // Detectar fila de fecha: formato DD/MM/YYYY
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(c0)) {
      const [d, m, y] = c0.split('/')
      fechaActual = `${y}-${m}-${d}`  // ISO para Postgres
      continue
    }

    // Ignorar título, headers, totales
    if (c0.toLowerCase().startsWith('total')) continue
    if (c0.toLowerCase().startsWith('articulo')) continue
    if (c0.toLowerCase().startsWith('articulos vendidos')) continue

    // Fila de producto: necesita fecha activa y cantidad numérica
    if (!fechaActual) continue
    const cantidad = row[2]
    if (cantidad == null || isNaN(Number(cantidad))) continue

    records.push({
      fecha:         fechaActual,
      articulo:      c0.toUpperCase().trim(),
      codigo:        row[1] != null ? String(row[1]) : null,
      cantidad:      Math.round(Number(cantidad)),
      neto:          row[3] != null ? Number(row[3]) : null,
      total:         row[4] != null ? Number(row[4]) : null,
      costo:         row[5] != null ? Number(row[5]) : null,
      utilidad:      row[6] != null ? Number(row[6]) : null,
      utilidad_neto: row[7] != null ? Number(row[7]) : null,
    })
  }

  return records
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now()
  console.log('═══════════════════════════════════════════')
  console.log('  🚀 Kupe CRM — Artículos Vendidos')
  console.log('═══════════════════════════════════════════')

  // Detectar todos los xlsx
  const files = fs.readdirSync(ARTICULOS_DIR)
    .filter(f => f.toLowerCase().endsWith('.xlsx'))
    .sort()

  if (files.length === 0) {
    console.error('❌ No se encontraron archivos .xlsx en la carpeta articulos.')
    process.exit(1)
  }

  console.log(`\n📂 Archivos detectados (${files.length}):`)

  // Parsear todos y deduplicar por (fecha, articulo)
  const map = new Map()
  for (const fname of files) {
    const fullPath = `${ARTICULOS_DIR}/${fname}`
    const rows = parseArchivoArticulos(fullPath)
    console.log(`   ${fname}: ${rows.length} filas`)
    for (const r of rows) {
      map.set(`${r.fecha}|${r.articulo}`, r)
    }
  }

  const records = Array.from(map.values())
  console.log(`\n   Total único por (fecha, articulo): ${records.length}`)

  // Subir en lotes vía RPC
  console.log(`\n📤 Subiendo a Supabase (lotes de ${BATCH_SIZE})...`)
  let done = 0

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)
    const res = await rpcPost('upsert_articulos_ventas', { data: batch })
    if (res.status !== 200) {
      console.error(`\n   ❌ Error en lote ${i}: status ${res.status}`)
      console.error(`   ${res.body.slice(0, 300)}`)
      process.exit(1)
    }
    done += batch.length
    process.stdout.write(`\r   Procesados: ${done}/${records.length}`)
  }

  // Resumen
  const secs = ((Date.now() - start) / 1000).toFixed(1)
  const fechas = [...new Set(records.map(r => r.fecha))].sort()
  const totalUnidades = records.reduce((s, r) => s + (r.cantidad || 0), 0)
  const totalFacturado = records.reduce((s, r) => s + (r.total || 0), 0)

  console.log('\n\n═══════════════════════════════════════════')
  console.log('  RESUMEN')
  console.log('═══════════════════════════════════════════')
  console.log(`  Archivos procesados  : ${files.length}`)
  console.log(`  Filas únicas         : ${records.length}`)
  console.log(`  Período              : ${fechas[0]} → ${fechas[fechas.length - 1]}`)
  console.log(`  Unidades totales     : ${totalUnidades.toLocaleString('es-AR')}`)
  console.log(`  Facturación total    : $${Math.round(totalFacturado).toLocaleString('es-AR')}`)
  console.log(`  Completado en        : ${secs}s`)
  console.log('═══════════════════════════════════════════\n')
}

main().catch(e => {
  console.error('\n❌ Error fatal:', e.message)
  process.exit(1)
})
