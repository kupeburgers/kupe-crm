import { useState, useEffect } from 'react'
import { SUPABASE_URL, SUPABASE_ANON } from '../config'

const HEADERS = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }

// Top 20 clientes a contactar hoy con sugerencias automáticas
// Retorna mismo shape que useTop20() para compatibilidad
export function useAccionHoy() {
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(
      `${SUPABASE_URL}/rest/v1/crm_accion_hoy?order=score_comercial.desc`,
      { headers: HEADERS }
    )
      .then(r => r.json())
      .then(rows => {
        if (Array.isArray(rows)) setClientes(rows)
        else {
          setClientes([])
          setError('Datos inválidos de servidor')
        }
      })
      .catch(e => {
        setClientes([])
        setError(e.message)
      })
      .finally(() => setLoading(false))
  }, [])

  return { clientes, loading, error }
}
