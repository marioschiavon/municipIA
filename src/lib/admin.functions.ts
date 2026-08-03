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
type ProspectFaseFiltro = "dominio" | "secretario" | "contato";
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
    ]);
    return {
      total: total ?? 0,
      comContatos: comContatos ?? 0,
      validados: validados ?? 0,
      comMatriculas: comMatriculas ?? 0,
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
  fase: z.enum(["dominio", "secretario", "contato"]).optional(),
});
export const adminListMunicipioIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListAllIdsInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const items: Array<{ ibge_id: number; nome: string; uf: string }> = [];
    const CHUNK = 1000;
    let from = 0;
    for (;;) {
      let q = supabaseAdmin
        .from("municipios")
        .select(
          "ibge_id, nome, uf, municipios_educacao!inner(status, dominio_oficial, secretario, emails, telefones)",
        )
        .order("nome", { ascending: true })
        .range(from, from + CHUNK - 1);
      if (data.uf) q = q.eq("uf", data.uf);
      if (data.q) q = q.ilike("nome", `%${data.q}%`);
      if (data.status) q = q.eq("municipios_educacao.status", data.status);
      q = applyFaseFilter(q, data.fase);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of (rows ?? []) as any[])
        items.push({ ibge_id: r.ibge_id, nome: r.nome, uf: r.uf });
      if (!rows || rows.length < CHUNK) break;
      from += CHUNK;
    }
    return { items };
  });

// ============ COUNT ELEGÍVEIS (badge "N elegíveis" na tela de lote) ============
const CountElegiveisInput = z.object({
  fase: z.enum(["dominio", "secretario", "contato"]),
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
  limparRevisaoFases: z.array(z.enum(["dominio", "secretario", "contato"])).optional(),
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
  fase: z.enum(["dominio", "secretario", "contato"]),
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

    const prefix = `${data.fase}:`;
    const revisao_motivos = (existente?.revisao_motivos ?? []).filter(
      (m: string) => !m.startsWith(prefix),
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

      if (data.fase === "dominio") {
        const { normalizeHost } = await import("./scraper.server");
        patch.dominio_oficial = normalizeHost(data.patch.dominio_oficial ?? null);
        patch.dominio_confirmado_em = now;
      } else if (data.fase === "secretario") {
        secretario = data.patch.secretario ?? null;
        cargo = data.patch.cargo ?? null;
        patch.secretario = secretario;
        patch.cargo = cargo;
        patch.secretario_confirmado_em = now;
      } else {
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
    return { ok: true };
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
    const { calcularScore, contarCampos } = await import("./catalog-score");

    const { data: munis, error: mErr } = await supabaseAdmin
      .from("municipios")
      .select("ibge_id, populacao, matriculas_total, fnde_anual");
    if (mErr) throw new Error(mErr.message);

    const { data: edus, error: eErr } = await supabaseAdmin
      .from("municipios_educacao")
      .select("ibge_id, secretario, cargo, emails, telefones, horario, equipe, atualizado_em");
    if (eErr) throw new Error(eErr.message);

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
      faixas[faixa]++;
      updates.push({
        ibge_id: m.ibge_id,
        score,
        faixa,
        breakdown,
      });
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
  });
