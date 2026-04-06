export const PLANTILLAS_DEFAULT = {
  Activo: `Hola {nombre}! 🔥 Qué bueno tenerte como cliente frecuente. ¿Ya viste las novedades de esta semana? Hacé tu pedido y te lo mandamos al toque 🍔`,

  Tibio: `Hola {nombre}! 👋 Hace {dias} días que no te vemos por acá. ¿Qué se te antoja hoy? Tu {producto_favorito} te está esperando 🍔🔥`,

  Enfriando: `Hola {nombre}! ⏰ Hace {dias} días que no pedís. ¿Te mandamos tu {producto_favorito} de siempre con {pan_favorito}? Tu última compra fue el {ultima_compra} 🍟`,

  'En riesgo': `Hola {nombre}! 😟 Hace {dias} días que no sabemos nada de vos. Tu última compra fue el {ultima_compra} y no queremos que sea la última. ¿Te tentamos con tu {producto_favorito}? Escribinos 🎁`,

  Perdido: `Hola {nombre}. Hace {dias} días que no pedís con nosotros 😔\n\nSabemos que es mucho tiempo. Tu última compra fue el {ultima_compra}.\n\nSi te animás a darnos una nueva oportunidad, te esperamos con tu {producto_favorito} y algo especial solo para vos 🙏🍔`,
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

export function buildMessage(template, cliente) {
  const nombre = (cliente.nombre || '').trim().split(/\s+/)[0] || 'amigo'
  const ticket = cliente.ticket_promedio
    ? `$${Math.round(cliente.ticket_promedio / 1000)}K`
    : ''
  // producto_favorito: capitalizar primera letra de cada palabra
  const productoFav = cliente.producto_favorito
    ? cliente.producto_favorito.toLowerCase().replace(/\b\w/g, l => l.toUpperCase())
    : 'tu burger favorita'
  const panFav = cliente.pan_favorito || 'tu pan favorito'
  return (template || '')
    .replace(/{nombre}/g,            nombre)
    .replace(/{dias}/g,              cliente.recencia_dias ?? '')
    .replace(/{segmento}/g,          cliente.segmento ?? '')
    .replace(/{ticket}/g,            ticket)
    .replace(/{pedidos}/g,           cliente.frecuencia ?? '')
    .replace(/{ultima_compra}/g,     cliente.ultima_compra ?? '')
    .replace(/{producto_favorito}/g, productoFav)
    .replace(/{pan_favorito}/g,      panFav)
}
