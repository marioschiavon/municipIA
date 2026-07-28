-- Amplia contato da Secretaria de Educação para múltiplos e-mails/telefones.
-- Antes: colunas singulares (email TEXT, telefone TEXT) descartavam tudo
-- além do primeiro contato encontrado pelo pipeline de prospecção.

ALTER TABLE public.municipios_educacao RENAME COLUMN email TO emails;
ALTER TABLE public.municipios_educacao RENAME COLUMN telefone TO telefones;

ALTER TABLE public.municipios_educacao
  ALTER COLUMN emails TYPE text[] USING CASE
    WHEN emails IS NULL OR emails = '' THEN '{}'::text[]
    ELSE ARRAY[emails]
  END;

ALTER TABLE public.municipios_educacao
  ALTER COLUMN telefones TYPE text[] USING CASE
    WHEN telefones IS NULL OR telefones = '' THEN '{}'::text[]
    ELSE ARRAY[telefones]
  END;

ALTER TABLE public.municipios_educacao ALTER COLUMN emails SET DEFAULT '{}'::text[];
ALTER TABLE public.municipios_educacao ALTER COLUMN emails SET NOT NULL;
ALTER TABLE public.municipios_educacao ALTER COLUMN telefones SET DEFAULT '{}'::text[];
ALTER TABLE public.municipios_educacao ALTER COLUMN telefones SET NOT NULL;
