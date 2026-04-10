-- Migration: Create contactos_historial table for persistent contact tracking
-- Purpose: Store all contact attempts (WhatsApp, llamada, etc.) with outcomes
-- Date: 2026-04-10

-- Create table
CREATE TABLE IF NOT EXISTS public.contactos_historial (
  id BIGSERIAL PRIMARY KEY,
  cliente_telefono VARCHAR(20) NOT NULL,
  canal VARCHAR(50) DEFAULT 'whatsapp',
  accion VARCHAR(100) DEFAULT 'contacto_inicial',
  resultado VARCHAR(50),
  fecha_contacto DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for fast phone + date queries
CREATE INDEX IF NOT EXISTS idx_contactos_historial_telefono_fecha
  ON public.contactos_historial(cliente_telefono, fecha_contacto DESC);

-- Create index for conversion calculations (date range queries)
CREATE INDEX IF NOT EXISTS idx_contactos_historial_fecha_contacto
  ON public.contactos_historial(fecha_contacto DESC);

-- Enable RLS
ALTER TABLE public.contactos_historial ENABLE ROW LEVEL SECURITY;

-- Allow public insert (no auth required via anon key)
CREATE POLICY IF NOT EXISTS "Allow insert contactos_historial" ON public.contactos_historial
  FOR INSERT WITH CHECK (true);

-- Allow public select
CREATE POLICY IF NOT EXISTS "Allow select contactos_historial" ON public.contactos_historial
  FOR SELECT USING (true);

-- Allow public update (for changing resultado after insert)
CREATE POLICY IF NOT EXISTS "Allow update contactos_historial" ON public.contactos_historial
  FOR UPDATE USING (true) WITH CHECK (true);

-- Create trigger to auto-update updated_at on changes
-- (using the existing update_updated_at_column function if it exists, or create it)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_contactos_historial_updated_at ON public.contactos_historial;
CREATE TRIGGER trigger_contactos_historial_updated_at
  BEFORE UPDATE ON public.contactos_historial
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
