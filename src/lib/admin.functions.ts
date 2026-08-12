// Server functions administrativas. Todas exigem role 'admin'.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: requer papel admin");
}

// ============ Elegibilidade por fase (prospecção em lotes) ============
// Fase "dominio": ainda não tem domínio oficial confirmado.
// Fase "secretario"/"contato": já tem domínio confirmado (senão não tem onde
// vasculhar sem recorrer ao Google/Apify) e ainda não achou o próprio campo.
// (Sem checagem de "dado desatualizado há N dias" nesta v1 — reprocessar
// dado antigo pode ser adicionado depois; por ora elegibilidade = "nunca achado".)
type ProspectFaseFiltro = "dominio" | "secretario" | "contato" | "completo";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFaseFilter(q: any, fase?: ProspectFaseFiltro) {
  if (fase === "dominio") return q.is("municipios_educacao.dominio_oficial", null);
  if (fase === "secretario") {
    return q
      .not("municipios_educacao.dominio_oficial", "is", null)
      .is("municipios_educacao.secretario", null);
  }
  if (fase === "contato") {
    return q
      .not("municipios_educacao.dominio_oficial", "is", null)
      .eq("municipios_educacao.emails", "{}")
      .eq("municipios_educacao.telefones", "{}");
  }
  // "completo" roda a pipeline inteira (descobre o domínio sozinho): elegível é
  // quem ainda não tem secretário OU não tem nenhum contato.
  if (fase === "completo") {
    return q.or(
      "secretario.is.null,and(emails.eq.{},telefones.eq.{})",
      { referencedTable: "municipios_educacao" },
    );
  }
  return q;
}

// ============ ROLE CHECK ============
export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (data ?? []).map((r: any) => r.role);
    return { userId: context.userId, roles, isAdmin: roles.includes("admin") };
  });

// ============ DASHBOARD STATS ============
export const adminGetStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [
      { count: total },
      { count: comContatos },
      { count: validados },
      { count: comMatriculas },
      { count: scoreNaoCalculado },
    ] = await Promise.all([
      supabaseAdmin.from("municipios").select("ibge_id", { count: "exact", head: true }),
      supabaseAdmin
        .from("municipios_educacao")
        .select("ibge_id", { count: "exact", head: true })
        .not("emails", "eq", "{}"),
      supabaseAdmin
        .from("municipios_educacao")
        .select("ibge_id", { count: "exact", head: true })
        .eq("status", "validado"),
      supabaseAdmin
        .from("municipios")
        .select("ibge_id", { count: "exact", head: true })
        .gt("matriculas_total", 0),
      // breakdown = '{}' é o valor default da coluna — calcularScore() sempre
      // grava um objeto com 5 chaves, então '{}' só ocorre quando o score
      // nunca foi (re)calculado para essa linha (não é o mesmo que score = 0).
      supabaseAdmin
        .from("municipios_educacao")
        .select("ibge_id", { count: "exact", head: true })
        .eq("breakdown", "{}"),
    ]);
    return {
      total: total ?? 0,
      comContatos: comContatos ?? 0,
      validados: validados ?? 0,
      comMatriculas: comMatriculas ?? 0,
      scoreNaoCalculado: scoreNaoCalculado ?? 0,
    };
  });

// ============ LIST (admin, com filtros) ============
const ListInput = z.object({
  uf: z.string().length(2).optional(),
  status: z.string().optional(),
  q: z.string().optional(),
  revisao: z.boolean().optional(),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(200).default(50),
});
export const adminListMunicipios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("municipios")
      .select(
        "ibge_id, nome, uf, populacao, matriculas_total, fnde_anual, municipios_educacao!inner(status, score, faixa, emails, secretario, atualizado_em, revisao_necessaria)",
        { count: "exact" },
      );
    if (data.uf) q = q.eq("uf", data.uf);
    if (data.q) q = q.ilike("nome", `%${data.q}%`);
    if (data.status) q = q.eq("municipios_educacao.status", data.status);
    if (data.revisao) q = q.eq("municipios_educacao.revisao_necessaria", true);
    q = q.order("nome", { ascending: true });
    const from = data.page * data.pageSize;
    q = q.range(from, from + data.pageSize - 1);
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return {
      total: count ?? 0,
      items: (rows ?? []).map((r: any) => ({
        ibge_id: r.ibge_id,
        nome: r.nome,
        uf: r.uf,
        populacao: r.populacao,
        matriculas_total: r.matriculas_total,
        fnde_anual: Number(r.fnde_anual),
        status: r.municipios_educacao?.status ?? "sem_dados",
        score: r.municipios_educacao?.score ?? 0,
        faixa: r.municipios_educacao?.faixa ?? "baixo",
        emails: r.municipios_educacao?.emails ?? [],
        secretario: r.municipios_educacao?.secretario ?? null,
        atualizado_em: r.municipios_educacao?.atualizado_em ?? null,
        revisao_necessaria: r.municipios_educacao?.revisao_necessaria ?? false,
      })),
    };
  });

