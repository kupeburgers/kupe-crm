import { useState, useEffect } from 'react'
import { SUPABASE_URL, SUPABASE_ANON } from '../config'

const HEADERS = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }

// Gestiones de hoy desde DB → mapa { telefono: { id, estado, hora } }
export function useGestionesHoy() {
  const [gestiones, setGestiones] = useState(null) // null = cargando

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    fetch(
      `${SUPABASE_URL}/rest/v1/gestion_comercial?select=id,telefono,resultado,created_at&fecha_contacto=eq.${today}&order=id.asc`,
      { headers: HEADERS }
    )
      .then(r => r.json())
      .then(rows => {
        const map = {}
        ;(rows || []).forEach(r => {
          map[r.telefono] = { id: r.id, estado: r.resultado ?? 'pendiente', hora: r.created_at }
        })
        setGestiones(map)
      })
      .catch(() => setGestiones({}))
  }, [])

  return gestiones // null mientras carga, objeto cuando listo
}

// Elimina una gestión → el cliente vuelve a aparecer como no contactado
export async function resetGestion(id) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/gestion_comercial?id=eq.${id}`,
    { method: 'DELETE', headers: HEADERS }
  )
  if (!res.ok) throw new Error('reset falló')
}

// Top 20 a contactar hoy: Tibio/Enfriando/En riesgo, recencia > 7d, score DESC
export function useTop20() {
  const [clientes, setClientes] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    fetch(
      `${SUPABASE_URL}/rest/v1/clientes_live?select=nombre,telefono,recencia_dias,frecuencia,ticket_promedio,valor_total,score_comercial,segmento,ultima_compra,producto_favorito,pan_favorito,hora_habitual,total_pedidos_historial,ultimo_producto,fecha_ultimo_pedido&recencia_dias=gt.7&segmento=neq.Perdido&order=score_comercial.desc&limit=20`,
      { headers: HEADERS }
    )
      .then(r => r.json())
      .then(rows => setClientes(rows || []))
      .catch(() => setClientes([]))
      .finally(() => setLoading(false))
  }, [])

  return { clientes, loading }
}

// RPC: crear gestión (idempotente en el día)
export async function iniciarContacto(telefono, canal = 'whatsapp', accion = 'contacto_inicial') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/iniciar_contacto`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_telefono: telefono, p_canal: canal, p_accion: accion })
  })
  if (!res.ok) throw new Error('iniciar_contacto falló')
  return res.json() // bigint id
}

