-- Autoria da confirmação por fase (domínio / secretário / contato): quem
-- confirmou, ao lado do "quando" que já existe (*_confirmado_em). Sem tabela
-- de auditoria separada — só o último autor por fase, guardado como e-mail
-- (não há tabela profiles; o e-mail já vem nas claims do JWT autenticado).

ALTER TABLE public.municipios_educacao
  ADD COLUMN dominio_confirmado_por TEXT,
  ADD COLUMN secretario_confirmado_por TEXT,
  ADD COLUMN contato_confirmado_por TEXT;
