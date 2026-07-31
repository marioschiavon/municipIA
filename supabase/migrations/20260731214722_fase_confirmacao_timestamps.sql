-- Suporte à prospecção em fases separadas (domínio / secretário / contato):
-- timestamp de confirmação por campo (mesma ideia de dominio_confirmado_em,
-- já existente) + sinalização de revisão manual quando a IA fica em dúvida
-- ou só encontra um contato genérico (ouvidoria, faleconosco...).

ALTER TABLE public.municipios_educacao
  ADD COLUMN secretario_confirmado_em TIMESTAMPTZ,
  ADD COLUMN contato_confirmado_em TIMESTAMPTZ,
  ADD COLUMN revisao_necessaria BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN revisao_motivos TEXT[] NOT NULL DEFAULT '{}';