// RPC: actualizar resultado sobre la misma gestión
export async function cerrarGestion(id, resultado) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cerrar_gestion`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: id, p_resultado: resultado })
  })
  if (!res.ok) throw new Error('cerrar_gestion falló')
}

// Dashboard: solo las claves livianas del snapshot (sin CLIENTES)
export function useSnapshot() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(
      `${SUPABASE_URL}/rest/v1/dashboard_snapshot?select=payload->MON,payload->SEGS,payload->MOV_SEGS,payload->PRODS,payload->MAR_DIAS,payload->MAR_PEDS,payload->MAR_PRODS&order=id.desc&limit=1`,
      { headers: HEADERS }
    )
      .then(r => r.json())
      .then(rows => {
        if (rows && rows[0]) setData(rows[0])
        else setError('Sin datos')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return { data, loading, error }
}

// Teléfonos contactados (con resultado cerrado) en los últimos N días ANTES de hoy
// Usado para el cooldown: si ya lo llamaste ayer, baja en prioridad
export function useGestionesRecientes(dias = 2) {
  const [recientes, setRecientes] = useState(new Set())
  useEffect(() => {
    const desde = new Date()
    desde.setDate(desde.getDate() - (dias - 1))
    const desdeStr = desde.toISOString().split('T')[0]
    const hoy = new Date().toISOString().split('T')[0]
    fetch(
      `${SUPABASE_URL}/rest/v1/gestion_comercial?select=telefono&fecha_contacto=gte.${desdeStr}&fecha_contacto=lt.${hoy}&resultado=not.is.null`,
      { headers: HEADERS }
    )
      .then(r => r.json())
      .then(rows => setRecientes(new Set((rows || []).map(r => String(r.telefono)))))
      .catch(() => setRecientes(new Set()))
  }, [])
  return recientes
}

// Clientes "En riesgo" con score alto: última oportunidad antes de perderlos
export function useEnRiesgoUrgente(scoreMin = 70) {
  const [alertas, setAlertas] = useState([])
  useEffect(() => {
    fetch(
      `${SUPABASE_URL}/rest/v1/clientes_live?select=nombre,telefono,recencia_dias,score_comercial&segmento=eq.${encodeURIComponent('En riesgo')}&score_comercial=gt.${scoreMin}&order=score_comercial.desc&limit=8`,
      { headers: HEADERS }
    )
      .then(r => r.json())
      .then(rows => setAlertas(rows || []))
      .catch(() => setAlertas([]))
  }, [])
  return alertas
}

// CRM: clientes directos de la tabla con paginación
export function useClientes(segmento, page = 0, pageSize = 50) {
  const [clientes, setClientes] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const segFilter = segmento && segmento !== 'Todos'
      ? `&segmento=eq.${encodeURIComponent(segmento)}`
      : ''
    const from = page * pageSize
    const to = from + pageSize - 1

    fetch(
      `${SUPABASE_URL}/rest/v1/clientes_live?select=nombre,telefono,segmento,score_comercial,rank_prioridad,recencia_dias,frecuencia,valor_total,ticket_promedio,tasa_recompra_30d,tasa_recompra_60d,intervalo_promedio_dias,ultima_compra,producto_favorito,pan_favorito,hora_habitual,total_pedidos_historial,ultimo_producto,fecha_ultimo_pedido,perfil_actualizado_at${segFilter}&order=score_comercial.desc.nullslast,valor_total.desc&limit=${pageSize}&offset=${from}`,
      { headers: { ...HEADERS, 'Range-Unit': 'items', Range: `${from}-${to}`, Prefer: 'count=exact' } }
    )
      .then(r => {
        const ct = r.headers.get('Content-Range') || ''
        const tot = ct.split('/')[1]
        if (tot) setTotal(parseInt(tot))
        return r.json()
      })
      .then(rows => setClientes(rows || []))
      .catch(() => setClientes([]))
      .finally(() => setLoading(false))
  }, [segmento, page])

  return { clientes, total, loading }
}

// Resumen de artículos vendidos
export function useProductos() {
  const [productos, setProductos] = useState([])
  const [loading, setLoading]     = useState(true)
  const [meta, setMeta]           = useState(null) // { primera_venta, ultima_venta }

  useEffect(() => {
    fetch(
      `${SUPABASE_URL}/rest/v1/resumen_articulos?select=articulo,unidades_totales,facturado_total,ganancia_neta,primera_venta,ultima_venta&order=facturado_total.desc`,
      { headers: HEADERS }
    )
      .then(r => r.json())
      .then(rows => {
        setProductos(rows || [])
        if (rows && rows.length > 0) {
          const fechas = rows.map(r => r.primera_venta).filter(Boolean).sort()
          const ultimas = rows.map(r => r.ultima_venta).filter(Boolean).sort()
          setMeta({
            primera_venta: fechas[0] || null,
            ultima_venta:  ultimas[ultimas.length - 1] || null,
          })
        }
      })
      .catch(() => setProductos([]))
      .finally(() => setLoading(false))
  }, [])

  return { productos, loading, meta }
}

// Meta de datos: última carga de delivery y última actualización de perfil
export function useDatosMeta() {
  const [meta, setMeta] = useState(null)

  useEffect(() => {
    fetch(
      `${SUPABASE_URL}/rest/v1/datos_meta?select=ultima_carga_delivery,ultima_carga_perfil`,
      { headers: HEADERS }
    )
      .then(r => r.json())
      .then(rows => {
        if (rows && rows[0]) setMeta(rows[0])
      })
      .catch(() => {})
  }, [])

  return meta
}
