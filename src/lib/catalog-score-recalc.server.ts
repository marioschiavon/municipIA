// Recálculo em massa de score/faixa/breakdown para todos os municípios.
// Compartilhado entre o botão manual (admin.functions.ts) e o passo automático
// que roda ao final de cada import (routes/api/admin/import.ts), para evitar
// que as duas cópias divirjam (uma corrigida, outra não).
// Server-only.

export async function recalcularScoresDeTodosMunicipios(supabaseAdmin: any) {
  const { calcularScore, contarCampos } = await import("./catalog-score");
  const { fetchAllByRange } = await import("./pg-paginate.server");

  // A Data API (PostgREST) devolve no máximo 1.000 linhas por request —
  // paginar é obrigatório, senão só os primeiros 1.000 municípios recebem score.
  const munis = await fetchAllByRange<any>(
    (from, to) =>
      supabaseAdmin
        .from("municipios")
        .select("ibge_id, populacao, matriculas_total, fnde_anual")
        .order("ibge_id", { ascending: true })
        .range(from, to),
    "municipios",
  );

  const edus = await fetchAllByRange<any>(
    (from, to) =>
      supabaseAdmin
        .from("municipios_educacao")
        .select("ibge_id, secretario, cargo, emails, telefones, horario, equipe, atualizado_em")
        .order("ibge_id", { ascending: true })
        .range(from, to),
    "municipios_educacao",
  );

  const eduMap = new Map((edus ?? []).map((e: any) => [e.ibge_id, e]));
  const faixas = { alto: 0, medio: 0, baixo: 0 };
  const BATCH = 500;
  let processed = 0;
  const updates: any[] = [];

  for (const m of munis ?? []) {
    const e = eduMap.get(m.ibge_id);
    const campos = contarCampos({
      secretario: e?.secretario,
      cargo: e?.cargo,
      emails: e?.emails,
      telefones: e?.telefones,
      horario: e?.horario,
      equipe: e?.equipe,
    });
    const { score, faixa, breakdown } = calcularScore({
      populacao: m.populacao ?? 0,
      matriculas_total: m.matriculas_total ?? 0,
      fnde_anual: Number(m.fnde_anual ?? 0),
      campos_preenchidos: campos,
      atualizado_em: e?.atualizado_em ?? null,
    });
    faixas[faixa as keyof typeof faixas]++;
    updates.push({ ibge_id: m.ibge_id, score, faixa, breakdown });
    if (updates.length >= BATCH) {
      const { error } = await supabaseAdmin
        .from("municipios_educacao")
        .upsert(updates, { onConflict: "ibge_id" });
      if (error) throw new Error(error.message);
      processed += updates.length;
      updates.length = 0;
    }
  }
  if (updates.length) {
    const { error } = await supabaseAdmin
      .from("municipios_educacao")
      .upsert(updates, { onConflict: "ibge_id" });
    if (error) throw new Error(error.message);
    processed += updates.length;
  }
  return { total: processed, faixas };
}
