import { useState, useEffect, useRef } from 'react'
import { useSnapshot, useClientes, useGestionesHoy, useGestionesRecientes, useEnRiesgoUrgente, iniciarContacto, cerrarGestion, resetGestion, useDatosMeta, useProductos, guardarContactoHistorial, actualizarResultadoHistorial, useConversiones } from '../hooks/useSnapshot'
import { useAccionHoy } from '../hooks/useAccionHoy'
import { getPlantillas, savePlantillas, buildMessage, PLANTILLAS_DEFAULT } from '../config/templates'

const fmt = n => n >= 1_000_000 ? `$${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n/1_000).toFixed(0)}K` : `$${Math.round(n)}`
const SEG_COLORS = { 'Activo':'#00a65a','Tibio':'#d97700','Enfriando':'#c05a00','En riesgo':'#cc2222','Perdido':'#666' }
const SEG_ICONS  = { 'Activo':'🟢','Tibio':'🎯','Enfriando':'🟠','En riesgo':'🔴','Perdido':'⬛' }
const SEG_ORDER  = ['Activo','Tibio','Enfriando','En riesgo','Perdido']

const RESULTADO_LABEL = {
  respondio:    { icon: '💬', texto: 'Respondió',    color: '#3b82f6' },
  compro:       { icon: '🛒', texto: 'Compró',        color: '#00a65a' },
  no_respondio: { icon: '📵', texto: 'Sin respuesta', color: '#6b7280' },
  no_compro:    { icon: '❌', texto: 'No compró',     color: '#9ca3af' },
}

function scoreClass(sc) {
  if (sc >= 70) return 'score-high'
  if (sc >= 40) return 'score-mid'
  return 'score-low'
}

// ── Tab Hoy ────────────────────────────────────────────────────────────────────
const PRIORIDAD_ESTADO = { null: 0, pendiente: 1, respondio: 2, compro: 2, no_respondio: 2, no_compro: 2 }

const FILTROS = [
  { key: 'todos',           label: 'Todos'          },
  { key: 'sin_contactar',   label: 'Pendientes'     },
  { key: 'pendiente',       label: 'Contactados'    },
  { key: 'compro',          label: 'Compraron'      },
  { key: 'respondio',       label: 'Respondieron'   },
  { key: 'no_respondio',    label: 'No respondieron'},
  { key: 'no_compro',       label: 'No compraron'   },
]

function matchFiltro(estado, filtro) {
  if (filtro === 'todos')         return true
  if (filtro === 'sin_contactar') return estado === null
  return estado === filtro
}

