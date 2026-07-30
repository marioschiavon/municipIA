-- Domínio oficial confirmado por município, pra evitar refazer a busca
-- completa no Google/Apify em toda prospecção. Só gravado quando o pipeline
-- (ou o admin manualmente) confirma que o host é realmente o site oficial
-- do município — nunca a Câmara Municipal (.leg.br), que é outra entidade.

ALTER TABLE public.municipios_educacao
  ADD COLUMN dominio_oficial TEXT,
  ADD COLUMN pagina_educacao_url TEXT,
  ADD COLUMN dominio_confirmado_em TIMESTAMPTZ;

ALTER TABLE public.municipios_educacao
  ADD CONSTRAINT municipios_educacao_dominio_oficial_not_leg
  CHECK (dominio_oficial IS NULL OR dominio_oficial !~* '\.leg\.br$');
