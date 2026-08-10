-- Índice em matriculas_total, para paridade com o índice já existente em
-- populacao (municipios_populacao_idx) — usado pela ordenação "Matrículas"
-- no catálogo público (/).
CREATE INDEX IF NOT EXISTS municipios_matriculas_total_idx ON public.municipios (matriculas_total DESC);