function TabHoy({ overrides, setOverrides }) {
  const { clientes, loading: loadingCli, error } = useAccionHoy()
  const gestionesDB    = useGestionesHoy()   // null = cargando, {} = listo (puede estar vacío)
  const [filtro, setFiltro]       = useState('sin_contactar')
  const [modalInfo, setModalInfo] = useState(null)   // null | { cliente, texto }
  const [cambiando, setCambiando] = useState(new Set()) // teléfonos en modo "cambiar resultado"

  const recientes     = useGestionesRecientes(2)   // teléfonos contactados ayer (cooldown)
  const enRiesgo      = useEnRiesgoUrgente(70)       // En riesgo con score > 70

  // IMPORTANTE: No bloquear por gestionesDB. Si está null, usar {} (sin gestiones)
  const loading = loadingCli
  const gestionsDB_safe = gestionesDB ?? {}

  // Estado efectivo = DB (persistido) sobreescrito por acciones de esta sesión
  const getEstado    = tel => overrides[tel]?.estado ?? gestionsDB_safe?.[tel]?.estado ?? null
  const getGestionId = tel => overrides[tel]?.id     ?? gestionesDB?.[tel]?.id     ?? null
  const getHora      = tel => {
    const raw = overrides[tel]?.hora ?? gestionesDB?.[tel]?.hora ?? null
    if (!raw) return null
    return new Date(raw).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  }

  // Estado con cooldown: si fue contactado ayer y hoy no tiene gestión → 'contactado_ayer'
  const getEstadoEfectivo = tel => {
    const est = getEstado(tel)
    if (est === null && recientes && recientes.has(String(tel))) return 'contactado_ayer'
    return est
  }

  // Bonus de urgencia por recencia (solo afecta sort interno de pendientes frescos)
  function urgencyBonus(dias) {
    if (dias >= 50) return 15
    if (dias >= 35) return 8
    if (dias >= 25) return 3
    return 0
  }

  // Prioridad extendida: contactado_ayer va después de cerrados
  const PRIORIDAD_EXT = { ...PRIORIDAD_ESTADO, contactado_ayer: 3 }

  // Orden: frescos → contactados hoy → cerrados → contactados ayer
  const clientesOrdenados = [...clientes].sort((a, b) => {
    const pa = PRIORIDAD_EXT[getEstadoEfectivo(a.telefono)] ?? 0
    const pb = PRIORIDAD_EXT[getEstadoEfectivo(b.telefono)] ?? 0
    if (pa !== pb) return pa - pb
    if (pa === 0) {
      const sa = Number(a.score_comercial || 0) + urgencyBonus(a.recencia_dias)
      const sb = Number(b.score_comercial || 0) + urgencyBonus(b.recencia_dias)
      return sb - sa
    }
    return Number(b.score_comercial) - Number(a.score_comercial)
  })

  // Resumen del día (desde estado actual)
  const totalContactados = clientes.filter(c => getEstado(c.telefono) !== null).length
  const totalCompraron   = clientes.filter(c => getEstado(c.telefono) === 'compro').length
  const totalRespondieron= clientes.filter(c => getEstado(c.telefono) === 'respondio').length
  const tasaConversion   = totalContactados > 0 ? Math.round((totalCompraron / totalContactados) * 100) : 0

  // Conteos para la barra de filtros (usa estado real de hoy, sin cooldown)
  const conteos = {
    todos:         clientes.length,
    sin_contactar: clientes.filter(c => getEstadoEfectivo(c.telefono) === null || getEstadoEfectivo(c.telefono) === 'contactado_ayer').length,
    pendiente:     clientes.filter(c => getEstado(c.telefono) === 'pendiente').length,
    compro:        clientes.filter(c => getEstado(c.telefono) === 'compro').length,
    respondio:     clientes.filter(c => getEstado(c.telefono) === 'respondio').length,
    no_respondio:  clientes.filter(c => getEstado(c.telefono) === 'no_respondio').length,
    no_compro:     clientes.filter(c => getEstado(c.telefono) === 'no_compro').length,
  }

  const clientesFiltrados = clientesOrdenados.filter(c => matchFiltro(getEstado(c.telefono), filtro))

  // Abre el modal con mensaje pre-llenado — NO crea gestión todavía
  function handleAbrirModal(c) {
    const plantillas = getPlantillas()
    const template   = plantillas[c.segmento] || ''
    setModalInfo({
      cliente: c,
      texto: c.mensaje_sugerido || buildMessage(template, c),
      accionSugerida: c.accion_sugerida,
      urgencia: c.urgencia
    })
  }

  // Confirmación: crea gestión → abre WhatsApp → cierra modal
  async function handleEnviarWhatsApp(cliente, texto) {
    try {
      const id = await iniciarContacto(cliente.telefono)
      setOverrides(o => ({ ...o, [cliente.telefono]: { id, estado: 'pendiente' } }))
      const tel = String(cliente.telefono).replace(/\D/g, '')
      window.open(`https://wa.me/549${tel}?text=${encodeURIComponent(texto)}`, '_blank')
      // Persistir en histórico en segundo plano (no bloquear si falla)
      guardarContactoHistorial(cliente.telefono, 'whatsapp', 'contacto_inicial').catch(() => {})
    } catch {
      // Si falla la RPC no abrimos WhatsApp ni actualizamos estado
    }
    setModalInfo(null)
  }

  async function handleReset(telefono) {
    const id = getGestionId(telefono)
    if (!id) return
    setCambiando(s => { const n = new Set(s); n.delete(telefono); return n })
    try {
      await resetGestion(id)
      // Forzar estado null: el cliente vuelve a la lista como no contactado
      setOverrides(o => ({ ...o, [telefono]: { id: null, estado: null, hora: null } }))
    } catch { /* silencioso — no cambia nada si falla */ }
  }

  async function handleResultado(telefono, resultado) {
    const id = getGestionId(telefono)
    setOverrides(o => ({ ...o, [telefono]: { id, estado: 'cerrando' } }))
    try {
      await cerrarGestion(id, resultado)
      setOverrides(o => ({ ...o, [telefono]: { id, estado: resultado } }))
      // Persistir resultado en histórico en segundo plano (no bloquear si falla)
      actualizarResultadoHistorial(telefono, resultado).catch(() => {})
    } catch {
      setOverrides(o => ({ ...o, [telefono]: { id, estado: 'pendiente' } }))
    }
  }

  if (loading) return <div className="loading">Cargando lista de hoy...</div>

  return (
    <>
    {modalInfo && (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:1000, display:'flex', alignItems:'flex-end', justifyContent:'center' }}
           onClick={e => e.target === e.currentTarget && setModalInfo(null)}>
        <div style={{ background:'#fff', borderRadius:'20px 20px 0 0', padding:24, width:'100%', maxWidth:600, maxHeight:'85vh', overflowY:'auto' }}>
          {/* Header */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
            <div>
              <div style={{ fontWeight:700, fontSize:17 }}>{modalInfo.cliente.nombre || modalInfo.cliente.cliente || 'Sin nombre'}</div>
              <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:4 }}>
                <span className="seg-tag" style={{ background: SEG_COLORS[modalInfo.cliente.segmento] || '#666' }}>
                  {SEG_ICONS[modalInfo.cliente.segmento]} {modalInfo.cliente.segmento}
                </span>
                <span style={{ fontSize:12, color:'#9ca3af' }}>{modalInfo.cliente.recencia_dias}d sin comprar</span>
              </div>
            </div>
            <button onClick={() => setModalInfo(null)}
              style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#9ca3af', lineHeight:1 }}>✕</button>
          </div>

          {/* BADGE DE URGENCIA */}
          {modalInfo.urgencia && (
            <div style={{
              padding: '10px 12px',
              borderRadius: '8px',
              marginBottom: '14px',
              background: modalInfo.urgencia === 'alta' ? '#fee2e2' : modalInfo.urgencia === 'media' ? '#fef3c7' : '#f0fdf4',
              color: modalInfo.urgencia === 'alta' ? '#7f1d1d' : modalInfo.urgencia === 'media' ? '#92400e' : '#166534',
              fontWeight: '600',
              fontSize: '13px'
            }}>
              {modalInfo.urgencia === 'alta' ? '🔴 URGENCIA ALTA' : modalInfo.urgencia === 'media' ? '🟠 Urgencia Media' : '🟢 Baja Urgencia'}
              {modalInfo.accionSugerida && (
                <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.85, fontWeight: '500' }}>
                  Acción: {modalInfo.accionSugerida}
                </div>
              )}
            </div>
          )}
          {/* Mensaje editable */}
          <div style={{ fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>
            Mensaje — editá si querés
          </div>
          <textarea
            value={modalInfo.texto}
            onChange={e => setModalInfo(m => ({ ...m, texto: e.target.value }))}
            rows={6}
            style={{ width:'100%', border:'1px solid #e5e7eb', borderRadius:10, padding:12, fontSize:14, resize:'vertical', outline:'none', fontFamily:'inherit', lineHeight:1.5 }}
          />
          {/* Acciones */}
          <div style={{ display:'flex', gap:8, marginTop:14 }}>
            <button onClick={() => setModalInfo(null)}
              style={{ flex:1, padding:'12px', border:'1px solid #e5e7eb', borderRadius:10, background:'#fff', fontWeight:600, cursor:'pointer', fontSize:14 }}>
              Cancelar
            </button>
            <button
              onClick={() => handleEnviarWhatsApp(modalInfo.cliente, modalInfo.texto)}
              disabled={!modalInfo.texto.trim()}
              style={{ flex:2, padding:'12px', background:'#16a34a', color:'#fff', border:'none', borderRadius:10, fontWeight:700, cursor:'pointer', fontSize:15 }}>
              💬 Enviar por WhatsApp
            </button>
          </div>
        </div>
      </div>
    )}
    <div className="section">
      <div className="section-title">
        📋 A contactar hoy — Top 20
        <span style={{ fontWeight: 400, color: '#aaa', marginLeft: 8, fontSize: 13 }}>
          pendientes primero · por score
        </span>
      </div>

      {/* RESUMEN DEL DÍA */}
      {totalContactados > 0 && (
        <div className="resumen-dia">
          <span className="resumen-stat"><strong>{totalContactados}</strong> contactados</span>
          <span className="resumen-stat"><strong>{totalCompraron}</strong> compraron</span>
          {totalRespondieron > 0 && (
            <span className="resumen-stat"><strong>{totalRespondieron}</strong> respondieron</span>
          )}
          <span className="resumen-conversion" style={{ color: tasaConversion >= 30 ? '#16a34a' : tasaConversion >= 15 ? '#d97700' : '#6b7280' }}>
            {tasaConversion}% conversión
          </span>
        </div>
      )}

      {/* ALERTA EN RIESGO URGENTE — oculta los ya contactados hoy */}
      {(() => {
        const pendientes = enRiesgo.filter(c => {
          const est = overrides[c.telefono]?.estado ?? gestionesDB?.[c.telefono]?.estado ?? null
          return est === null  // solo mostrar los que no fueron contactados hoy
        })
        if (!pendientes.length) return null
        return (
          <div className="alerta-riesgo" style={{ borderLeft: '4px solid #dc2626' }}>
            <div className="alerta-riesgo-title">
              🚨 {pendientes.length} cliente{pendientes.length > 1 ? 's' : ''} En riesgo sin contactar hoy — score alto
            </div>
            <div style={{ fontSize: 12, color: '#b45309', marginBottom: 8, fontWeight: 400 }}>
              Si no los contactás esta semana, pasan a <strong>Perdido</strong> y se vuelven muy difíciles de recuperar.
            </div>
            <div className="alerta-riesgo-list">
              {pendientes.slice(0, 4).map(c => {
                const diasParaPerdido = Math.max(0, 120 - (c.recencia_dias || 0))
                return (
                  <div key={c.telefono} className="alerta-riesgo-item" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600 }}>{c.nombre || c.telefono}</span>
                      <button
                        className="btn-accion"
                        style={{ background: '#dc2626', fontSize: 12, padding: '5px 12px' }}
                        onClick={() => handleAbrirModal(c)}
                      >
                        💬 Contactar ahora
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#6b7280' }}>
                      <span>⏱ {c.recencia_dias}d sin comprar</span>
                      <span>🏆 Score {c.score_comercial}</span>
                      {diasParaPerdido <= 30
                        ? <span style={{ color: '#dc2626', fontWeight: 600 }}>⚠️ Pasa a Perdido en ~{diasParaPerdido}d</span>
                        : <span>🗓 ~{diasParaPerdido}d para Perdido</span>
                      }
                    </div>
                  </div>
                )
              })}
              {pendientes.length > 4 && (
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                  + {pendientes.length - 4} más — buscalos en la lista Clientes → En riesgo
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* BARRA DE FILTROS CON CONTEOS */}
      <div className="seg-filter-row" style={{ marginBottom: 16 }}>
        {FILTROS.map(f => (
          <button
            key={f.key}
            className={`seg-btn ${filtro === f.key ? 'active' : ''}`}
            style={filtro === f.key ? { background: '#4f8ef7', color: '#fff', borderColor: 'transparent' } : {}}
            onClick={() => setFiltro(f.key)}
          >
            {f.label} <span style={{ opacity: 0.75, fontSize: 11 }}>({conteos[f.key]})</span>
          </button>
        ))}
      </div>

      {clientesFiltrados.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#aaa', fontSize: 14 }}>
          No hay clientes en esta categoría hoy
        </div>
      ) : (
        <div className="hoy-list">
          {clientesFiltrados.map(c => {
            const estado = getEstado(c.telefono)
            const res    = RESULTADO_LABEL[estado]

            const estadoEfectivo = getEstadoEfectivo(c.telefono)

            // Card border / background class
            const cerrado   = res != null
            const urgenciaCard = c.recencia_dias >= 50 ? 'urgencia-alta'
                               : c.recencia_dias >= 35 ? 'urgencia-media'
                               : 'urgencia-baja'
            const cardClass = cerrado
              ? `cliente-card estado-${estado}`
              : estado === 'pendiente'
                ? 'cliente-card estado-pendiente'
                : estadoEfectivo === 'contactado_ayer'
                  ? 'cliente-card estado-no_compro'   // visual apagado
                  : `cliente-card ${urgenciaCard}`

            // Days urgency class (badge dentro de la card)
            const diasClass = c.recencia_dias > 60 ? 'urgente' : c.recencia_dias > 30 ? 'medio' : 'ok'

            return (
              <div key={c.telefono} className={cardClass}>

                {/* TOP ROW: segment · days · score */}
                <div className="card-top">
                  <span className="seg-tag" style={{ background: SEG_COLORS[c.segmento] || '#666' }}>
                    {SEG_ICONS[c.segmento]} {c.segmento}
                  </span>
                  <span className={`card-dias ${diasClass}`}>{c.recencia_dias}d</span>
                  <span className="card-score">
                    {c.score_comercial}<span className="card-score-label">pts</span>
                  </span>
                </div>

                {/* BADGE DE URGENCIA Y ACCIÓN SUGERIDA */}
                {c.urgencia && (
                  <div style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    marginTop: '8px',
                    marginBottom: '8px',
                    background: c.urgencia === 'alta' ? '#fee2e2' : c.urgencia === 'media' ? '#fef3c7' : '#f0fdf4',
                    color: c.urgencia === 'alta' ? '#7f1d1d' : c.urgencia === 'media' ? '#92400e' : '#166534',
                    fontWeight: '600',
                    fontSize: '12px'
                  }}>
                    {c.urgencia === 'alta' ? '🔴' : c.urgencia === 'media' ? '🟠' : '🟢'} {c.accion_sugerida || 'Seguimiento'}
                  </div>
                )}

                {/* NAME */}
                <div className="card-nombre">{c.nombre || <span style={{ color: '#ccc' }}>Sin nombre</span>}</div>

                {/* PERFIL DE PRODUCTO — línea compacta accionable */}
                {(c.producto_favorito || c.ultimo_producto) && (() => {
                  const cap  = s => s ? s.toLowerCase().replace(/\b\w/g, l => l.toUpperCase()) : null
                  const fav  = cap(c.producto_favorito)
                  const ult  = cap(c.ultimo_producto)
                  const pan  = c.pan_favorito ? ` c/${c.pan_favorito}` : ''
                  const hora = c.hora_habitual != null ? ` · ~${c.hora_habitual}hs` : ''
                  const texto = (fav && ult && fav !== ult)
                    ? `último: ${ult} · fav: ${fav}${pan}${hora}`
                    : `siempre pide: ${fav || ult}${pan}${hora}`
                  return (
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, lineHeight: 1.4 }}>
                      {texto}
                    </div>
                  )
                })()}

                {/* MENSAJE SUGERIDO */}
                {c.mensaje_sugerido && (
                  <div style={{
                    fontSize: 12,
                    color: '#555',
                    marginBottom: 8,
                    padding: '8px',
                    background: '#f9fafb',
                    borderRadius: '6px',
                    borderLeft: '3px solid #4f8ef7',
                    lineHeight: 1.4,
                    fontStyle: 'italic'
                  }}>
                    💬 "{c.mensaje_sugerido}"
                  </div>
                )}

                {/* SECONDARY INFO */}
                <div className="card-info">
                  <span>📞 {c.telefono}</span>
                  <span>{c.total_pedidos_historial ?? c.frecuencia} ped.</span>
                  <span>{fmt(c.ticket_promedio)} tk</span>
                  <span>{fmt(c.valor_total)} total</span>
                </div>

                {/* ACTIONS */}
                {estado === null && estadoEfectivo !== 'contactado_ayer' && (
                  <button className="btn-contactar" onClick={() => handleAbrirModal(c)}>
                    💬 Contactar por WhatsApp
                  </button>
                )}

                {estadoEfectivo === 'contactado_ayer' && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span className="badge-ayer">📅 Contactado ayer</span>
                    <button
                      style={{ fontSize: 11, padding: '4px 10px', background: 'none', border: '1px solid #d1d5db', borderRadius: 6, color: '#6b7280', cursor: 'pointer' }}
                      onClick={() => handleAbrirModal(c)}
                    >
                      Intentar igual
                    </button>
                  </div>
                )}

                {estado === 'cargando' && (
                  <div className="card-loading">Registrando contacto...</div>
                )}

                {estado === 'pendiente' && (
                  <div className="btn-resultado-grid">
                    <button className="btn-res respondio"  onClick={() => handleResultado(c.telefono, 'respondio')}>💬 Respondió</button>
                    <button className="btn-res compro"     onClick={() => handleResultado(c.telefono, 'compro')}>🛒 Compró</button>
                    <button className="btn-res no_respondio" onClick={() => handleResultado(c.telefono, 'no_respondio')}>📵 Sin respuesta</button>
                    <button className="btn-res no_compro"  onClick={() => handleResultado(c.telefono, 'no_compro')}>❌ No compró</button>
                  </div>
                )}

                {estado === 'cerrando' && (
                  <div className="card-loading">Guardando resultado...</div>
                )}

                {res && !cambiando.has(c.telefono) && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className={`result-badge ${estado}`} style={{ flex: 1 }}>
                        {res.icon} {res.texto}
                      </div>
                      <button
                        onClick={() => setCambiando(s => new Set([...s, c.telefono]))}
                        style={{ fontSize: 11, padding: '4px 9px', background: 'none', border: '1px solid #d1d5db', borderRadius: 6, color: '#6b7280', cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        ✏️ Cambiar
                      </button>
                    </div>
                    {getHora(c.telefono) && (
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 5 }}>
                        🕐 Contactado a las {getHora(c.telefono)}
                      </div>
                    )}
                  </div>
                )}

                {/* estado pendiente (contactado sin resultado) también muestra hora */}
                {estado === 'pendiente' && getHora(c.telefono) && (
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: -8, marginBottom: 4 }}>
                    🕐 Contactado a las {getHora(c.telefono)}
                  </div>
                )}

                {res && cambiando.has(c.telefono) && (
                  <div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>
                      Estaba: {res.icon} {res.texto} — ¿qué pasó en realidad?
                    </div>
                    <div className="btn-resultado-grid">
                      {Object.entries(RESULTADO_LABEL).map(([key, val]) => (
                        <button key={key} className={`btn-res ${key}`}
                          onClick={() => {
                            setCambiando(s => { const n = new Set(s); n.delete(c.telefono); return n })
                            handleResultado(c.telefono, key)
                          }}>
                          {val.icon} {val.texto}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        onClick={() => handleReset(c.telefono)}
                        style={{ flex: 1, fontSize: 12, padding: '7px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}
                      >
                        ↩️ No lo contacté — quitar
                      </button>
                      <button
                        onClick={() => setCambiando(s => { const n = new Set(s); n.delete(c.telefono); return n })}
                        style={{ fontSize: 12, padding: '7px 12px', background: 'none', border: '1px solid #e5e7eb', borderRadius: 7, color: '#9ca3af', cursor: 'pointer' }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

              </div>
            )
          })}
        </div>
      )}
    </div>
    </>
  )
}