// ============ LIST ALL IDS (sem paginação, para prospecção em massa) ============
const ListAllIdsInput = z.object({
  uf: z.string().length(2).optional(),
  status: z.string().optional(),
  q: z.string().optional(),
  fase: z.enum(["dominio", "secretario", "contato", "completo"]).optional(),
  /** Tamanho do lote — o servidor já devolve só o necessário, na ordem do rodízio. */
  limit: z.number().int().min(1).max(5000).optional(),
  /** "continuar" = nunca tentados primeiro; "repescagem" = só os já tentados (mais antigos primeiro). */
  modo: z.enum(["continuar", "repescagem"]).default("continuar"),
});

/** Colunas de tentativa por fase — cursor do rodízio de lotes. */
const TENTATIVA_COL = {
  dominio: "tentativa_dominio_em",
  secretario: "tentativa_secretario_em",
  contato: "tentativa_contato_em",
  completo: "tentativa_completo_em",
} as const;

// Filtro de elegibilidade quando a consulta parte de `municipios_educacao`
// (necessário para ordenar por tentativa no nível de cima).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFaseFilterEdu(q: any, fase: ProspectFaseFiltro) {
  if (fase === "dominio") return q.is("dominio_oficial", null);
  if (fase === "secretario") return q.not("dominio_oficial", "is", null).is("secretario", null);
  if (fase === "completo") return q.or("secretario.is.null,and(emails.eq.{},telefones.eq.{})");
  return q
    .not("dominio_oficial", "is", null)
    .eq("emails", "{}")
    .eq("telefones", "{}");
}

export const adminListMunicipioIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListAllIdsInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const items: Array<{ ibge_id: number; nome: string; uf: string }> = [];

    // Com fase definida a busca parte de municipios_educacao, para poder ordenar
    // pela coluna de tentativa (rodízio: nunca tentados primeiro, depois os mais antigos).
    if (data.fase) {
      const col = TENTATIVA_COL[data.fase];
      let q = supabaseAdmin
        .from("municipios_educacao")
        .select("ibge_id, municipios!inner(nome, uf)")
        .order(col, { ascending: true, nullsFirst: data.modo === "continuar" })
        .order("ibge_id", { ascending: true })
        .limit(data.limit ?? 1000);
      if (data.uf) q = q.eq("municipios.uf", data.uf);
      if (data.q) q = q.ilike("municipios.nome", `%${data.q}%`);
      if (data.status) q = q.eq("status", data.status);
      if (data.modo === "repescagem") q = q.not(col, "is", null);
      q = applyFaseFilterEdu(q, data.fase);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of (rows ?? []) as any[])
        items.push({ ibge_id: r.ibge_id, nome: r.municipios?.nome, uf: r.municipios?.uf });
      return { items };
    }

    const CHUNK = 1000;
    let from = 0;
    for (;;) {
      let q = supabaseAdmin
        .from("municipios")
        .select("ibge_id, nome, uf, municipios_educacao!inner(status)")
        .order("nome", { ascending: true })
        .range(from, from + CHUNK - 1);
      if (data.uf) q = q.eq("uf", data.uf);
      if (data.q) q = q.ilike("nome", `%${data.q}%`);
      if (data.status) q = q.eq("municipios_educacao.status", data.status);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of (rows ?? []) as any[])
        items.push({ ibge_id: r.ibge_id, nome: r.nome, uf: r.uf });
      if (!rows || rows.length < CHUNK) break;
      from += CHUNK;
      if (data.limit && items.length >= data.limit) break;
    }
    return { items: data.limit ? items.slice(0, data.limit) : items };
  });

