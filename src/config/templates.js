export const PLANTILLAS_DEFAULT = {
  Activo: `Hola {nombre}! 🔥 Gracias por seguir eligiéndonos. ¿Qué se te antoja hoy?`,

  Tibio: `Hola {nombre}! 👋 Hace {dias} días que no pedís. ¿Te mandamos {producto_mencion}?`,

  Enfriando: `Hola {nombre}! ⏰ La última vez pediste {producto_mencion} — hace {dias} días. ¿Qué se te antoja hoy? 🍔`,

  'En riesgo': `Hola {nombre}. Hace {dias} días que no pedís, la última fue el {fecha_ultimo_pedido}. Si querés volver, acá estamos 🙏`,

  Perdido: `Hola {nombre}. {dias} días es mucho tiempo. Si algún día querés volver a pedirnos, acá estamos 🍔`,
}

const STORAGE_KEY = 'kupe_plantillas'

export function getPlantillas() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return { ...PLANTILLAS_DEFAULT, ...JSON.parse(stored) }
  } catch {}
  return { ...PLANTILLAS_DEFAULT }
}

export function savePlantillas(plantillas) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plantillas))
}

function capitalizar(str) {
  return (str || '').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())
}

export function buildMessage(template, cliente) {
  const nombre = (cliente.nombre || '').trim().split(/\s+/)[0] || 'amigo'
  const ticket = cliente.ticket_promedio
    ? `$${Math.round(cliente.ticket_promedio / 1000)}K`
    : ''

  // producto_mencion: usa ultimo_producto si existe y es distinto al favorito;
  // si son iguales o solo hay favorito, usa favorito. Fallback: texto neutro.
  const fav = cliente.producto_favorito ? capitalizar(cliente.producto_favorito) : null
  const ult = cliente.ultimo_producto   ? capitalizar(cliente.ultimo_producto)   : null
  const productoMencion = ult || fav || 'algo rico'

  const panFav  = cliente.pan_favorito || 'tu pan favorito'
  const fechaUlt = cliente.fecha_ultimo_pedido || cliente.ultima_compra || ''

  return (template || '')
    .replace(/{nombre}/g,            nombre)
    .replace(/{dias}/g,              cliente.recencia_dias ?? '')
    .replace(/{segmento}/g,          cliente.segmento ?? '')
    .replace(/{ticket}/g,            ticket)
    .replace(/{pedidos}/g,           cliente.frecuencia ?? '')
    .replace(/{ultima_compra}/g,     cliente.ultima_compra ?? '')
    .replace(/{producto_favorito}/g, fav || 'tu burger favorita')
    .replace(/{ultimo_producto}/g,   ult || fav || 'algo rico')
    .replace(/{producto_mencion}/g,  productoMencion)
    .replace(/{pan_favorito}/g,      panFav)
    .replace(/{fecha_ultimo_pedido}/g, fechaUlt)
}
