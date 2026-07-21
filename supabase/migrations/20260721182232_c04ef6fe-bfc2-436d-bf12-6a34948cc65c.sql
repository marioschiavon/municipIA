
-- Catálogo base
CREATE TABLE public.municipios (
  ibge_id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  uf TEXT NOT NULL,
  slug TEXT NOT NULL,
  populacao INTEGER NOT NULL DEFAULT 0,
  matriculas_total INTEGER NOT NULL DEFAULT 0,
  escolas INTEGER NOT NULL DEFAULT 0,
  fnde_anual NUMERIC NOT NULL DEFAULT 0,
  pib_percapita NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.municipios TO anon;
GRANT SELECT ON public.municipios TO authenticated;
GRANT ALL ON public.municipios TO service_role;
ALTER TABLE public.municipios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read municipios" ON public.municipios FOR SELECT USING (true);

CREATE INDEX municipios_uf_idx ON public.municipios (uf);
CREATE INDEX municipios_nome_idx ON public.municipios (nome);
CREATE INDEX municipios_populacao_idx ON public.municipios (populacao DESC);

-- Contatos + score
CREATE TABLE public.municipios_educacao (
  ibge_id INTEGER PRIMARY KEY REFERENCES public.municipios(ibge_id) ON DELETE CASCADE,
  secretario TEXT,
  cargo TEXT,
  email TEXT,
  telefone TEXT,
  horario TEXT,
  equipe JSONB NOT NULL DEFAULT '[]'::jsonb,
  fonte TEXT,
  fonte_url TEXT,
  status TEXT NOT NULL DEFAULT 'sem_dados',
  score INTEGER NOT NULL DEFAULT 0,
  faixa TEXT NOT NULL DEFAULT 'baixo',
  breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.municipios_educacao TO anon;
GRANT SELECT ON public.municipios_educacao TO authenticated;
GRANT ALL ON public.municipios_educacao TO service_role;
ALTER TABLE public.municipios_educacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read municipios_educacao" ON public.municipios_educacao FOR SELECT USING (true);

CREATE INDEX me_score_idx ON public.municipios_educacao (score DESC);
CREATE INDEX me_status_idx ON public.municipios_educacao (status);
CREATE INDEX me_faixa_idx ON public.municipios_educacao (faixa);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER municipios_set_updated_at BEFORE UPDATE ON public.municipios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER municipios_educacao_set_updated_at BEFORE UPDATE ON public.municipios_educacao
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
