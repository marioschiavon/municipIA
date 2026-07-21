// Persiste o resultado do pipeline no catálogo e recalcula score.
// Server-only.
import type { ProspectResult } from "./prospect.types";
import { calcularScore, contarCampos } from "./catalog-score";

export async function persistProspectResult(ibgeId: number, result: ProspectResult) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: mun } = await supabaseAdmin
    .from("municipios")
    .select("populacao, matriculas_total, fnde_anual")
    .eq("ibge_id", ibgeId)
    .maybeSingle();

  const email = result.emails[0] ?? null;
  const telefone = result.telefones[0] ?? null;
  const equipe = (result.equipe ?? []).map((e) => ({
    nome: e.nome,
    cargo: e.cargo ?? "",
    email: e.email ?? null,
    telefone: e.telefone ?? null,
  }));

  const atualizado_em = new Date().toISOString();
  const status = result.status === "found" ? "validado" : result.status === "partial" ? "pendente" : "sem_dados";

  const campos = contarCampos({
    secretario: result.secretario,
    cargo: result.cargo,
    email,
    telefone,
    horario: result.horarioAtendimento ?? null,
    equipe,
  });

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
      secretario: result.secretario,
      cargo: result.cargo,
      email,
      telefone,
      horario: result.horarioAtendimento ?? null,
      equipe,
      fonte: result.fonte,
      fonte_url: result.fonteUrl,
      status,
      atualizado_em,
      score,
      faixa,
      breakdown,
    },
    { onConflict: "ibge_id" },
  );
  if (error) throw new Error(error.message);
}
