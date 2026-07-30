// Persiste o resultado do pipeline no catálogo e recalcula score.
// Server-only.
import type { ProspectResult } from "./prospect.types";
import { calcularScore, contarCampos } from "./catalog-score";

export async function persistProspectResult(ibgeId: number, result: ProspectResult) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [{ data: mun }, { data: existente }] = await Promise.all([
    supabaseAdmin.from("municipios").select("populacao, matriculas_total, fnde_anual").eq("ibge_id", ibgeId).maybeSingle(),
    supabaseAdmin
      .from("municipios_educacao")
      .select("secretario, cargo, emails, telefones, equipe, horario, fonte, fonte_url, status, atualizado_em")
      .eq("ibge_id", ibgeId)
      .maybeSingle() as any,
  ]);

  // Estágio 0 (domínio confirmado) não tem rede de segurança do Google — um
  // site fora do ar por alguns minutos não pode apagar um contato bom já
  // validado. Se a run voltou "not_found" e já havia dado bom salvo, preserva
  // o que já existia em vez de sobrescrever com campos vazios.
  const existiaDadoBom = !!(existente?.secretario || (existente?.emails?.length ?? 0) > 0 || (existente?.telefones?.length ?? 0) > 0);
  const preservar = result.status === "not_found" && existiaDadoBom;

  const secretario = preservar ? existente!.secretario : result.secretario;
  const cargo = preservar ? existente!.cargo : result.cargo;
  const emails = preservar ? (existente!.emails ?? []) : (result.emails ?? []);
  const telefones = preservar ? (existente!.telefones ?? []) : (result.telefones ?? []);
  const equipe = preservar
    ? (existente!.equipe ?? [])
    : (result.equipe ?? []).map((e) => ({
        nome: e.nome,
        cargo: e.cargo ?? "",
        email: e.email ?? null,
        telefone: e.telefone ?? null,
      }));
  const horario = preservar ? existente!.horario : (result.horarioAtendimento ?? null);
  const fonte = preservar ? existente!.fonte : result.fonte;
  const fonte_url = preservar ? existente!.fonte_url : result.fonteUrl;
  const status = preservar
    ? existente!.status
    : result.status === "found" ? "validado" : result.status === "partial" ? "pendente" : "sem_dados";
  const atualizado_em = preservar ? (existente!.atualizado_em ?? new Date().toISOString()) : new Date().toISOString();

  const campos = contarCampos({ secretario, cargo, emails, telefones, horario, equipe });

  const { score, faixa, breakdown } = calcularScore({
    populacao: mun?.populacao ?? 0,
    matriculas_total: mun?.matriculas_total ?? 0,
    fnde_anual: Number(mun?.fnde_anual ?? 0),
    campos_preenchidos: campos,
    atualizado_em,
  });

  const { error } = await supabaseAdmin.from("municipios_educacao").upsert(
    {
      ibge_id: ibgeId,
      secretario,
      cargo,
      emails,
      telefones,
      horario,
      equipe,
      fonte,
      fonte_url,
      status,
      atualizado_em,
      score,
      faixa,
      breakdown,
      // Domínio oficial só é gravado/atualizado quando ESTA run confirmou algo —
      // se não confirmou nada, preserva o que já estava salvo (só o admin limpa manualmente).
      ...(result.dominioOficialConfirmado
        ? { dominio_oficial: result.dominioOficialConfirmado, dominio_confirmado_em: new Date().toISOString() }
        : {}),
      ...(result.paginaEducacaoUrl ? { pagina_educacao_url: result.paginaEducacaoUrl } : {}),
    },
    { onConflict: "ibge_id" },
  );
  if (error) throw new Error(error.message);
}
