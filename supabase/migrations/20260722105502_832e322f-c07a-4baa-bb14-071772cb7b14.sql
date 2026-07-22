-- 1. Roles system
CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'viewer');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 2. Auto-promote first admin by email
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.email = 'mario@s7.dev.br' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_role
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- 3. Matriculas por etapa
CREATE TYPE public.etapa_ensino AS ENUM (
  'creche', 'pre_escola', 'fundamental_ai', 'fundamental_af',
  'medio', 'eja', 'especial', 'profissionalizante'
);

CREATE TABLE public.municipios_matriculas_etapa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ibge_id INTEGER NOT NULL,
  etapa public.etapa_ensino NOT NULL,
  matriculas INTEGER NOT NULL DEFAULT 0,
  ano INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM now())::INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ibge_id, etapa, ano)
);

CREATE INDEX idx_mme_ibge ON public.municipios_matriculas_etapa(ibge_id);

GRANT SELECT ON public.municipios_matriculas_etapa TO anon, authenticated;
GRANT ALL ON public.municipios_matriculas_etapa TO service_role;

ALTER TABLE public.municipios_matriculas_etapa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read matriculas etapa" ON public.municipios_matriculas_etapa
  FOR SELECT USING (true);
CREATE POLICY "admin manage matriculas etapa" ON public.municipios_matriculas_etapa
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_mme_updated BEFORE UPDATE ON public.municipios_matriculas_etapa
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Score config singleton
CREATE TABLE public.score_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pesos_macro JSONB NOT NULL DEFAULT '{"porte":35,"financeiro":30,"completude":20,"recencia":15}'::jsonb,
  pesos_etapa JSONB NOT NULL DEFAULT '{"creche":1,"pre_escola":1,"fundamental_ai":1.2,"fundamental_af":1.2,"medio":1,"eja":0.7,"especial":0.8,"profissionalizante":0.8}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.score_config (id) VALUES (1);

GRANT SELECT ON public.score_config TO anon, authenticated;
GRANT ALL ON public.score_config TO service_role;

ALTER TABLE public.score_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read score config" ON public.score_config
  FOR SELECT USING (true);
CREATE POLICY "admin update score config" ON public.score_config
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_sc_updated BEFORE UPDATE ON public.score_config
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Allow admins to write to municipios / municipios_educacao (currently locked)
CREATE POLICY "admin manage municipios" ON public.municipios
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin manage municipios_educacao" ON public.municipios_educacao
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.municipios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.municipios_educacao TO authenticated;

-- 6. Zerar dados mocados
UPDATE public.municipios SET
  populacao = 0, matriculas_total = 0, escolas = 0,
  fnde_anual = 0, pib_percapita = 0;

UPDATE public.municipios_educacao SET
  secretario = NULL, cargo = NULL, email = NULL, telefone = NULL,
  horario = NULL, equipe = '[]'::jsonb, fonte = NULL, fonte_url = NULL,
  status = 'sem_dados', score = 0, faixa = 'baixo',
  breakdown = '{}'::jsonb, atualizado_em = NULL;