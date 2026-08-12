CREATE TABLE public.prospect_query_config (
  id integer PRIMARY KEY DEFAULT 1,
  query_ai_overview text NOT NULL DEFAULT 'nome e contato do secretário(a) de educação de {municipio} {uf}',
  variantes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT prospect_query_config_singleton CHECK (id = 1)
);

GRANT SELECT ON public.prospect_query_config TO anon;
GRANT SELECT, UPDATE ON public.prospect_query_config TO authenticated;
GRANT ALL ON public.prospect_query_config TO service_role;

ALTER TABLE public.prospect_query_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read prospect query config"
  ON public.prospect_query_config FOR SELECT USING (true);

CREATE POLICY "admin update prospect query config"
  ON public.prospect_query_config FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER prospect_query_config_updated_at
  BEFORE UPDATE ON public.prospect_query_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.prospect_query_config (id, query_ai_overview, variantes)
VALUES (
  1,
  'nome e contato do secretário(a) de educação de {municipio} {uf}',
  '["nome e contato do secretário(a) de educação de {municipio} {uf}","secretário municipal de educação de {municipio} {uf} email telefone contato","quem é o secretário de educação de {municipio} {uf} e como entrar em contato","secretaria municipal de educação {municipio} {uf} telefone e-mail secretário atual"]'::jsonb
);