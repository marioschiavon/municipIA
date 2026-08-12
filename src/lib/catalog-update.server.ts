// Persiste o resultado do pipeline no catálogo e recalcula score.
// Server-only.
import type { ProspectResult } from "./prospect.types";
import { calcularScore, contarCampos } from "./catalog-score";

export type ProspectFase = "completo" | "dominio" | "secretario" | "contato";

// E-mail genérico da prefeitura (ouvidoria, fale conosco...) — não é contato
// direto da Secretaria de Educação. Mesma lista de GENERIC_LOCAL em
// prospect.server.ts; reaproveitada aqui só para decidir se marca "contato"
// para revisão no modo completo (que não expõe `confianca`/`revisar` por
// não ser uma fase isolada — essas fases têm o sinal mais preciso).
const GENERIC_LOCAL = /^(ouvidoria|faleconosco|fale-conosco|falecom|contato|imprensa|gabinete|prefeito|atendimento|protocolo|rh)@/i;

function mergeRevisaoMotivos(
  atuais: string[],
  fase: "dominio" | "secretario" | "contato",
  novoMotivo: string | null | undefined,
): string[] {
  const prefix = `${fase}:`;
  const semFase = atuais.filter((m) => !m.startsWith(prefix));
  return novoMotivo ? [...semFase, novoMotivo] : semFase;
}

type EquipeMembro = { nome: string; cargo: string; email: string | null; telefone: string | null };

const normNome = (n: string) =>
  n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Mescla a equipe já gravada com a encontrada agora: não apaga ninguém,
 * deduplica por nome e enriquece cargo/e-mail/telefone quando faltavam.
 * Retorna a MESMA referência quando nada muda (evita UPDATE desnecessário).
 */
function mergeEquipe(
  atual: EquipeMembro[],
  nova: ProspectResult["equipe"],
): EquipeMembro[] {
  if (!nova || nova.length === 0) return atual;
  const out: EquipeMembro[] = (atual ?? []).map((m) => ({ ...m }));
  const idx = new Map(out.map((m, i) => [normNome(m.nome ?? ""), i]));
  let mudou = false;

  for (const e of nova) {
    const nome = (e.nome ?? "").trim();
    if (!nome) continue;
    const key = normNome(nome);
    const at = idx.get(key);
    if (at === undefined) {
      out.push({ nome, cargo: e.cargo ?? "", email: e.email ?? null, telefone: e.telefone ?? null });
      idx.set(key, out.length - 1);
      mudou = true;
      continue;
    }
    const cur = out[at];
    if (!cur.cargo && e.cargo) { cur.cargo = e.cargo; mudou = true; }
    if (!cur.email && e.email) { cur.email = e.email; mudou = true; }
    if (!cur.telefone && e.telefone) { cur.telefone = e.telefone; mudou = true; }
  }

  return mudou ? out : atual;
}

/** Coluna que guarda a última tentativa de prospecção por fase (cursor do rodízio de lotes). */
export const TENTATIVA_COL = {
  dominio: "tentativa_dominio_em",
  secretario: "tentativa_secretario_em",
  contato: "tentativa_contato_em",
  completo: "tentativa_completo_em",
} as const;

/**
 * Marca que este município JÁ foi tentado nesta fase — independente de ter
 * encontrado algo. É o cursor que faz o próximo lote continuar de onde parou
 * em vez de recomeçar sempre pelos mesmos "não encontrados".
 */
export async function marcarTentativaProspeccao(ibgeId: number, fase: ProspectFase) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date().toISOString();
  const patch =
    fase === "completo"
      ? {
          tentativa_completo_em: now,
          tentativa_dominio_em: now,
          tentativa_secretario_em: now,
          tentativa_contato_em: now,
        }
      : { [TENTATIVA_COL[fase]]: now };
  await supabaseAdmin
    .from("municipios_educacao")
    .upsert({ ibge_id: ibgeId, ...patch }, { onConflict: "ibge_id" });
}

