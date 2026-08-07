// Consolidação do catálogo a partir do que já está gravado em `inep_escolas`.
// Separado do endpoint de import para poder ser reexecutado sozinho ("Reconsolidar"),
// sem reenviar o arquivo do Censo (200k+ linhas já estão no banco). Server-only.

import { fetchAllByKeyset, PG_PAGE } from "./pg-paginate.server";

type Send = (event: { type: string; message: string; data?: unknown }) => Promise<void> | void;

/** Conta escolas municipais ativas (dep=3, situação=1) por município, varrendo o banco inteiro. */
export async function recontarEscolasMunicipais(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  ano: number,
  send?: Send,
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  const rows = await fetchAllByKeyset<{ co_entidade: number; ibge_id: number }>(
    (after) => {
      let q = supabaseAdmin
        .from("inep_escolas")
        .select("co_entidade, ibge_id")
        .eq("ano", ano)
        .eq("tp_dependencia", 3)
        .eq("tp_situacao", 1)
        .order("co_entidade", { ascending: true })
        .limit(PG_PAGE);
      if (after !== null) q = q.gt("co_entidade", after);
      return q;
    },
    (r) => Number(r.co_entidade),
    "inep_escolas/recontagem",
    async (loaded) => {
      if (send && loaded % 50000 === 0) {
        await send({ type: "progress", message: `↳ recontagem: ${loaded.toLocaleString("pt-BR")} escolas municipais ativas lidas...` });
      }
    },
  );
  for (const r of rows) counts.set(Number(r.ibge_id), (counts.get(Number(r.ibge_id)) ?? 0) + 1);
  if (send) {
    await send({
      type: "progress",
      message: `Recontagem completa: ${rows.length.toLocaleString("pt-BR")} escolas · ${counts.size.toLocaleString("pt-BR")} municípios com rede municipal ativa.`,
    });
  }
  return counts;
}

/** Aplica as contagens no catálogo. Retorna quantos municípios foram atualizados. */
export async function aplicarContagemEscolas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  counts: Map<number, number>,
): Promise<{ updated: number; notFound: number; sampleNotFound: number[] }> {
  const entries = Array.from(counts.entries());
  let idx = 0;
  let updated = 0;
  let notFound = 0;
  const sampleNotFound: number[] = [];
  const CONC = 20;
  async function worker() {
    while (idx < entries.length) {
      const [ibge, count] = entries[idx++];
      const { data, error } = await supabaseAdmin
        .from("municipios")
        .update({ escolas: count })
        .eq("ibge_id", ibge)
        .select("ibge_id")
        .maybeSingle();
      if (error) throw new Error(`municipios ${ibge}: ${error.message}`);
      if (data) updated++;
      else {
        notFound++;
        if (sampleNotFound.length < 5) sampleNotFound.push(ibge);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  return { updated, notFound, sampleNotFound };
}