// ============ CICLO DE PROSPECÇÃO (quanto do rodízio já foi percorrido) ============
const CicloInput = z.object({
  fase: z.enum(["dominio", "secretario", "contato", "completo"]),
  uf: z.string().length(2).optional(),
  q: z.string().optional(),
  status: z.string().optional(),
});
export const adminProspeccaoCiclo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CicloInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const col = TENTATIVA_COL[data.fase];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base = (head: boolean) => {
      let q = supabaseAdmin
        .from("municipios_educacao")
        .select("ibge_id, municipios!inner(nome, uf)", head ? { count: "exact", head: true } : { count: "exact" });
      if (data.uf) q = q.eq("municipios.uf", data.uf);
      if (data.q) q = q.ilike("municipios.nome", `%${data.q}%`);
      if (data.status) q = q.eq("status", data.status);
      return applyFaseFilterEdu(q, data.fase);
    };

    const [{ count: elegiveis }, { count: pendentesCiclo }, { data: proximo }] = await Promise.all([
      base(true),
      base(true).is(col, null),
      base(false)
        .order(col, { ascending: true, nullsFirst: true })
        .order("ibge_id", { ascending: true })
        .limit(1),
    ]);

    const total = elegiveis ?? 0;
    const naoTentados = pendentesCiclo ?? 0;
    const primeiro = (proximo ?? [])[0] as any;
    return {
      elegiveis: total,
      naoTentados,
      jaTentados: Math.max(0, total - naoTentados),
      proximo: primeiro
        ? { ibge_id: primeiro.ibge_id, nome: primeiro.municipios?.nome, uf: primeiro.municipios?.uf }
        : null,
    };
  });

// ============ REINICIAR CICLO (limpa as marcas de tentativa da fase) ============
export const adminResetCicloProspeccao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      fase: z.enum(["dominio", "secretario", "contato", "completo"]),
      uf: z.string().length(2).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const col = TENTATIVA_COL[data.fase];

    if (data.uf) {
      const { data: muns, error: mErr } = await supabaseAdmin
        .from("municipios")
        .select("ibge_id")
        .eq("uf", data.uf);
      if (mErr) throw new Error(mErr.message);
      const ids = (muns ?? []).map((m: any) => m.ibge_id);
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { error } = await supabaseAdmin
          .from("municipios_educacao")
          .update({ [col]: null } as never)
          .in("ibge_id", ids.slice(i, i + CHUNK));
        if (error) throw new Error(error.message);
      }
      return { ok: true, afetados: ids.length };
    }

    const { error } = await supabaseAdmin
      .from("municipios_educacao")
      .update({ [col]: null } as never)
      .not(col, "is", null);
    if (error) throw new Error(error.message);
    return { ok: true, afetados: null };
  });


// ============ COUNT ELEGÍVEIS (badge "N elegíveis" na tela de lote) ============
const CountElegiveisInput = z.object({
  fase: z.enum(["dominio", "secretario", "contato", "completo"]),
  uf: z.string().length(2).optional(),
  status: z.string().optional(),
  q: z.string().optional(),
});
export const adminCountElegiveis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CountElegiveisInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("municipios")
      .select(
        "ibge_id, municipios_educacao!inner(status, dominio_oficial, secretario, emails, telefones)",
        { count: "exact", head: true },
      );
    if (data.uf) q = q.eq("uf", data.uf);
    if (data.q) q = q.ilike("nome", `%${data.q}%`);
    if (data.status) q = q.eq("municipios_educacao.status", data.status);
    q = applyFaseFilter(q, data.fase);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

// ============ GET (completo, com matrículas por etapa) ============
export const adminGetMunicipio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ibge_id: z.number().int() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: m }, { data: edu }, { data: etapas }] = await Promise.all([
      supabaseAdmin.from("municipios").select("*").eq("ibge_id", data.ibge_id).maybeSingle(),
      supabaseAdmin
        .from("municipios_educacao")
        .select("*")
        .eq("ibge_id", data.ibge_id)
        .maybeSingle(),
      supabaseAdmin
        .from("municipios_matriculas_etapa")
        .select("*")
        .eq("ibge_id", data.ibge_id)
        .order("etapa"),
    ]);
    return { municipio: m, educacao: edu, etapas: etapas ?? [] };
  });

