/**
 * recalcular-crm.cjs — Recálculo manual del CRM
 *
 * Cuándo usarlo:
 *   - Después de importar datos históricos del ERP en Supabase
 *   - Para forzar un recálculo inmediato sin esperar el cron de las 1:30 AM
 *
 * Cómo correrlo:
 *   node scripts/recalcular-crm.cjs
 */

const https = require('https')
const path  = require('path')
const fs    = require('fs')

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
  process.exit(1)
}

function rpc(fn) {
  return new Promise((resolve, reject) => {
    const body = '{}'
    const req  = https.request({
      hostname: SUPABASE_URL,
      path:     `/rest/v1/rpc/${fn}`,
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let buf = ''
      res.on('data', d => buf += d)
      res.on('end', () => resolve({ status: res.statusCode, body: buf }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function main() {
  const start = Date.now()
  console.log('╔══════════════════════════════════════╗')
  console.log('║  🔄 Kupe CRM — Recálculo manual      ║')
  console.log('╚══════════════════════════════════════╝\n')

  console.log('⏳ Ejecutando crm_recalcular_completo()...')
  const res = await rpc('crm_recalcular_completo')

  if (res.status !== 200) {
    console.error(`❌ Error ${res.status}: ${res.body.slice(0, 300)}`)
    process.exit(1)
  }

  const r = JSON.parse(res.body)
  const secs = ((Date.now() - start) / 1000).toFixed(1)

  console.log(`✅ Completado en ${secs}s`)
  console.log(`   Clientes actualizados : ${r.clientes_upserted}`)
  console.log(`   Transiciones          : ${r.transiciones}`)
  console.log(`   Dashboard rows        : ${r.dashboard_filas}`)
}

main().catch(e => {
  console.error('\n❌ Error fatal:', e.message)
  process.exit(1)
})