export async function persistProspectResult(ibgeId: number, result: ProspectResult, fase: ProspectFase = "completo") {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (fase !== "completo") {
    await persistFaseIsolada(supabaseAdmin, ibgeId, result, fase);
    return;
  }


  const [{ data: mun }, { data: existente }] = await Promise.all([
    supabaseAdmin.from("municipios").select("populacao, matriculas_total, fnde_anual").eq("ibge_id", ibgeId).maybeSingle(),
    supabaseAdmin
      .from("municipios_educacao")
      .select("secretario, cargo, emails, telefones, equipe, horario, fonte, fonte_url, status, atualizado_em, revisao_motivos")
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
  // Equipe nunca é apagada: mescla o que já existia com o que veio agora.
  const equipe = preservar
    ? (existente!.equipe ?? [])
    : mergeEquipe(existente?.equipe ?? [], result.equipe);
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

  // Modo completo não expõe confiança por campo — só sinaliza revisão quando
  // o único e-mail salvo é genérico (ouvidoria/faleconosco/...), reaproveitando
  // o mesmo critério das fases isoladas.
  let revisao_motivos: string[] = existente?.revisao_motivos ?? [];
  if (!preservar) {
    const somenteGenerico = emails.length > 0 && emails.every((e: string) => GENERIC_LOCAL.test(e));
    revisao_motivos = mergeRevisaoMotivos(
      revisao_motivos,
      "contato",
      somenteGenerico ? "contato: apenas e-mail genérico (ouvidoria/faleconosco/etc.)" : null,
    );
  }

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
      revisao_motivos,
      revisao_necessaria: revisao_motivos.length > 0,
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

// Persiste o resultado de UMA fase isolada (dominio/secretario/contato) — só
// escreve as colunas daquela fase, nunca mexe nas das outras. Se a fase não
// achou nada (status "not_found"), não sobrescreve nada — deixa o dado
// existente (ou a ausência dele) como está, e não mexe na fila de revisão
// dessa fase (nada de novo pra revisar).
async function persistFaseIsolada(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  ibgeId: number,
  result: ProspectResult,
  fase: "dominio" | "secretario" | "contato",
) {
  if (result.status === "not_found") return;

  const [{ data: mun }, { data: existente }] = await Promise.all([
    supabaseAdmin.from("municipios").select("populacao, matriculas_total, fnde_anual").eq("ibge_id", ibgeId).maybeSingle(),
    supabaseAdmin
      .from("municipios_educacao")
      .select("secretario, cargo, emails, telefones, equipe, horario, status, revisao_motivos")
      .eq("ibge_id", ibgeId)
      .maybeSingle(),
  ]);

  const now = new Date().toISOString();
  const revisao_motivos = mergeRevisaoMotivos(existente?.revisao_motivos ?? [], fase, result.revisar ? (result.motivoRevisao ?? `${fase}: revisão necessária`) : null);

  const patch: Record<string, unknown> = {
    revisao_motivos,
    revisao_necessaria: revisao_motivos.length > 0,
  };

  let secretario = existente?.secretario ?? null;
  let cargo = existente?.cargo ?? null;
  let emails: string[] = existente?.emails ?? [];
  let telefones: string[] = existente?.telefones ?? [];
  let equipe = existente?.equipe ?? [];

  // A equipe pode aparecer em QUALQUER fase (o SERP/scrape costuma trazer a
  // lista de coordenadores junto). Em vez de sobrescrever, mesclamos sempre —
  // nunca apagamos a equipe já gravada quando a fase atual não trouxe nada.
  const equipeMesclada = mergeEquipe(equipe, result.equipe);
  if (equipeMesclada !== equipe) {
    equipe = equipeMesclada;
    patch.equipe = equipe;
  }

  if (fase === "dominio") {
    if (result.dominioOficialConfirmado) {
      patch.dominio_oficial = result.dominioOficialConfirmado;
      patch.dominio_confirmado_em = now;
    }
    if (result.paginaEducacaoUrl) patch.pagina_educacao_url = result.paginaEducacaoUrl;
  } else if (fase === "secretario") {
    secretario = result.secretario;
    cargo = result.cargo;
    patch.secretario = secretario;
    patch.cargo = cargo;
    patch.secretario_confirmado_em = now;
  } else {
    emails = result.emails ?? [];
    telefones = result.telefones ?? [];
    patch.emails = emails;
    patch.telefones = telefones;
    patch.contato_confirmado_em = now;
  }

  const campos = contarCampos({ secretario, cargo, emails, telefones, horario: existente?.horario ?? null, equipe });
  const { score, faixa, breakdown } = calcularScore({
    populacao: mun?.populacao ?? 0,
    matriculas_total: mun?.matriculas_total ?? 0,
    fnde_anual: Number(mun?.fnde_anual ?? 0),
    campos_preenchidos: campos,
    atualizado_em: now,
  });
  patch.score = score;
  patch.faixa = faixa;
  patch.breakdown = breakdown;
  patch.atualizado_em = now;
  // Nunca rebaixa um status melhor já existente — só promove de "sem_dados" pra "pendente".
  if (!existente?.status || existente.status === "sem_dados") patch.status = "pendente";

  const { error } = await supabaseAdmin.from("municipios_educacao").update(patch).eq("ibge_id", ibgeId);
  if (error) throw new Error(error.message);
}
