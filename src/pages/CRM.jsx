import { useState } from 'react'
import { useSnapshot, useClientes, useTop20, useGestionesHoy, useGestionesRecientes, useEnRiesgoUrgente, iniciarContacto, cerrarGestion } from '../hooks/useSnapshot'
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

function TabHoy() {
  const { clientes, loading: loadingCli } = useTop20()
  const gestionesDB    = useGestionesHoy()   // null = cargando, {} = listo (puede estar vacío)
  const [overrides, setOverrides] = useState({}) // acciones de esta sesión
  const [filtro, setFiltro]       = useState('sin_contactar')
  const [modalInfo, setModalInfo] = useState(null)   // null | { cliente, texto }
  const [cambiando, setCambiando] = useState(new Set()) // teléfonos en modo "cambiar resultado"

  const recientes     = useGestionesRecientes(2)   // teléfonos contactados ayer (cooldown)
  const enRiesgo      = useEnRiesgoUrgente(70)       // En riesgo con score > 70

  const loading = loadingCli || gestionesDB === null

  // Estado efectivo = DB (persistido) sobreescrito por acciones de esta sesión
  const getEstado    = tel => overrides[tel]?.estado ?? gestionesDB?.[tel]?.estado ?? null
  const getGestionId = tel => overrides[tel]?.id     ?? gestionesDB?.[tel]?.id     ?? null

  // Estado con cooldown: si fue contactado ayer y hoy no tiene gestión → 'contactado_ayer'
  const getEstadoEfectivo = tel => {
    const est = getEstado(tel)
    if (est === null && recientes.has(String(tel))) return 'contactado_ayer'
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
    setModalInfo({ cliente: c, texto: buildMessage(template, c) })
  }

  // Confirmación: crea gestión → abre WhatsApp → cierra modal
  async function handleEnviarWhatsApp(cliente, texto) {
    try {
      const id = await iniciarContacto(cliente.telefono)
      setOverrides(o => ({ ...o, [cliente.telefono]: { id, estado: 'pendiente' } }))
      const tel = String(cliente.telefono).replace(/\D/g, '')
      window.open(`https://wa.me/549${tel}?text=${encodeURIComponent(texto)}`, '_blank')
    } catch {
      // Si falla la RPC no abrimos WhatsApp ni actualizamos estado
    }
    setModalInfo(null)
  }

  async function handleResultado(telefono, resultado) {
    const id = getGestionId(telefono)
    setOverrides(o => ({ ...o, [telefono]: { id, estado: 'cerrando' } }))
    try {
      await cerrarGestion(id, resultado)
      setOverrides(o => ({ ...o, [telefono]: { id, estado: resultado } }))
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

      {/* ALERTA EN RIESGO URGENTE */}
      {enRiesgo.length > 0 && (
        <div className="alerta-riesgo">
          <div className="alerta-riesgo-title">
            ⚠️ {enRiesgo.length} clientes En riesgo con score alto — última oportunidad antes de perderlos
          </div>
          <div className="alerta-riesgo-list">
            {enRiesgo.slice(0, 4).map(c => (
              <div key={c.telefono} className="alerta-riesgo-item">
                <span>{c.nombre || c.telefono}</span>
                <span style={{ color: '#9ca3af' }}>{c.recencia_dias}d · score {c.score_comercial}</span>
                <button
                  className="btn-accion"
                  style={{ background: '#ea580c', fontSize: 11, padding: '4px 10px' }}
                  onClick={() => handleAbrirModal(c)}
                >
                  Contactar
                </button>
              </div>
            ))}
            {enRiesgo.length > 4 && (
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                + {enRiesgo.length - 4} más en la lista "Todos los clientes"
              </div>
            )}
          </div>
        </div>
      )}

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

                {/* NAME */}
                <div className="card-nombre">{c.nombre || <span style={{ color: '#ccc' }}>Sin nombre</span>}</div>

                {/* SECONDARY INFO */}
                <div className="card-info">
                  <span>📞 {c.telefono}</span>
                  <span>{c.frecuencia} ped.</span>
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
                )}

                {res && cambiando.has(c.telefono) && (
                  <div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>
                      Estaba: {res.icon} {res.texto} — elegí el nuevo resultado:
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
                    <button
                      onClick={() => setCambiando(s => { const n = new Set(s); n.delete(c.telefono); return n })}
                      style={{ marginTop: 6, fontSize: 11, padding: '4px 0', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}
                    >
                      Cancelar
                    </button>
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
  Activo:     { nombre:'Juan García',   recencia_dias:8,  frecuencia:15, ticket_promedio:42000, ultima_compra:'29/03/2026', segmento:'Activo'     },
  Tibio:      { nombre:'Lucas Marotta', recencia_dias:22, frecuencia:10, ticket_promedio:38000, ultima_compra:'15/03/2026', segmento:'Tibio'       },
  Enfriando:  { nombre:'Agustín Solari',recencia_dias:45, frecuencia:8,  ticket_promedio:43000, ultima_compra:'22/02/2026', segmento:'Enfriando'   },
  'En riesgo':{ nombre:'Martina Sosa',  recencia_dias:75, frecuencia:6,  ticket_promedio:48000, ultima_compra:'21/01/2026', segmento:'En riesgo'   },
  Perdido:    { nombre:'Jorge Pérez',   recencia_dias:130,frecuencia:4,  ticket_promedio:46000, ultima_compra:'28/11/2025', segmento:'Perdido'     },
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

// ── Tab Clientes (CRM completo) ────────────────────────────────────────────────
function TabClientes({ segs }) {
  const [filtroSeg, setFiltroSeg] = useState('Tibio')
  const [page, setPage]           = useState(0)
  const [fichaIdx, setFichaIdx]   = useState(null)

  const { clientes, total, loading: loadingCli } = useClientes(filtroSeg, page)
  const fichaCliente = fichaIdx !== null ? clientes[fichaIdx] : null

  function cambiarSeg(seg) {
    setFiltroSeg(seg)
    setPage(0)
    setFichaIdx(null)
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
              <span className="seg-badge">r30 {s.recompra_30d}%</span>
            </div>
            {s.intervalo_prom > 0 && (
              <div className="seg-mov">🔁 compran cada {s.intervalo_prom} días</div>
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
        <div className="ficha">
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
          <div className="ficha-grid">
            <div className="ficha-stat"><strong>{fichaCliente.frecuencia}</strong>Pedidos</div>
            <div className="ficha-stat"><strong>{fmt(fichaCliente.valor_total)}</strong>Revenue total</div>
            <div className="ficha-stat"><strong>{fmt(fichaCliente.ticket_promedio)}</strong>Ticket prom.</div>
            <div className="ficha-stat"><strong>{fichaCliente.recencia_dias}d</strong>Recencia</div>
            <div className="ficha-stat"><strong>{fichaCliente.tasa_recompra_30d ?? '—'}%</strong>Recompra 30d</div>
            <div className="ficha-stat"><strong>{fichaCliente.tasa_recompra_60d ?? '—'}%</strong>Recompra 60d</div>
            <div className="ficha-stat"><strong>{fichaCliente.intervalo_promedio_dias > 0 ? `${fichaCliente.intervalo_promedio_dias}d` : '—'}</strong>Intervalo prom.</div>
            <div className="ficha-stat"><strong>{fichaCliente.ultima_compra || '—'}</strong>Última compra</div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="btn-accion" style={{ background: '#25d366' }}>💬 WhatsApp</button>
            <button className="btn-accion">📞 Llamar</button>
          </div>
        </div>
      )}

      {/* TABLA */}
      <div className="section">
        <div className="section-title">
          {filtroSeg === 'Todos' ? 'Todos los clientes' : `Clientes — ${filtroSeg}`}
          <span style={{ fontWeight: 400, marginLeft: 8, color: '#aaa' }}>({total})</span>
        </div>
        {loadingCli ? (
          <div className="loading" style={{ height: 80 }}>Cargando clientes...</div>
        ) : (
          <table className="crm-table">
            <thead>
              <tr>
                <th>Rk</th><th>Cliente</th><th>Teléfono</th><th>Segmento</th>
                <th>Score</th><th>Recencia</th><th>Pedidos</th><th>Revenue</th>
                <th>Ticket</th><th>r30d</th><th>Última compra</th><th></th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c, i) => (
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
                  <td style={{ color: c.tasa_recompra_30d >= 50 ? '#22c55e' : '#f59e0b' }}>{c.tasa_recompra_30d ?? '—'}%</td>
                  <td style={{ color: '#888', fontSize: 12 }}>{c.ultima_compra}</td>
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
    </>
  )
}

// ── CRM principal ───────────────────────────────────────────────────────────────
export default function CRM() {
  const { data, loading: loadingSnap } = useSnapshot()
  const [vista, setVista] = useState('hoy')

  const segs = data?.SEGS || data?.['payload->SEGS'] || []

  if (loadingSnap) return <div className="loading">Cargando CRM...</div>

  return (
    <div className="page">
      <div className="page-title">🎯 CRM — Acción comercial</div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { key: 'hoy',        label: '📋 Hoy'              },
          { key: 'crm',        label: '👥 Todos los clientes'},
          { key: 'plantillas', label: '✏️ Plantillas'        },
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

      {vista === 'hoy'        && <TabHoy />}
      {vista === 'crm'        && <TabClientes segs={segs} />}
      {vista === 'plantillas' && <TabPlantillas />}
    </div>
  )
}