// ── Tab Plantillas ─────────────────────────────────────────────────────────────
const SEGS_PLANTILLAS = ['Activo', 'Tibio', 'Enfriando', 'En riesgo', 'Perdido']

const PREVIEW_POR_SEG = {
  Activo:     { nombre:'Juan García',    recencia_dias:8,   frecuencia:15, ticket_promedio:42000, ultima_compra:'29/03/2026', segmento:'Activo',    producto_favorito:'CRISPY DOBLE',       ultimo_producto:'CRISPY DOBLE',       pan_favorito:'Pan De Papa',   hora_habitual:21, fecha_ultimo_pedido:'2026-03-29' },
  Tibio:      { nombre:'Lucas Marotta',  recencia_dias:22,  frecuencia:10, ticket_promedio:38000, ultima_compra:'15/03/2026', segmento:'Tibio',     producto_favorito:'CHEESE BACON DOBLE', ultimo_producto:'CHEESE BACON DOBLE', pan_favorito:'Pan Parmesano', hora_habitual:22, fecha_ultimo_pedido:'2026-03-15' },
  Enfriando:  { nombre:'Agustín Solari', recencia_dias:45,  frecuencia:8,  ticket_promedio:43000, ultima_compra:'22/02/2026', segmento:'Enfriando', producto_favorito:'DELUXE DOBLE',       ultimo_producto:'CUARTO DOBLE',       pan_favorito:'Pan De Papa',   hora_habitual:21, fecha_ultimo_pedido:'2026-02-22' },
  'En riesgo':{ nombre:'Martina Sosa',   recencia_dias:75,  frecuencia:6,  ticket_promedio:48000, ultima_compra:'21/01/2026', segmento:'En riesgo', producto_favorito:'CUARTO DOBLE',       ultimo_producto:'ARGENTA SIMPLE',     pan_favorito:'Pan Parmesano', hora_habitual:null, fecha_ultimo_pedido:'2026-01-21' },
  Perdido:    { nombre:'Jorge Pérez',    recencia_dias:130, frecuencia:4,  ticket_promedio:46000, ultima_compra:'28/11/2025', segmento:'Perdido',   producto_favorito:'ARGENTA DOBLE',      ultimo_producto:'ARGENTA DOBLE',      pan_favorito:'Pan De Papa',   hora_habitual:23, fecha_ultimo_pedido:'2025-11-28' },
}

