ALTER TABLE public.municipios_educacao
  ADD COLUMN IF NOT EXISTS revisao_necessaria boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revisao_motivos text[] NOT NULL DEFAULT '{}'::text[];