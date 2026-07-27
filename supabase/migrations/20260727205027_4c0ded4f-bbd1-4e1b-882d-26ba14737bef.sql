CREATE TABLE public.inep_escolas (
  co_entidade BIGINT PRIMARY KEY,
  ibge_id INTEGER NOT NULL,
  tp_dependencia SMALLINT NOT NULL,
  tp_situacao SMALLINT NOT NULL DEFAULT 1,
  ano INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inep_escolas_ibge ON public.inep_escolas(ibge_id);
CREATE INDEX idx_inep_escolas_municipal ON public.inep_escolas(ibge_id) WHERE tp_dependencia = 3 AND tp_situacao = 1;

GRANT SELECT ON public.inep_escolas TO authenticated;
GRANT ALL ON public.inep_escolas TO service_role;

ALTER TABLE public.inep_escolas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read inep_escolas" ON public.inep_escolas
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin manage inep_escolas" ON public.inep_escolas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_inep_escolas_updated
  BEFORE UPDATE ON public.inep_escolas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();