// ============ SAVE indicadores + educacao ============
const SaveInput = z.object({
  ibge_id: z.number().int(),
  municipio: z.object({
    populacao: z.number().int().min(0),
    matriculas_total: z.number().int().min(0),
    escolas: z.number().int().min(0),
    fnde_anual: z.number().min(0),
    pib_percapita: z.number().min(0),
  }),
  educacao: z.object({
    secretario: z.string().nullable(),
    cargo: z.string().nullable(),
    emails: z.array(z.string()).default([]),
    telefones: z.array(z.string()).default([]),
    horario: z.string().nullable(),
    fonte: z.string().nullable(),
    fonte_url: z.string().nullable(),
    dominio_oficial: z.string().nullable().optional(),
    pagina_educacao_url: z.string().nullable().optional(),
    status: z.enum(["validado", "pendente", "sem_dados"]),
    equipe: z
      .array(
        z.object({
          nome: z.string(),
          cargo: z.string(),
          email: z.string().nullable().optional(),
          telefone: z.string().nullable().optional(),
        }),
      )
      .default([]),
  }),
  etapas: z
    .array(
      z.object({
        etapa: z.enum([
          "creche",
          "pre_escola",
          "fundamental_ai",
          "fundamental_af",
          "medio",
          "eja",
          "especial",
          "profissionalizante",
        ]),
        matriculas: z.number().int().min(0),
      }),
    )
    .default([]),
  // Fases da fila de revisão a considerar resolvidas por este save (o admin
  // corrigiu ou confirmou manualmente) — remove as entradas correspondentes
  // de revisao_motivos em vez de esperar a próxima run automática.
  limparRevisaoFases: z.array(z.enum(["dominio", "secretario", "contato", "completo"])).optional(),
});

export const adminSaveMunicipio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { calcularScore, contarCampos } = await import("./catalog-score");

    const ano = new Date().getFullYear();
    // matriculas_total agregado
    const matTotal =
      data.etapas.reduce((a, b) => a + b.matriculas, 0) || data.municipio.matriculas_total;

    // Update municipios
    {
      const { error } = await supabaseAdmin
        .from("municipios")
        .update({
          populacao: data.municipio.populacao,
          matriculas_total: matTotal,
          escolas: data.municipio.escolas,
          fnde_anual: data.municipio.fnde_anual,
          pib_percapita: data.municipio.pib_percapita,
        })
        .eq("ibge_id", data.ibge_id);
      if (error) throw new Error(`municipios: ${error.message}`);
    }

    // Upsert etapas (delete previous + insert)
    if (data.etapas.length > 0) {
      await supabaseAdmin
        .from("municipios_matriculas_etapa")
        .delete()
        .eq("ibge_id", data.ibge_id)
        .eq("ano", ano);
      const rows = data.etapas
        .filter((e) => e.matriculas > 0)
        .map((e) => ({
          ibge_id: data.ibge_id,
          etapa: e.etapa,
          matriculas: e.matriculas,
          ano,
        }));
      if (rows.length) {
        const { error } = await supabaseAdmin.from("municipios_matriculas_etapa").insert(rows);
        if (error) throw new Error(`etapas: ${error.message}`);
      }
    }

    // Recalcula score
    const now = new Date().toISOString();
    const campos = contarCampos({
      secretario: data.educacao.secretario,
      cargo: data.educacao.cargo,
      emails: data.educacao.emails,
      telefones: data.educacao.telefones,
      horario: data.educacao.horario,
      equipe: data.educacao.equipe,
    });
    const { score, faixa, breakdown } = calcularScore({
      populacao: data.municipio.populacao,
      matriculas_total: matTotal,
      fnde_anual: data.municipio.fnde_anual,
      campos_preenchidos: campos,
      atualizado_em: now,
    });

    let revisaoPatch: { revisao_motivos: string[]; revisao_necessaria: boolean } | null = null;
    if (data.limparRevisaoFases && data.limparRevisaoFases.length > 0) {
      const { data: existente } = await supabaseAdmin
        .from("municipios_educacao")
        .select("revisao_motivos")
        .eq("ibge_id", data.ibge_id)
        .maybeSingle();
      const atuais: string[] = existente?.revisao_motivos ?? [];
      const prefixes = data.limparRevisaoFases.map((f) => `${f}:`);
      const filtrados = atuais.filter((m) => !prefixes.some((p) => m.startsWith(p)));
      revisaoPatch = { revisao_motivos: filtrados, revisao_necessaria: filtrados.length > 0 };
    }

    const { normalizeHost } = await import("./scraper.server");
    const { error: eErr } = await supabaseAdmin.from("municipios_educacao").upsert(
      {
        ibge_id: data.ibge_id,
        secretario: data.educacao.secretario,
        cargo: data.educacao.cargo,
        emails: data.educacao.emails,
        telefones: data.educacao.telefones,
        horario: data.educacao.horario,
        fonte: data.educacao.fonte,
        fonte_url: data.educacao.fonte_url,
        dominio_oficial: normalizeHost(data.educacao.dominio_oficial ?? null),
        pagina_educacao_url: data.educacao.pagina_educacao_url || null,
        status: data.educacao.status,
        equipe: data.educacao.equipe,
        atualizado_em: now,
        score,
        faixa,
        breakdown,
        ...(revisaoPatch ?? {}),
      },
      { onConflict: "ibge_id" },
    );
    if (eErr) throw new Error(`educacao: ${eErr.message}`);

    return { ok: true, score, faixa };
  });