function TabPlantillas() {
  const [plantillas, setPlantillas] = useState(() => getPlantillas())
  const [savedMsg, setSavedMsg]     = useState('')

  function handleSave() {
    savePlantillas(plantillas)
    setSavedMsg('✅ Guardado')
    setTimeout(() => setSavedMsg(''), 2000)
  }

  function handleRestore(seg) {
    setPlantillas(p => ({ ...p, [seg]: PLANTILLAS_DEFAULT[seg] }))
  }

  return (
    <div>
      <div style={{ fontSize:13, color:'#6b7280', marginBottom:20, lineHeight:1.6 }}>
        Usá <code style={{ background:'#f3f4f6', padding:'1px 5px', borderRadius:4 }}>{'{nombre}'}</code>{' '}
        <code style={{ background:'#f3f4f6', padding:'1px 5px', borderRadius:4 }}>{'{dias}'}</code>{' '}
        <code style={{ background:'#f3f4f6', padding:'1px 5px', borderRadius:4 }}>{'{ultima_compra}'}</code>{' '}
        <code style={{ background:'#f3f4f6', padding:'1px 5px', borderRadius:4 }}>{'{ticket}'}</code>{' '}
        <code style={{ background:'#f3f4f6', padding:'1px 5px', borderRadius:4 }}>{'{pedidos}'}</code>{' '}
        <code style={{ background:'#f3f4f6', padding:'1px 5px', borderRadius:4 }}>{'{segmento}'}</code>
      </div>

      {SEGS_PLANTILLAS.map(seg => {
        const preview = buildMessage(plantillas[seg] || '', PREVIEW_POR_SEG[seg])
        return (
          <div key={seg} className="section" style={{ marginBottom:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <span className="seg-tag" style={{ background: SEG_COLORS[seg] || '#666', fontSize:13, padding:'4px 12px' }}>
                {SEG_ICONS[seg]} {seg}
              </span>
              <button onClick={() => handleRestore(seg)} className="btn-accion"
                style={{ background:'#6b7280', fontSize:11 }}>
                Restaurar default
              </button>
            </div>
            <textarea
              value={plantillas[seg] || ''}
              onChange={e => setPlantillas(p => ({ ...p, [seg]: e.target.value }))}
              rows={4}
              style={{ width:'100%', border:'1px solid #e5e7eb', borderRadius:8, padding:10, fontSize:13, resize:'vertical', outline:'none', fontFamily:'inherit', lineHeight:1.5 }}
            />
            {/* Vista previa */}
            <div style={{ marginTop:10, padding:12, background:'#f9fafb', borderRadius:8, borderLeft:'3px solid ' + (SEG_COLORS[seg] || '#e5e7eb') }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>
                Vista previa — {PREVIEW_POR_SEG[seg].nombre}
              </div>
              <div style={{ fontSize:13, color:'#374151', lineHeight:1.6, whiteSpace:'pre-wrap' }}>{preview}</div>
            </div>
          </div>
        )
      })}

      <div style={{ textAlign:'center', padding:'8px 0 24px' }}>
        <button onClick={handleSave} className="btn-contactar"
          style={{ display:'inline-block', width:'auto', padding:'11px 48px', fontSize:14 }}>
          {savedMsg || '💾 Guardar plantillas'}
        </button>
      </div>
    </div>
  )
}

// ── Tab Acciones ───────────────────────────────────────────────────────────────
function TabAcciones({ overrides }) {
  const { clientes } = useTop20()
  const gestionesDB  = useGestionesHoy()

  if (!gestionesDB) return <div className="loading">Cargando acciones...</div>

  const acciones = Object.entries(gestionesDB)
    // Si en esta sesión se hizo reset (estado === null), excluir de acciones
    .filter(([tel]) => overrides[tel]?.estado !== null || !(tel in (overrides || {})))
    .map(([tel, g]) => {
      // Usar el estado del override si existe (ej: resultado cambiado en sesión)
      const estadoFinal = overrides[tel]?.estado !== undefined ? overrides[tel].estado : g.estado
      const horaFinal   = overrides[tel]?.hora   !== undefined ? overrides[tel].hora   : g.hora
      const cli = clientes.find(c => String(c.telefono) === String(tel))
      return { telefono: tel, id: g.id, estado: estadoFinal, hora: horaFinal, nombre: cli?.nombre || tel, segmento: cli?.segmento }
    })
    .sort((a, b) => new Date(b.hora || 0) - new Date(a.hora || 0))

  if (acciones.length === 0) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
      Todavía no contactaste a nadie hoy
    </div>
  )

  const compraron   = acciones.filter(a => a.estado === 'compro').length
  const respondieron= acciones.filter(a => a.estado === 'respondio').length
  const sinResp     = acciones.filter(a => a.estado === 'no_respondio').length
  const pendientes  = acciones.filter(a => a.estado === 'pendiente').length

  return (
    <div className="section">
      {/* Mini resumen */}
      <div className="resumen-dia" style={{ marginBottom: 16 }}>
        <span className="resumen-stat"><strong>{acciones.length}</strong> contactados</span>
        {compraron > 0   && <span className="resumen-stat"><strong>{compraron}</strong> compraron</span>}
        {respondieron > 0 && <span className="resumen-stat"><strong>{respondieron}</strong> respondieron</span>}
        {sinResp > 0     && <span className="resumen-stat"><strong>{sinResp}</strong> sin respuesta</span>}
        {pendientes > 0  && <span className="resumen-stat"><strong>{pendientes}</strong> sin resultado</span>}
      </div>

      {/* Lista */}
      {acciones.map(a => {
        const res  = RESULTADO_LABEL[a.estado]
        const hora = a.hora ? new Date(a.hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : null
        return (
          <div key={a.telefono} className="accion-row">
            <div className="accion-info">
              <span className="accion-nombre">{a.nombre || a.telefono}</span>
              {a.segmento && (
                <span className="seg-tag" style={{ background: SEG_COLORS[a.segmento] || '#666', fontSize: 10, padding: '1px 7px' }}>
                  {a.segmento}
                </span>
              )}
            </div>
            {hora && <span className="accion-hora">🕐 {hora}</span>}
            <div className={`result-badge ${a.estado}`} style={{ minWidth: 110, justifyContent: 'center' }}>
              {res ? `${res.icon} ${res.texto}` : '⏳ Sin resultado'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Tab Productos ──────────────────────────────────────────────────────────────
const fmtNum  = n => Math.round(n).toLocaleString('es-AR')
const fmtMon  = n => n >= 1_000_000 ? `$${(n/1_000_000).toFixed(1)}M` : `$${Math.round(n/1_000).toLocaleString('es-AR')}K`
const capTitle = s => s ? s.toLowerCase().replace(/\b\w/g, l => l.toUpperCase()) : s

function TabProductos() {
  const { productos, loading, meta } = useProductos()
  const [orden, setOrden] = useState('facturado') // 'facturado' | 'unidades' | 'ganancia'

  if (loading) return <div className="loading">Cargando productos...</div>
  if (!productos.length) return <div style={{ color: '#9ca3af', padding: 24 }}>Sin datos. Corré el ACTUALIZAR.bat de la carpeta articulos.</div>

  const sorted = [...productos].sort((a, b) => {
    if (orden === 'unidades') return b.unidades_totales - a.unidades_totales
    if (orden === 'ganancia') return b.ganancia_neta - a.ganancia_neta
    return b.facturado_total - a.facturado_total
  })

  const totalFact   = productos.reduce((s, p) => s + (p.facturado_total  || 0), 0)
  const totalUnid   = productos.reduce((s, p) => s + (p.unidades_totales || 0), 0)
  const totalGan    = productos.reduce((s, p) => s + (p.ganancia_neta    || 0), 0)
  const maxVal      = sorted[0]?.[orden === 'unidades' ? 'unidades_totales' : orden === 'ganancia' ? 'ganancia_neta' : 'facturado_total'] || 1

  const fechaDesde = meta?.primera_venta ? new Date(meta.primera_venta + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null
  const fechaHasta = meta?.ultima_venta  ? new Date(meta.ultima_venta  + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null

  return (
    <div>
      {/* Resumen global */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Facturación total', val: fmtMon(totalFact), color: '#4f8ef7' },
          { label: 'Unidades vendidas', val: fmtNum(totalUnid), color: '#00a65a' },
          { label: 'Ganancia neta',     val: fmtMon(totalGan),  color: '#d97700' },
          { label: 'Productos únicos',  val: productos.length,   color: '#6b7280' },
        ].map(k => (
          <div key={k.label} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 18px', minWidth: 140 }}>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Período */}
      {fechaDesde && (
        <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>
          Período: <strong style={{ color: '#6b7280' }}>{fechaDesde}</strong> → <strong style={{ color: '#6b7280' }}>{fechaHasta}</strong>
        </div>
      )}

      {/* Selector de orden */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { key: 'facturado', label: '💰 Por facturación' },
          { key: 'unidades',  label: '📦 Por unidades'    },
          { key: 'ganancia',  label: '📈 Por ganancia'    },
        ].map(o => (
          <button key={o.key}
            className={`seg-btn ${orden === o.key ? 'active' : ''}`}
            style={orden === o.key ? { background: '#4f8ef7', color: '#fff', borderColor: 'transparent', fontWeight: 700 } : {}}
            onClick={() => setOrden(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Lista de productos */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.map((p, i) => {
          const val     = orden === 'unidades' ? p.unidades_totales : orden === 'ganancia' ? p.ganancia_neta : p.facturado_total
          const barPct  = Math.round((val / maxVal) * 100)
          const label   = orden === 'unidades' ? `${fmtNum(val)} u` : fmtMon(val)
          const subInfo = orden === 'facturado'
            ? `${fmtNum(p.unidades_totales)} u · ganancia ${fmtMon(p.ganancia_neta)}`
            : orden === 'unidades'
            ? `facturado ${fmtMon(p.facturado_total)} · ganancia ${fmtMon(p.ganancia_neta)}`
            : `${fmtNum(p.unidades_totales)} u · facturado ${fmtMon(p.facturado_total)}`

          return (
            <div key={p.articulo} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 700, minWidth: 22 }}>#{i+1}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{capTitle(p.articulo)}</span>
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#1f2937' }}>{label}</span>
              </div>
              <div style={{ background: '#e5e7eb', borderRadius: 4, height: 6, marginBottom: 4 }}>
                <div style={{ background: '#4f8ef7', width: `${barPct}%`, height: 6, borderRadius: 4, transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>{subInfo}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Tab Glosario ───────────────────────────────────────────────────────────────
function TabGlosario() {
  const Bloque = ({ titulo, children }) => (
    <div style={{ marginBottom: 24, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 20px' }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10, color: '#1f2937' }}>{titulo}</div>
      {children}
    </div>
  )
  const Row = ({ term, def }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 8, marginBottom: 8, fontSize: 14 }}>
      <span style={{ fontWeight: 600, color: '#374151' }}>{term}</span>
      <span style={{ color: '#4b5563', lineHeight: 1.5 }}>{def}</span>
    </div>
  )

  return (
    <div style={{ maxWidth: 680 }}>
      <Bloque titulo="📊 Métricas de cliente">
        <Row term="Score (0-100)"
          def="Puntaje de valor comercial. Combina recencia, frecuencia, gasto total, ticket y recompra. Más alto = más vale la pena recuperarlo." />
        <Row term="Recencia"
          def="Días desde la última compra. Verde < 30d · Amarillo 30-60d · Rojo > 60d." />
        <Row term="Revenue"
          def="Total gastado por el cliente en todo el historial." />
        <Row term="Ticket"
          def="Gasto promedio por pedido (revenue ÷ pedidos)." />
        <Row term="R30D %"
          def="Tasa de recompra en 30 días: % de meses en que el cliente compró al menos una vez. Ej: 75% = compró en 3 de los últimos 4 meses." />
        <Row term="Intervalo prom."
          def="Cada cuántos días suele volver a comprar, en promedio. Útil para saber cuándo contactarlo." />
      </Bloque>

      <Bloque titulo="🎯 Segmentos — criterios">
        {[
          { icon: '🟢', seg: 'Activo',    color: '#00a65a', def: 'Compró hace menos de 30 días. Mantenerlo activo con novedades o promociones.' },
          { icon: '🎯', seg: 'Tibio',     color: '#d97700', def: 'Sin comprar entre 30 y 60 días. Ventana ideal para reactivar antes de que enfríe.' },
          { icon: '🟠', seg: 'Enfriando', color: '#c05a00', def: 'Sin comprar entre 60 y 90 días. Urgente: cada día que pasa baja su probabilidad de volver.' },
          { icon: '🔴', seg: 'En riesgo', color: '#cc2222', def: 'Sin comprar más de 90 días pero con historial valioso. Última oportunidad antes de perderlos.' },
          { icon: '⬛', seg: 'Perdido',   color: '#666',    def: 'Inactivos hace más de 120 días. Difíciles de recuperar, pero con score alto vale el intento.' },
        ].map(s => (
          <div key={s.seg} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
            <span className="seg-tag" style={{ background: s.color, flexShrink: 0 }}>{s.icon} {s.seg}</span>
            <span style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.5, paddingTop: 2 }}>{s.def}</span>
          </div>
        ))}
      </Bloque>

      <Bloque titulo="📋 Lista Hoy — lógica de prioridad">
        <p style={{ fontSize: 14, color: '#4b5563', margin: 0, lineHeight: 1.6 }}>
          La lista de contactos diarios mezcla score + urgencia por recencia.
          Clientes con muchos días sin comprar reciben un bonus de urgencia para subir en la lista,
          aunque su score base sea menor. El objetivo es que siempre veas primero al que más necesita atención.
        </p>
      </Bloque>

      <Bloque titulo="⚠️ Alertas En riesgo">
        <p style={{ fontSize: 14, color: '#4b5563', margin: 0, lineHeight: 1.6 }}>
          Aparecen clientes En riesgo con score alto (&gt; 70). Son los más valiosos que están
          a punto de pasar a Perdido. Una vez contactados, desaparecen de la alerta por ese día.
          La acción recomendada es siempre contactar por WhatsApp con un mensaje personalizado.
        </p>
      </Bloque>
    </div>
  )
}

// ── Tab Conversiones (Atribución de contactos a pedidos) ────────────────────────
function TabConversiones() {
  const { stats, loading, error } = useConversiones()

  if (loading) return <p>📊 Cargando métricas de conversión...</p>
  if (error) return <p>❌ Error: {error}</p>
  if (!stats) return <p>📊 Sin datos de conversión aún</p>

  const { total_contactados, total_conversiones, tasa_conversion, dias_promedio_a_orden, por_segmento } = stats

  return (
    <div>
      <h2>📊 Conversiones — Últimos 30 Días</h2>

      {/* Métricas principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        <div style={{ padding: 16, background: '#f0f9ff', border: '1px solid #0ea5e9', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#0369a1', fontWeight: 600 }}>📞 Contactados</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>{total_contactados}</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>contactos en últimos 30d</div>
        </div>

        <div style={{ padding: 16, background: '#f0fdf4', border: '1px solid #22c55e', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>🛒 Conversiones</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>{total_conversiones}</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>hicieron pedido después de contacto</div>
        </div>

        <div style={{ padding: 16, background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#92400e', fontWeight: 600 }}>📈 Tasa</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>{tasa_conversion}%</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>tasa de conversión</div>
        </div>

        <div style={{ padding: 16, background: '#fce7f3', border: '1px solid #ec4899', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#9d174d', fontWeight: 600 }}>⏱️ Promedio</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>{dias_promedio_a_orden || '—'}</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>días entre contacto y pedido</div>
        </div>
      </div>

      {/* Desglose por segmento */}
      <div style={{ marginTop: 32 }}>
        <h3>📊 Por Segmento</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', background: '#f9fafb' }}>
              <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, color: '#333' }}>Segmento</th>
              <th style={{ padding: 12, textAlign: 'right', fontWeight: 600, color: '#333' }}>Contactados</th>
              <th style={{ padding: 12, textAlign: 'right', fontWeight: 600, color: '#333' }}>Conversiones</th>
              <th style={{ padding: 12, textAlign: 'right', fontWeight: 600, color: '#333' }}>Tasa</th>
              <th style={{ padding: 12, textAlign: 'right', fontWeight: 600, color: '#333' }}>Días Promedio</th>
            </tr>
          </thead>
          <tbody>
            {por_segmento && Object.entries(por_segmento).map(([seg, datos]) => (
              <tr key={seg} style={{ borderBottom: '1px solid #eee', background: seg === 'En riesgo' ? '#fff5f5' : 'transparent' }}>
                <td style={{ padding: 12, color: '#333' }}>
                  {SEG_ICONS[seg] || '•'} {seg}
                </td>
                <td style={{ padding: 12, textAlign: 'right', color: '#666' }}>{datos.contactados}</td>
                <td style={{ padding: 12, textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>{datos.conversiones}</td>
                <td style={{ padding: 12, textAlign: 'right', fontWeight: 600, color: datos.tasa > 30 ? '#16a34a' : datos.tasa > 15 ? '#f59e0b' : '#ef4444' }}>
                  {datos.tasa}%
                </td>
                <td style={{ padding: 12, textAlign: 'right', color: '#666' }}>{datos.dias_promedio || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Información */}
      <div style={{ marginTop: 32, padding: 16, background: '#f0f9ff', border: '1px solid #0ea5e9', borderRadius: 8 }}>
        <p style={{ margin: 0, fontSize: 12, color: '#0369a1' }}>
          <strong>💡 Cómo leer:</strong> La tasa de conversión es el % de contactos que resultaron en un pedido después del contacto.
          Los "días promedio" muestran cuánto tarda en pedirse después del contacto (datos solo para conversiones).
        </p>
      </div>
    </div>
  )
}

// ── Tab Clientes (CRM completo) ────────────────────────────────────────────────
const SORT_COLS = {
  score:    'score_comercial',
  recencia: 'recencia_dias',
  pedidos:  'frecuencia',
  revenue:  'valor_total',
  ticket:   'ticket_promedio',
  r30d:     'tasa_recompra_30d',
}

function TabClientes({ segs }) {
  const [filtroSeg, setFiltroSeg] = useState('Tibio')
  const [page, setPage]           = useState(0)
  const [fichaIdx, setFichaIdx]   = useState(null)
  const [busqueda, setBusqueda]   = useState('')
  const [sortCol, setSortCol]     = useState(null)   // null = default (score desc)
  const [sortDir, setSortDir]     = useState('desc')
  const [modalInfo, setModalInfo] = useState(null)
  const fichaRef = useRef(null)

  const { clientes, total, loading: loadingCli } = useClientes(filtroSeg, page, 50, busqueda)
  // FIX: Validar que el cliente existe y tiene datos antes de renderizar
  const fichaCliente = fichaIdx !== null && clientes && clientes[fichaIdx] ? clientes[fichaIdx] : null

  // Scroll automático a la ficha cuando se abre
  useEffect(() => {
    if (fichaIdx !== null && fichaRef.current) {
      fichaRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [fichaIdx])

  function handleAbrirModal(c) {
    const plantillas = getPlantillas()
    const template   = plantillas[c.segmento] || ''
    setModalInfo({ cliente: c, texto: buildMessage(template, c) })
  }

  async function handleEnviarWhatsApp(cliente, texto) {
    try {
      await iniciarContacto(cliente.telefono)
      const tel = String(cliente.telefono).replace(/\D/g, '')
      window.open(`https://wa.me/549${tel}?text=${encodeURIComponent(texto)}`, '_blank')
      guardarContactoHistorial(cliente.telefono, 'whatsapp', 'contacto_inicial').catch(() => {})
    } catch { /* silencioso */ }
    setModalInfo(null)
  }

  // Sort client-side sobre la página actual
  const clientesSorted = sortCol
    ? [...clientes].sort((a, b) => {
        const va = Number(a[SORT_COLS[sortCol]]) || 0
        const vb = Number(b[SORT_COLS[sortCol]]) || 0
        return sortDir === 'asc' ? va - vb : vb - va
      })
    : clientes

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  // FIX: Resetear ficha cuando la página cambia (nuevos clientes)
  useEffect(() => {
    setFichaIdx(null)
  }, [page])

  function ThSort({ col, children }) {
    const active = sortCol === col
    return (
      <th onClick={() => handleSort(col)}
        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                 color: active ? '#4f8ef7' : undefined }}>
        {children}{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕'}
      </th>
    )
  }

  function cambiarSeg(seg) {
    setFiltroSeg(seg)
    setPage(0)
    setFichaIdx(null)  // FIX: Resetear ficha al cambiar segmento
    setBusqueda('')
  }

  return (
    <>
      {/* SEGMENTOS */}
      <div className="seg-grid" style={{ marginBottom: 24 }}>
        {segs.map(s => (
          <div
            key={s.segmento}
            className="seg-card"
            style={{ background: s.col, cursor: 'pointer', outline: filtroSeg === s.segmento ? '3px solid #fff' : 'none', outlineOffset: 2 }}
            onClick={() => cambiarSeg(s.segmento)}
          >
            <div className="seg-icon">{s.ic}</div>
            <div className="seg-name">{s.segmento}</div>
            <div className="seg-num">{s.clientes}</div>
            <div className="seg-sub">{s.rec}</div>
            <div className="seg-meta">
              <span className="seg-badge">Score {s.score_prom}</span>
            </div>
            {s.intervalo_prom > 0 && (
              <div className="seg-mov">🔁 vuelven cada ~{s.intervalo_prom}d</div>
            )}
          </div>
        ))}
      </div>

      {/* FILTROS */}
      <div className="seg-filter-row">
        {['Todos', ...SEG_ORDER].map(seg => (
          <button
            key={seg}
            className={`seg-btn ${filtroSeg === seg ? 'active' : ''}`}
            style={filtroSeg === seg ? { background: SEG_COLORS[seg] || '#4f8ef7', color: '#fff', borderColor: 'transparent' } : {}}
            onClick={() => cambiarSeg(seg)}
          >
            {SEG_ICONS[seg] || '📋'} {seg}
          </button>
        ))}
      </div>

      {/* FICHA RÁPIDA */}
      {fichaCliente && (
        <div className="ficha" ref={fichaRef}>
          <div className="ficha-header">
            <div>
              <div className="ficha-nombre">{fichaCliente.nombre || 'Sin nombre'}</div>
              <div className="ficha-tel">📞 {fichaCliente.telefono}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="seg-tag" style={{ background: SEG_COLORS[fichaCliente.segmento] || '#666' }}>
                {SEG_ICONS[fichaCliente.segmento]} {fichaCliente.segmento}
              </span>
              <span className={`score-pill ${scoreClass(fichaCliente.score_comercial)}`}>Score {fichaCliente.score_comercial}</span>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#aaa' }} onClick={() => setFichaIdx(null)}>✕</button>
            </div>
          </div>
          {/* PERFIL DE PRODUCTO */}
          {(fichaCliente.producto_favorito || fichaCliente.ultimo_producto) && (() => {
            const cap = s => s ? s.toLowerCase().replace(/\b\w/g, l => l.toUpperCase()) : null
            const fav = cap(fichaCliente.producto_favorito)
            const ult = cap(fichaCliente.ultimo_producto)
            return (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {fav && (
                  <span style={{ fontSize: 13, background: '#fef3c7', color: '#92400e', borderRadius: 8, padding: '4px 12px', fontWeight: 600 }}>
                    🍔 Fav: {fav}
                  </span>
                )}
                {ult && ult !== fav && (
                  <span style={{ fontSize: 13, background: '#f0fdf4', color: '#166534', borderRadius: 8, padding: '4px 12px' }}>
                    🕒 Último: {ult}
                  </span>
                )}
                {fichaCliente.pan_favorito && (
                  <span style={{ fontSize: 13, background: '#f3f4f6', color: '#6b7280', borderRadius: 8, padding: '4px 12px' }}>
                    🍞 {fichaCliente.pan_favorito}
                  </span>
                )}
                {fichaCliente.hora_habitual != null && (
                  <span style={{ fontSize: 13, background: '#eff6ff', color: '#1d4ed8', borderRadius: 8, padding: '4px 12px' }}>
                    🕐 ~{fichaCliente.hora_habitual}hs
                  </span>
                )}
              </div>
            )
          })()}
          {fichaCliente.cliente_sensible_precio && (
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 13, background: '#fef2f2', color: '#dc2626', borderRadius: 8, padding: '4px 12px', fontWeight: 600, border: '1px solid #fecaca' }}>
                💲 Sensible a precio
              </span>
            </div>
          )}
          <div className="ficha-grid">
            <div className="ficha-stat"><strong>{fichaCliente.total_pedidos_historial ?? fichaCliente.frecuencia}</strong>Pedidos hist.</div>
            <div className="ficha-stat"><strong>{fmt(fichaCliente.valor_total)}</strong>Revenue total</div>
            <div className="ficha-stat"><strong>{fmt(fichaCliente.ticket_promedio)}</strong>Ticket prom.</div>
            <div className="ficha-stat"><strong>{fichaCliente.recencia_dias}d</strong>Recencia</div>
            <div className="ficha-stat"><strong>{fichaCliente.pedidos_ultimos_30d ?? 0}</strong>Ped. 30d</div>
            <div className="ficha-stat"><strong>{fichaCliente.pedidos_ultimos_60d ?? 0}</strong>Ped. 60d</div>
            <div className="ficha-stat"><strong>{fichaCliente.frecuencia_mensual ?? '—'}</strong>Freq. mensual</div>
            <div className="ficha-stat"><strong>{fichaCliente.intervalo_promedio_dias > 0 ? `${fichaCliente.intervalo_promedio_dias}d` : '—'}</strong>Intervalo prom.</div>
            <div className="ficha-stat"><strong>{fichaCliente.fecha_ultimo_pedido || '—'}</strong>Último pedido</div>
            <div className="ficha-stat"><strong>{fichaCliente.fecha_anteultimo_pedido || '—'}</strong>Anteúltimo ped.</div>
            <div className="ficha-stat"><strong>{fichaCliente.score_fidelizar ?? '—'}</strong>Score fidelizar</div>
            <div className="ficha-stat">
              <strong>
                {fichaCliente.perfil_actualizado_at
                  ? new Date(fichaCliente.perfil_actualizado_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                  : '—'}
              </strong>
              Perfil al
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="btn-accion" style={{ background: '#25d366' }} onClick={() => handleAbrirModal(fichaCliente)}>💬 WhatsApp</button>
            <button className="btn-accion">📞 Llamar</button>
          </div>
        </div>
      )}

      {/* TABLA */}
      <div className="section">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div className="section-title" style={{ margin: 0 }}>
            {busqueda ? 'Búsqueda' : filtroSeg === 'Todos' ? 'Todos los clientes' : `Clientes — ${filtroSeg}`}
            <span style={{ fontWeight: 400, marginLeft: 8, color: '#aaa' }}>({total})</span>
          </div>
          <input
            type="text"
            placeholder="🔍 Buscar por teléfono..."
            value={busqueda}
            onChange={e => { setBusqueda(e.target.value); setPage(0); setFichaIdx(null) }}
            style={{ padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14,
                     outline: 'none', width: 220, background: busqueda ? '#eff6ff' : '#fff' }}
          />
          {busqueda && (
            <button onClick={() => { setBusqueda(''); setPage(0) }}
              style={{ padding: '6px 12px', border: '1px solid #e5e7eb', borderRadius: 8,
                       background: '#fff', cursor: 'pointer', fontSize: 13, color: '#6b7280' }}>
              ✕ Limpiar
            </button>
          )}
        </div>
        {loadingCli ? (
          <div className="loading" style={{ height: 80 }}>Cargando clientes...</div>
        ) : (
          <table className="crm-table">
            <thead>
              <tr>
                <th>Rk</th><th>Cliente</th><th>Teléfono</th><th>Segmento</th>
                <ThSort col="score">Score</ThSort>
                <ThSort col="recencia">Recencia</ThSort>
                <ThSort col="pedidos">Pedidos</ThSort>
                <ThSort col="revenue">Revenue</ThSort>
                <ThSort col="ticket">Ticket</ThSort>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clientesSorted.map((c, i) => (
                <tr key={i} style={fichaIdx === i ? { background: '#eff6ff' } : {}}>
                  <td style={{ color: '#aaa', fontSize: 11 }}>{c.rank_prioridad}</td>
                  <td style={{ fontWeight: 600 }}>{c.nombre || <span style={{ color: '#ccc' }}>Sin nombre</span>}</td>
                  <td style={{ color: '#666' }}>{c.telefono}</td>
                  <td>
                    <span className="seg-tag" style={{ background: SEG_COLORS[c.segmento] || '#666' }}>
                      {SEG_ICONS[c.segmento]} {c.segmento}
                    </span>
                  </td>
                  <td><span className={`score-pill ${scoreClass(c.score_comercial)}`}>{c.score_comercial}</span></td>
                  <td style={{ color: c.recencia_dias > 60 ? '#ef4444' : c.recencia_dias > 30 ? '#f59e0b' : '#22c55e' }}>{c.recencia_dias}d</td>
                  <td>{c.frecuencia}</td>
                  <td>{fmt(c.valor_total)}</td>
                  <td>{fmt(c.ticket_promedio)}</td>
                  <td><button className="btn-accion" onClick={() => setFichaIdx(fichaIdx === i ? null : i)}>{fichaIdx === i ? 'Cerrar' : 'Ver'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {total > 50 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', padding: '16px 0', fontSize: 13 }}>
            <button className="btn-accion" style={{ background: '#6b7280' }} disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Anterior</button>
            <span style={{ color: '#666' }}>Página {page + 1} de {Math.ceil(total / 50)}</span>
            <button className="btn-accion" style={{ background: '#6b7280' }} disabled={(page + 1) * 50 >= total} onClick={() => setPage(p => p + 1)}>Siguiente →</button>
          </div>
        )}
      </div>

      {/* MODAL WHATSAPP */}
      {modalInfo && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:1000, display:'flex', alignItems:'flex-end', justifyContent:'center' }}
             onClick={e => e.target === e.currentTarget && setModalInfo(null)}>
          <div style={{ background:'#fff', borderRadius:'20px 20px 0 0', padding:24, width:'100%', maxWidth:600, maxHeight:'85vh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:17 }}>{modalInfo.cliente.nombre}</div>
                <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:4 }}>
                  <span className="seg-tag" style={{ background: SEG_COLORS[modalInfo.cliente.segmento] || '#666' }}>
                    {SEG_ICONS[modalInfo.cliente.segmento]} {modalInfo.cliente.segmento}
                  </span>
                  <span style={{ fontSize:12, color:'#9ca3af' }}>{modalInfo.cliente.recencia_dias}d sin comprar</span>
                </div>
              </div>
              <button onClick={() => setModalInfo(null)}
                style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#9ca3af', lineHeight:1 }}>✕</button>
            </div>
            <div style={{ fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>
              Mensaje — editá si querés
            </div>
            <textarea
              value={modalInfo.texto}
              onChange={e => setModalInfo(m => ({ ...m, texto: e.target.value }))}
              rows={6}
              style={{ width:'100%', border:'1px solid #e5e7eb', borderRadius:10, padding:12, fontSize:14, resize:'vertical', outline:'none', fontFamily:'inherit', lineHeight:1.5 }}
            />
            <div style={{ display:'flex', gap:8, marginTop:14 }}>
              <button onClick={() => setModalInfo(null)}
                style={{ flex:1, padding:'12px', border:'1px solid #e5e7eb', borderRadius:10, background:'#fff', fontWeight:600, cursor:'pointer', fontSize:14 }}>
                Cancelar
              </button>
              <button
                onClick={() => handleEnviarWhatsApp(modalInfo.cliente, modalInfo.texto)}
                disabled={!modalInfo.texto.trim()}
                style={{ flex:2, padding:'12px', background:'#16a34a', color:'#fff', border:'none', borderRadius:10, fontWeight:700, cursor:'pointer', fontSize:15 }}>
                💬 Enviar por WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── CRM principal ───────────────────────────────────────────────────────────────
export default function CRM() {
  const { data, loading: loadingSnap } = useSnapshot()
  const [vista, setVista]   = useState('hoy')
  const [overrides, setOverrides] = useState({}) // compartido entre TabHoy y TabAcciones
  const datosMeta = useDatosMeta()

  const segs = data?.SEGS || data?.['payload->SEGS'] || []

  if (loadingSnap) return <div className="loading">Cargando CRM...</div>

  const fechaDelivery = datosMeta?.ultima_carga_delivery
    ? new Date(datosMeta.ultima_carga_delivery + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null
  const fechaPerfil = datosMeta?.ultima_carga_perfil
    ? new Date(datosMeta.ultima_carga_perfil).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null

  return (
    <div className="page">
      <div className="page-title">🎯 CRM — Acción comercial</div>
      {/* INDICADOR DE DATOS */}
      {(fechaDelivery || fechaPerfil) && (
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: -12, marginBottom: 16, display: 'flex', gap: 16 }}>
          {fechaDelivery && <span>📦 Delivery al <strong style={{ color: '#6b7280' }}>{fechaDelivery}</strong></span>}
          {fechaPerfil  && <span>🔄 Perfil al <strong style={{ color: '#6b7280' }}>{fechaPerfil}</strong></span>}
        </div>
      )}

      {/* TABS */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { key: 'hoy',        label: '📋 Hoy'              },
          { key: 'acciones',   label: '✅ Acciones'          },
          { key: 'conversiones', label: '📊 Conversiones'    },
          { key: 'crm',        label: '👥 Clientes'          },
          { key: 'productos',  label: '🍔 Productos'         },
          { key: 'plantillas', label: '✏️ Plantillas'        },
          { key: 'glosario',   label: '❓ Glosario'          },
        ].map(t => (
          <button key={t.key}
            className={`seg-btn ${vista === t.key ? 'active' : ''}`}
            style={vista === t.key ? { background: '#4f8ef7', color: '#fff', borderColor: 'transparent', fontWeight: 700 } : {}}
            onClick={() => setVista(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {vista === 'hoy'        && <TabHoy overrides={overrides} setOverrides={setOverrides} />}
      {vista === 'acciones'   && <TabAcciones overrides={overrides} />}
      {vista === 'conversiones' && <TabConversiones />}
      {vista === 'crm'        && <TabClientes segs={segs} />}
      {vista === 'productos'  && <TabProductos />}
      {vista === 'plantillas' && <TabPlantillas />}
      {vista === 'glosario'   && <TabGlosario />}
    </div>
  )
}
