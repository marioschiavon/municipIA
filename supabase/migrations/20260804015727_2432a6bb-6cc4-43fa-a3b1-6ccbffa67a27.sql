ALTER TABLE public.municipios_educacao
  ADD COLUMN IF NOT EXISTS secretario_confirmado_em timestamp with time zone,
  ADD COLUMN IF NOT EXISTS contato_confirmado_em timestamp with time zone;