// ============ BUSCAR FUNDEB ATUAL (SICONFI/RREO) ============
export const adminFetchFndeAtual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ibge_id: z.number().int() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { fetchFundebAtual } = await import("./fnde.server");
    const resultado = await fetchFundebAtual(data.ibge_id);
    if (!resultado) return { ok: false as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { calcularScore, contarCampos } = await import("./catalog-score");

    const { error: mErr } = await supabaseAdmin
      .from("municipios")
      .update({ fnde_anual: resultado.valor })
      .eq("ibge_id", data.ibge_id);
    if (mErr) throw new Error(`municipios: ${mErr.message}`);

    const [{ data: m }, { data: edu }] = await Promise.all([
      supabaseAdmin
        .from("municipios")
        .select("populacao, matriculas_total")
        .eq("ibge_id", data.ibge_id)
        .maybeSingle(),
      supabaseAdmin
        .from("municipios_educacao")
        .select("secretario, cargo, emails, telefones, horario, equipe, atualizado_em")
        .eq("ibge_id", data.ibge_id)
        .maybeSingle() as any,
    ]);
    const campos = contarCampos({
      secretario: edu?.secretario,
      cargo: edu?.cargo,
      emails: edu?.emails,
      telefones: edu?.telefones,
      horario: edu?.horario,
      equipe: edu?.equipe,
    });
    const { score, faixa, breakdown } = calcularScore({
      populacao: m?.populacao ?? 0,
      matriculas_total: m?.matriculas_total ?? 0,
      fnde_anual: resultado.valor,
      campos_preenchidos: campos,
      atualizado_em: edu?.atualizado_em ?? null,
    });
    const { error: eErr } = await supabaseAdmin
      .from("municipios_educacao")
      .upsert({ ibge_id: data.ibge_id, score, faixa, breakdown }, { onConflict: "ibge_id" });
    if (eErr) throw new Error(`educacao: ${eErr.message}`);

    return {
      ok: true as const,
      ano: resultado.ano,
      periodo: resultado.periodo,
      valor: resultado.valor,
      score,
      faixa,
    };
  });

