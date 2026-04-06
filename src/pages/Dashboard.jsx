import { useSnapshot } from '../hooks/useSnapshot'

const fmt = n => n >= 1_000_000
  ? `$${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n}`

export default function Dashboard() {
  const { data, loading, error } = useSnapshot()

  if (loading) return <div className="loading">Cargando datos...</div>
  if (error)   return <div className="loading" style={{color:'#ef4444'}}>Error: {error}</div>

  const mon   = data?.MON  || data?.['payload->MON']  || {}
  const segs  = data?.SEGS || data?.['payload->SEGS'] || []
  const movs  = data?.MOV_SEGS || data?.['payload->MOV_SEGS'] || []

  const meses    = mon.meses    || []
  const pedidos  = mon.pedidos  || []
  const revenue  = mon.revenue  || []
  const tickets  = mon.ticket   || []
  const clientes = mon.clientes || []
  const retencion = mon.retencion || []

  // KPIs del último mes
  const lastIdx   = meses.length - 1
  const kpiPed    = pedidos[lastIdx]  || 0
  const kpiRev    = revenue[lastIdx]  || 0
  const kpiTk     = tickets[lastIdx]  || 0
  const kpiCli    = clientes[lastIdx] || 0
  const kpiRet    = retencion[lastIdx] || 0

  const maxRev = Math.max(...revenue, 1)
  const maxPed = Math.max(...pedidos, 1)
  const maxRet = Math.max(...retencion, 1)

  // Alertas automáticas
  const perdido = segs.find(s => s.segmento === 'Perdido')
  const enRiesgo = segs.find(s => s.segmento === 'En riesgo')
  const tibio = segs.find(s => s.segmento === 'Tibio')
  const alertas = [
    perdido && {
      tipo: 'danger',
      txt: `${perdido.clientes} clientes en Perdido — ${fmt(perdido.revenue)} de revenue histórico en riesgo de no recuperar`
    },
    enRiesgo && {
      tipo: 'warn',
      txt: `${enRiesgo.clientes} clientes en riesgo (61–90 días sin comprar) — requieren contacto esta semana`
    },
    tibio && {
      tipo: 'info',
      txt: `${tibio.clientes} clientes Tibios con score promedio ${tibio.score_prom} — zona de mayor retorno por gestión`
    },
    kpiRet < 30 && {
      tipo: 'warn',
      txt: `Retención del último mes: ${kpiRet}% — por debajo del umbral saludable (30%)`
    },
  ].filter(Boolean)

  return (
    <div className="page">
      <div className="page-title">📊 Dashboard — Contexto histórico</div>

      {/* KPI STRIP */}
      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Pedidos (mes actual)</div>
          <div className="kpi-value">{kpiPed}</div>
          <div className="kpi-sub">{meses[lastIdx]}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Revenue (mes actual)</div>
          <div className="kpi-value">{fmt(kpiRev)}</div>
          <div className="kpi-sub">{meses[lastIdx]}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Ticket promedio</div>
          <div className="kpi-value">{fmt(kpiTk)}</div>
          <div className="kpi-sub">Mes actual</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Clientes únicos</div>
          <div className="kpi-value">{kpiCli}</div>
          <div className="kpi-sub">Mes actual</div>
        </div>
        <div className="kpi" style={{borderLeftColor: '#f59e0b'}}>
          <div className="kpi-label">Retención</div>
          <div className="kpi-value">{kpiRet}%</div>
          <div className="kpi-sub">vs mes anterior</div>
        </div>
        <div className="kpi" style={{borderLeftColor: '#ef4444'}}>
          <div className="kpi-label">Clientes totales</div>
          <div className="kpi-value">{segs.reduce((a, s) => a + s.clientes, 0)}</div>
          <div className="kpi-sub">Histórico</div>
        </div>
      </div>

      {/* ALERTAS */}
      {alertas.length > 0 && (
        <div className="section">
          <div className="section-title">⚠️ Alertas</div>
          <div className="alert-list">
            {alertas.map((a, i) => (
              <div key={i} className={`alert-item ${a.tipo}`}>
                <span>{a.tipo === 'danger' ? '🔴' : a.tipo === 'warn' ? '🟠' : 'ℹ️'}</span>
                {a.txt}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PEDIDOS POR MES */}
      <div className="section">
        <div className="section-title">Pedidos por mes</div>
        <div className="bar-chart">
          {meses.map((m, i) => (
            <div key={i} className="bar-wrap">
              <div className="bar-val">{pedidos[i]}</div>
              <div className="bar" style={{ height: `${Math.round((pedidos[i] / maxPed) * 90)}%` }} />
              <div className="bar-label">{m}</div>
            </div>
          ))}
        </div>
      </div>

      {/* REVENUE POR MES */}
      <div className="section">
        <div className="section-title">Revenue mensual</div>
        <div className="bar-chart">
          {meses.map((m, i) => (
            <div key={i} className="bar-wrap">
              <div className="bar-val">{fmt(revenue[i])}</div>
              <div className="bar revenue" style={{ height: `${Math.round((revenue[i] / maxRev) * 90)}%` }} />
              <div className="bar-label">{m}</div>
            </div>
          ))}
        </div>
      </div>

      {/* RETENCIÓN */}
      <div className="section">
        <div className="section-title">Retención mensual (%)</div>
        <div className="ret-row">
          {meses.map((m, i) => (
            <div key={i} className="ret-bar-wrap">
              <div className="ret-bar" style={{ height: `${Math.round((retencion[i] / Math.max(maxRet, 1)) * 55)}%` }} />
              <div className="ret-label">{retencion[i]}%</div>
            </div>
          ))}
        </div>
        <div style={{display:'flex', gap:6, marginTop:4}}>
          {meses.map((m, i) => (
            <div key={i} style={{flex:1, textAlign:'center', fontSize:9, color:'#bbb'}}>{m}</div>
          ))}
        </div>
      </div>

      {/* EVOLUCIÓN DE SEGMENTOS */}
      <div className="section">
        <div className="section-title">Segmentos hoy</div>
        <div className="seg-grid">
          {segs.map(s => (
            <div key={s.segmento} className="seg-card" style={{ background: s.col }}>
              <div className="seg-icon">{s.ic}</div>
              <div className="seg-name">{s.segmento}</div>
              <div className="seg-num">{s.clientes}</div>
              <div className="seg-sub">{s.rec}</div>
              <div className="seg-meta">
                <span className="seg-badge">{fmt(s.revenue)}</span>
                <span className="seg-badge">tk {fmt(s.ticket)}</span>
              </div>
              {(s.entraron > 0 || s.salieron > 0) && (
                <div className="seg-mov">
                  {s.entraron > 0 && `↑${s.entraron} `}
                  {s.salieron > 0 && `↓${s.salieron}`}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
