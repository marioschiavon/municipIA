// Query da Visão Geral por IA — configurável pelo painel /admin/queries.
// Server-only: lê a tabela prospect_query_config com fallback para a query
// histórica (a que já era usada fixa no código).

export const QUERY_AI_OVERVIEW_PADRAO =
  "nome e contato do secretário(a) de educação de {municipio} {uf}";

export function renderQueryTemplate(template: string, municipio: string, uf: string): string {
  return template
    .replace(/\{municipio\}/gi, municipio)
    .replace(/\{uf\}/gi, uf)
    .trim();
}

let cache: { value: string; at: number } | null = null;
const TTL_MS = 60_000;

/** Template configurado (com placeholders), com cache curto em memória. */
export async function getQueryAiOverviewTemplate(): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("prospect_query_config")
      .select("query_ai_overview")
      .eq("id", 1)
      .maybeSingle();
    const value = (data?.query_ai_overview ?? "").trim() || QUERY_AI_OVERVIEW_PADRAO;
    cache = { value, at: Date.now() };
    return value;
  } catch {
    return QUERY_AI_OVERVIEW_PADRAO;
  }
}

/** Query final já com município/UF aplicados. */
export async function getQueryAiOverview(municipio: string, uf: string): Promise<string> {
  return renderQueryTemplate(await getQueryAiOverviewTemplate(), municipio, uf);
}