// ============ RESOLVER REVISÃO (aba de prospecção em fases) ============
// Usado pela auditoria inline: fecha o item da fila de revisão de UMA fase,
// opcionalmente gravando uma correção manual do admin. Sem "patch", só limpa
// a sinalização (admin conferiu e aceitou o dado como está).
const ResolveRevisaoInput = z.object({
  ibge_id: z.number().int(),
  fase: z.enum(["dominio", "secretario", "contato", "completo"]),
  patch: z
    .object({
      dominio_oficial: z.string().nullable().optional(),
      secretario: z.string().nullable().optional(),
      cargo: z.string().nullable().optional(),
      emails: z.array(z.string()).optional(),
      telefones: z.array(z.string()).optional(),
    })
    .optional(),
});
export const adminResolveRevisao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ResolveRevisaoInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existente } = (await supabaseAdmin
      .from("municipios_educacao")
      .select("secretario, cargo, emails, telefones, equipe, horario, status, revisao_motivos")
      .eq("ibge_id", data.ibge_id)
      .maybeSingle()) as any;

    // "completo" cobre as três fases de uma vez — limpa todos os motivos.
    const prefixes =
      data.fase === "completo"
        ? ["dominio:", "secretario:", "contato:", "completo:"]
        : [`${data.fase}:`];
    const revisao_motivos = (existente?.revisao_motivos ?? []).filter(
      (m: string) => !prefixes.some((p) => m.startsWith(p)),
    );
    const patch: Record<string, unknown> = {
      revisao_motivos,
      revisao_necessaria: revisao_motivos.length > 0,
    };

    if (data.patch) {
      const now = new Date().toISOString();
      let secretario = existente?.secretario ?? null;
      let cargo = existente?.cargo ?? null;
      let emails: string[] = existente?.emails ?? [];
      let telefones: string[] = existente?.telefones ?? [];

      const tocaDominio = data.fase === "dominio" || data.fase === "completo";
      const tocaSecretario = data.fase === "secretario" || data.fase === "completo";
      const tocaContato = data.fase === "contato" || data.fase === "completo";

      if (tocaDominio && data.patch.dominio_oficial !== undefined) {
        const { normalizeHost } = await import("./scraper.server");
        patch.dominio_oficial = normalizeHost(data.patch.dominio_oficial ?? null);
        patch.dominio_confirmado_em = now;
      }
      if (tocaSecretario && (data.patch.secretario !== undefined || data.patch.cargo !== undefined)) {
        secretario = data.patch.secretario ?? null;
        cargo = data.patch.cargo ?? null;
        patch.secretario = secretario;
        patch.cargo = cargo;
        patch.secretario_confirmado_em = now;
      }
      if (tocaContato && (data.patch.emails !== undefined || data.patch.telefones !== undefined)) {
        emails = data.patch.emails ?? [];
        telefones = data.patch.telefones ?? [];
        patch.emails = emails;
        patch.telefones = telefones;
        patch.contato_confirmado_em = now;
      }

      const { calcularScore, contarCampos } = await import("./catalog-score");
      const { data: mun } = await supabaseAdmin
        .from("municipios")
        .select("populacao, matriculas_total, fnde_anual")
        .eq("ibge_id", data.ibge_id)
        .maybeSingle();
      const campos = contarCampos({
        secretario,
        cargo,
        emails,
        telefones,
        horario: existente?.horario ?? null,
        equipe: existente?.equipe ?? [],
      });
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
      if (!existente?.status || existente.status === "sem_dados") patch.status = "pendente";
    }

    const { error } = await supabaseAdmin
      .from("municipios_educacao")
      .update(patch as any)
      .eq("ibge_id", data.ibge_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ SALVAR SECRETARIA/CONTATO/DOMÍNIO (modal de detalhes) ============
// Usado pelo modal "todas as informações do município", aberto tanto na fila de
// lote quanto na lista geral. Escopo restrito a secretaria/contato/domínio —
// indicadores (população, matrículas, FNDE, PIB) só mudam pela tela de edição
// completa. Grava autoria (quem confirmou) ao lado do timestamp que já existia.
const SaveEducacaoModalInput = z.object({
  ibge_id: z.number().int(),
  secretario: z.string().nullable(),
  cargo: z.string().nullable(),
  emails: z.array(z.string()).default([]),
  telefones: z.array(z.string()).default([]),
  horario: z.string().nullable(),
  dominio_oficial: z.string().nullable(),
  pagina_educacao_url: z.string().nullable(),
  status: z.enum(["validado", "pendente", "sem_dados"]),
});
export const adminSaveEducacaoModal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveEducacaoModalInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normalizeHost } = await import("./scraper.server");
    const { calcularScore, contarCampos } = await import("./catalog-score");

    const autor = (context.claims as any)?.email ?? context.userId;
    const now = new Date().toISOString();
    const dominio_oficial = normalizeHost(data.dominio_oficial);

    const { data: existente } = await supabaseAdmin
      .from("municipios_educacao")
      .select("revisao_motivos")
      .eq("ibge_id", data.ibge_id)
      .maybeSingle();
    const atuais: string[] = (existente as any)?.revisao_motivos ?? [];
    const fasesTocadas: Array<"dominio" | "secretario" | "contato"> = [];
    if (dominio_oficial) fasesTocadas.push("dominio");
    if (data.secretario) fasesTocadas.push("secretario");
    if (data.emails.length > 0 || data.telefones.length > 0) fasesTocadas.push("contato");
    const prefixes = fasesTocadas.map((f) => `${f}:`);
    const revisao_motivos = atuais.filter((m) => !prefixes.some((p) => m.startsWith(p)));

    const { data: mun } = await supabaseAdmin
      .from("municipios")
      .select("populacao, matriculas_total, fnde_anual")
      .eq("ibge_id", data.ibge_id)
      .maybeSingle();
    const campos = contarCampos({
      secretario: data.secretario,
      cargo: data.cargo,
      emails: data.emails,
      telefones: data.telefones,
      horario: data.horario,
    });
    const { score, faixa, breakdown } = calcularScore({
      populacao: mun?.populacao ?? 0,
      matriculas_total: mun?.matriculas_total ?? 0,
      fnde_anual: Number(mun?.fnde_anual ?? 0),
      campos_preenchidos: campos,
      atualizado_em: now,
    });

    const patch: Record<string, unknown> = {
      ibge_id: data.ibge_id,
      secretario: data.secretario,
      cargo: data.cargo,
      emails: data.emails,
      telefones: data.telefones,
      horario: data.horario,
      dominio_oficial,
      pagina_educacao_url: data.pagina_educacao_url || null,
      status: data.status,
      atualizado_em: now,
      score,
      faixa,
      breakdown,
      revisao_motivos,
      revisao_necessaria: revisao_motivos.length > 0,
    };
    if (dominio_oficial) {
      patch.dominio_confirmado_em = now;
      patch.dominio_confirmado_por = autor;
    }
    if (data.secretario) {
      patch.secretario_confirmado_em = now;
      patch.secretario_confirmado_por = autor;
    }
    if (data.emails.length > 0 || data.telefones.length > 0) {
      patch.contato_confirmado_em = now;
      patch.contato_confirmado_por = autor;
    }

    const { error } = await supabaseAdmin
      .from("municipios_educacao")
      .upsert(patch as any, { onConflict: "ibge_id" });
    if (error) throw new Error(error.message);
    return { ok: true, score, faixa };
  });

