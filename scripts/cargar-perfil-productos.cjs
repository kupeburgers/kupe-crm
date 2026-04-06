// cargar-perfil-productos.cjs
// Lee cliente_perfil_productos.csv y hace upsert en la tabla clientes de Supabase
// Uso: node scripts/cargar-perfil-productos.cjs

const fs   = require('fs')
const path = require('path')

const SUPABASE_URL  = 'https://lqpzhzworncmcuptesjh.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxcHpoendvcm5jbWN1cHRlc2poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDI2NDYsImV4cCI6MjA4OTUxODY0Nn0.sa4SrtesQLLpP898P4zKUGeYbbILxQ2PUoaOy-dXFjI'
const HEADERS = {
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
  'Content-Type': 'application/json',
}

const CSV_PATH = path.join(
  'C:\\Users\\kupeb\\OneDrive\\Documentos',
  'cliente_perfil_productos.csv'
)

// ── Parse CSV simple (sin dependencias externas) ────────────────────────────
function parseCsv(text) {
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const obj = {}
    headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })
    return obj
  })
}

// ── Normalizar teléfono: quitar +54, 0, 15, espacios → 10 dígitos ──────────
function normalizarTel(raw) {
  let t = String(raw).replace(/\D/g, '')
  if (t.startsWith('549')) t = t.slice(3)
  else if (t.startsWith('54')) t = t.slice(2)
  if (t.startsWith('0'))  t = t.slice(1)
  if (t.startsWith('15')) t = t.slice(2)
  return t
}

async function main() {
  console.log('📂 Leyendo CSV...')
  const text = fs.readFileSync(CSV_PATH, 'utf8')
  const rows = parseCsv(text)
  console.log(`   ${rows.length} clientes en el CSV`)

  // Armar payload para upsert: solo campos de perfil de producto
  const payload = rows
    .filter(r => r.telefono && r.telefono !== 'nan')
    .map(r => ({
      telefono:                 normalizarTel(r.telefono),
      producto_favorito:        r.producto_favorito   || null,
      pan_favorito:             r.pan_favorito        || null,
      hora_habitual:            r.hora_habitual && r.hora_habitual !== 'nan' ? parseInt(r.hora_habitual) : null,
      total_pedidos_historial:  r.total_pedidos  ? parseInt(r.total_pedidos)  : null,
      total_gastado_historial:  r.total_gastado  ? parseInt(r.total_gastado)  : null,
    }))

  console.log(`   ${payload.length} filas a cargar`)

  // Llamar RPC actualizar_perfil_productos en lotes de 200
  // La función es SECURITY DEFINER → bypasa RLS
  const BATCH = 200
  let ok = 0, err = 0
  for (let i = 0; i < payload.length; i += BATCH) {
    const batch = payload.slice(i, i + BATCH)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/actualizar_perfil_productos`,
      { method: 'POST', headers: HEADERS, body: JSON.stringify({ data: batch }) }
    )
    if (res.ok) {
      ok += batch.length
      process.stdout.write(`\r   ✅ ${ok}/${payload.length} procesados...`)
    } else {
      const txt = await res.text()
      console.error(`\n   ❌ Error en lote ${i}-${i+BATCH}: ${txt}`)
      err += batch.length
    }
  }

  console.log(`\n\n🎉 Listo! ${ok} clientes procesados, ${err} errores`)
  if (err === 0) {
    console.log('   Las fichas del CRM ya muestran producto favorito y pan preferido.')
  }
}

main().catch(e => { console.error('Error fatal:', e); process.exit(1) })
