ALTER TABLE public.municipios_educacao
  ADD COLUMN IF NOT EXISTS tentativa_dominio_em timestamptz,
  ADD COLUMN IF NOT EXISTS tentativa_secretario_em timestamptz,
  ADD COLUMN IF NOT EXISTS tentativa_contato_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_mun_edu_tentativa_dominio ON public.municipios_educacao (tentativa_dominio_em NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_mun_edu_tentativa_secretario ON public.municipios_educacao (tentativa_secretario_em NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_mun_edu_tentativa_contato ON public.municipios_educacao (tentativa_contato_em NULLS FIRST);