// ============ SCORE CONFIG ============
export const adminGetScoreConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("score_config")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

const ConfigInput = z.object({
  pesos_macro: z.object({
    porte: z.number().min(0).max(100),
    financeiro: z.number().min(0).max(100),
    completude: z.number().min(0).max(100),
    recencia: z.number().min(0).max(100),
  }),
  pesos_etapa: z.record(z.string(), z.number().min(0).max(5)),
});
export const adminSaveScoreConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ConfigInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("score_config")
      .update({
        pesos_macro: data.pesos_macro,
        pesos_etapa: data.pesos_etapa,
      })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    // Recalcula o score de toda a base ao salvar novos pesos, para que a
    // mudança se reflita imediatamente (antes só acontecia via botão manual
    // ou após um import).
    const { recalcularScoresDeTodosMunicipios } = await import("./catalog-score-recalc.server");
    const recalc = await recalcularScoresDeTodosMunicipios(supabaseAdmin);
    return { ok: true, recalc };
  });

// ============ RESET DADOS ============
export const adminResetDados = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("municipios_matriculas_etapa").delete().gt("ibge_id", 0);
    await supabaseAdmin
      .from("municipios")
      .update({
        populacao: 0,
        matriculas_total: 0,
        escolas: 0,
        fnde_anual: 0,
        pib_percapita: 0,
      })
      .gt("ibge_id", 0);
    await supabaseAdmin
      .from("municipios_educacao")
      .update({
        secretario: null,
        cargo: null,
        emails: [],
        telefones: [],
        horario: null,
        equipe: [],
        fonte: null,
        fonte_url: null,
        status: "sem_dados",
        score: 0,
        faixa: "baixo",
        breakdown: {},
        atualizado_em: null,
      })
      .gt("ibge_id", 0);
    return { ok: true };
  });

// ============ SYNC IBGE (adiciona municípios faltantes, zerados) ============
export const adminSyncIBGE = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await fetch(
      "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome",
    );
    if (!res.ok) throw new Error(`IBGE HTTP ${res.status}`);
    const raw = (await res.json()) as any[];
    const { slugify } = await import("./catalog-seed.server");
    const munis: any[] = [];
    const edus: any[] = [];
    for (const m of raw) {
      const uf =
        m?.["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla ??
        m?.microrregiao?.mesorregiao?.UF?.sigla;
      if (!uf || typeof m.id !== "number") continue;
      munis.push({ ibge_id: m.id, nome: m.nome, uf, slug: slugify(m.nome) });
      edus.push({ ibge_id: m.id });
    }
    const CHUNK = 500;
    for (let i = 0; i < munis.length; i += CHUNK) {
      await supabaseAdmin
        .from("municipios")
        .upsert(munis.slice(i, i + CHUNK), { onConflict: "ibge_id", ignoreDuplicates: true });
    }
    for (let i = 0; i < edus.length; i += CHUNK) {
      await supabaseAdmin
        .from("municipios_educacao")
        .upsert(edus.slice(i, i + CHUNK), { onConflict: "ibge_id", ignoreDuplicates: true });
    }
    return { total: munis.length };
  });

