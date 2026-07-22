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
    const [{ count: total }, { count: comContatos }, { count: validados }, { count: comMatriculas }] = await Promise.all([
      supabaseAdmin.from("municipios").select("ibge_id", { count: "exact", head: true }),
      supabaseAdmin.from("municipios_educacao").select("ibge_id", { count: "exact", head: true }).not("email", "is", null),
      supabaseAdmin.from("municipios_educacao").select("ibge_id", { count: "exact", head: true }).eq("status", "validado"),
      supabaseAdmin.from("municipios").select("ibge_id", { count: "exact", head: true }).gt("matriculas_total", 0),
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
      .select("ibge_id, nome, uf, populacao, matriculas_total, fnde_anual, municipios_educacao!inner(status, score, faixa, email, secretario, atualizado_em)", { count: "exact" });
    if (data.uf) q = q.eq("uf", data.uf);
    if (data.q) q = q.ilike("nome", `%${data.q}%`);
    if (data.status) q = q.eq("municipios_educacao.status", data.status);
    q = q.order("nome", { ascending: true });
    const from = data.page * data.pageSize;
    q = q.range(from, from + data.pageSize - 1);
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return {
      total: count ?? 0,
      items: (rows ?? []).map((r: any) => ({
        ibge_id: r.ibge_id, nome: r.nome, uf: r.uf,
        populacao: r.populacao, matriculas_total: r.matriculas_total,
        fnde_anual: Number(r.fnde_anual),
        status: r.municipios_educacao?.status ?? "sem_dados",
        score: r.municipios_educacao?.score ?? 0,
        faixa: r.municipios_educacao?.faixa ?? "baixo",
        email: r.municipios_educacao?.email ?? null,
        secretario: r.municipios_educacao?.secretario ?? null,
        atualizado_em: r.municipios_educacao?.atualizado_em ?? null,
      })),
    };
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
      supabaseAdmin.from("municipios_educacao").select("*").eq("ibge_id", data.ibge_id).maybeSingle(),
      supabaseAdmin.from("municipios_matriculas_etapa").select("*").eq("ibge_id", data.ibge_id).order("etapa"),
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
    email: z.string().nullable(),
    telefone: z.string().nullable(),
    horario: z.string().nullable(),
    fonte: z.string().nullable(),
    fonte_url: z.string().nullable(),
    status: z.enum(["validado", "pendente", "sem_dados"]),
    equipe: z.array(z.object({
      nome: z.string(),
      cargo: z.string(),
      email: z.string().nullable().optional(),
      telefone: z.string().nullable().optional(),
    })).default([]),
  }),
  etapas: z.array(z.object({
    etapa: z.enum(["creche","pre_escola","fundamental_ai","fundamental_af","medio","eja","especial","profissionalizante"]),
    matriculas: z.number().int().min(0),
  })).default([]),
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
    const matTotal = data.etapas.reduce((a, b) => a + b.matriculas, 0)
      || data.municipio.matriculas_total;

    // Update municipios
    {
      const { error } = await supabaseAdmin.from("municipios").update({
        populacao: data.municipio.populacao,
        matriculas_total: matTotal,
        escolas: data.municipio.escolas,
        fnde_anual: data.municipio.fnde_anual,
        pib_percapita: data.municipio.pib_percapita,
      }).eq("ibge_id", data.ibge_id);
      if (error) throw new Error(`municipios: ${error.message}`);
    }

    // Upsert etapas (delete previous + insert)
    if (data.etapas.length > 0) {
      await supabaseAdmin.from("municipios_matriculas_etapa")
        .delete().eq("ibge_id", data.ibge_id).eq("ano", ano);
      const rows = data.etapas.filter((e) => e.matriculas > 0).map((e) => ({
        ibge_id: data.ibge_id, etapa: e.etapa, matriculas: e.matriculas, ano,
      }));
      if (rows.length) {
        const { error } = await supabaseAdmin.from("municipios_matriculas_etapa").insert(rows);
        if (error) throw new Error(`etapas: ${error.message}`);
      }
    }

    // Recalcula score
    const now = new Date().toISOString();
    const campos = contarCampos({
      secretario: data.educacao.secretario, cargo: data.educacao.cargo,
      email: data.educacao.email, telefone: data.educacao.telefone,
      horario: data.educacao.horario, equipe: data.educacao.equipe,
    });
    const { score, faixa, breakdown } = calcularScore({
      populacao: data.municipio.populacao,
      matriculas_total: matTotal,
      fnde_anual: data.municipio.fnde_anual,
      campos_preenchidos: campos,
      atualizado_em: now,
    });

    const { error: eErr } = await supabaseAdmin.from("municipios_educacao").upsert({
      ibge_id: data.ibge_id,
      secretario: data.educacao.secretario,
      cargo: data.educacao.cargo,
      email: data.educacao.email,
      telefone: data.educacao.telefone,
      horario: data.educacao.horario,
      fonte: data.educacao.fonte,
      fonte_url: data.educacao.fonte_url,
      status: data.educacao.status,
      equipe: data.educacao.equipe,
      atualizado_em: now,
      score, faixa, breakdown,
    }, { onConflict: "ibge_id" });
    if (eErr) throw new Error(`educacao: ${eErr.message}`);

    return { ok: true, score, faixa };
  });

// ============ SCORE CONFIG ============
export const adminGetScoreConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("score_config").select("*").eq("id", 1).maybeSingle();
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
    const { error } = await supabaseAdmin.from("score_config").update({
      pesos_macro: data.pesos_macro,
      pesos_etapa: data.pesos_etapa,
    }).eq("id", 1);
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
    await supabaseAdmin.from("municipios").update({
      populacao: 0, matriculas_total: 0, escolas: 0, fnde_anual: 0, pib_percapita: 0,
    }).gt("ibge_id", 0);
    await supabaseAdmin.from("municipios_educacao").update({
      secretario: null, cargo: null, email: null, telefone: null, horario: null,
      equipe: [], fonte: null, fonte_url: null, status: "sem_dados",
      score: 0, faixa: "baixo", breakdown: {}, atualizado_em: null,
    }).gt("ibge_id", 0);
    return { ok: true };
  });

// ============ SYNC IBGE (adiciona municípios faltantes, zerados) ============
export const adminSyncIBGE = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome");
    if (!res.ok) throw new Error(`IBGE HTTP ${res.status}`);
    const raw = (await res.json()) as any[];
    const { slugify } = await import("./catalog-seed.server");
    const munis: any[] = [];
    const edus: any[] = [];
    for (const m of raw) {
      const uf = m?.["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla
        ?? m?.microrregiao?.mesorregiao?.UF?.sigla;
      if (!uf || typeof m.id !== "number") continue;
      munis.push({ ibge_id: m.id, nome: m.nome, uf, slug: slugify(m.nome) });
      edus.push({ ibge_id: m.id });
    }
    const CHUNK = 500;
    for (let i = 0; i < munis.length; i += CHUNK) {
      await supabaseAdmin.from("municipios").upsert(munis.slice(i, i + CHUNK), { onConflict: "ibge_id", ignoreDuplicates: true });
    }
    for (let i = 0; i < edus.length; i += CHUNK) {
      await supabaseAdmin.from("municipios_educacao").upsert(edus.slice(i, i + CHUNK), { onConflict: "ibge_id", ignoreDuplicates: true });
    }
    return { total: munis.length };
  });