// ============ SYNC POPULAÇÃO IBGE ============
export const adminSyncPopulacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await fetch(
      "https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[all]",
    );
    if (!res.ok) throw new Error(`IBGE HTTP ${res.status}`);
    const json = (await res.json()) as any[];
    const series: any[] | undefined = json?.[0]?.resultados?.[0]?.series;
    if (!series || !Array.isArray(series)) {
      throw new Error("Resposta do IBGE inesperada (series ausente)");
    }
    // Detecta o ano de referência a partir da primeira série com dados.
    let ano: string | undefined;
    for (const s of series) {
      const keys = Object.keys(s?.serie ?? {});
      if (keys.length) {
        ano = keys[keys.length - 1];
        break;
      }
    }
    if (!ano) throw new Error("Não foi possível identificar o ano de referência");
    const rows: { ibge_id: number; populacao: number }[] = [];
    for (const s of series) {
      const id = s?.localidade?.id;
      const val = s?.serie?.[ano];
      if (!id || val == null || val === "-" || val === "...") continue;
      const ibgeId = Number(id);
      const pop = Number(val);
      if (!ibgeId || Number.isNaN(pop)) continue;
      rows.push({ ibge_id: ibgeId, populacao: pop });
    }
    // Atualiza em paralelo (concorrência limitada).
    const CONC = 20;
    let idx = 0;
    async function worker() {
      while (idx < rows.length) {
        const i = idx++;
        const r = rows[i];
        const { error } = await supabaseAdmin
          .from("municipios")
          .update({ populacao: r.populacao })
          .eq("ibge_id", r.ibge_id);
        if (error) throw new Error(`populacao ${r.ibge_id}: ${error.message}`);
      }
    }
    await Promise.all(Array.from({ length: CONC }, worker));
    return { total: rows.length, ano };
  });

// ============ RECALCULAR SCORES ============
export const adminRecalcularScores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recalcularScoresDeTodosMunicipios } = await import("./catalog-score-recalc.server");
    return recalcularScoresDeTodosMunicipios(supabaseAdmin);
  });

// ============ RECONSOLIDAR ESCOLAS (a partir do que já está no banco) ============
// Reaplica a contagem de escolas municipais ativas por município usando as
// linhas já gravadas em `inep_escolas` — sem precisar reenviar o arquivo do
// Censo (200k+ linhas). Necessário porque importações antigas gravaram as
// escolas, mas a consolidação por município saiu truncada.
export const adminReconsolidarEscolas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ano?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recontarEscolasMunicipais, aplicarContagemEscolas } = await import("./catalog-consolidate.server");

    let ano = data.ano;
    if (!ano) {
      const { data: recente } = await supabaseAdmin
        .from("inep_escolas")
        .select("ano")
        .order("ano", { ascending: false })
        .limit(1)
        .maybeSingle();
      ano = (recente as any)?.ano ?? new Date().getFullYear();
    }

    const counts = await recontarEscolasMunicipais(supabaseAdmin, ano!);
    const totalEscolas = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    const { updated, notFound } = await aplicarContagemEscolas(supabaseAdmin, counts);
    return { ano: ano!, municipios: counts.size, totalEscolas, updated, notFound };
  });

// ============ CONFIG DAS QUERIES (Visão Geral por IA) ============
export const adminGetQueryConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { QUERY_AI_OVERVIEW_PADRAO } = await import("./prospect-query.server");
    const { data } = await supabaseAdmin
      .from("prospect_query_config")
      .select("query_ai_overview, variantes, updated_at")
      .eq("id", 1)
      .maybeSingle();
    const variantes = Array.isArray(data?.variantes) ? (data!.variantes as unknown as string[]) : [];
    return {
      query: (data?.query_ai_overview ?? QUERY_AI_OVERVIEW_PADRAO) as string,
      variantes: variantes.filter((v) => typeof v === "string"),
      updatedAt: (data?.updated_at ?? null) as string | null,
    };
  });

export const adminSaveQueryConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { query?: string; variantes?: string[] }) =>
    z
      .object({ query: z.string().min(5).optional(), variantes: z.array(z.string().min(5)).max(6).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: { query_ai_overview?: string; variantes?: string[] } = {};
    if (data.query) patch.query_ai_overview = data.query.trim();
    if (data.variantes) patch.variantes = data.variantes;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.from("prospect_query_config").update(patch).eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ AMOSTRA DE MUNICÍPIOS PARA TESTE DE QUERY ============
export const adminAmostraMunicipios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { quantidade?: number; uf?: string; somenteSemDados?: boolean }) =>
    z
      .object({
        quantidade: z.number().int().min(1).max(20).default(5),
        uf: z.string().length(2).optional(),
        somenteSemDados: z.boolean().default(true),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("municipios_educacao")
      .select("ibge_id, secretario, municipios!inner(nome, uf)")
      .limit(data.quantidade * 12);
    if (data.uf) q = q.eq("municipios.uf", data.uf);
    if (data.somenteSemDados) q = q.is("secretario", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const all = (rows ?? []) as any[];
    // Embaralha e corta na quantidade pedida.
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return {
      items: all.slice(0, data.quantidade).map((r) => ({
        ibgeId: r.ibge_id as number,
        nome: r.municipios.nome as string,
        uf: r.municipios.uf as string,
      })),
    };
  });
