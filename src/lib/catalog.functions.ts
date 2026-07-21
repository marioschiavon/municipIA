// Server functions do catálogo (list, get, seed, atualizar).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type MunicipioListItem = {
  ibge_id: number;
  nome: string;
  uf: string;
  slug: string;
  populacao: number;
  matriculas_total: number;
  escolas: number;
  fnde_anual: number;
  score: number;
  faixa: string;
  status: string;
  atualizado_em: string | null;
};

export type MunicipioFicha = {
  ibge_id: number;
  nome: string;
  uf: string;
  slug: string;
  populacao: number;
  matriculas_total: number;
  escolas: number;
  fnde_anual: number;
  pib_percapita: number;
  educacao: {
    secretario: string | null;
    cargo: string | null;
    email: string | null;
    telefone: string | null;
    horario: string | null;
    equipe: Array<{ nome: string; cargo: string; email?: string | null; telefone?: string | null }>;
    fonte: string | null;
    fonte_url: string | null;
    status: string;
    atualizado_em: string | null;
    score: number;
    faixa: string;
    breakdown: Record<string, number>;
  };
};

// ============ LIST ============
const ListInput = z.object({
  uf: z.string().length(2).optional(),
  faixa: z.enum(["alto", "medio", "baixo"]).optional(),
  status: z.enum(["validado", "pendente", "sem_dados"]).optional(),
  q: z.string().optional(),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(200).default(50),
  orderBy: z.enum(["score", "populacao", "nome", "matriculas_total"]).default("score"),
  orderDir: z.enum(["asc", "desc"]).default("desc"),
});

export const listMunicipios = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => ListInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Faz uma view manual via join. Usamos duas queries por simplicidade e para
    // funcionar mesmo em municípios sem row em municipios_educacao (LEFT JOIN
    // não é trivial no supabase-js sem função). Como já criamos row para todos
    // no seed, um inner select basta:
    let q = supabaseAdmin
      .from("municipios_educacao")
      .select("ibge_id, score, faixa, status, atualizado_em, municipios!inner(nome, uf, slug, populacao, matriculas_total, escolas, fnde_anual)", { count: "exact" });

    if (data.uf) q = q.eq("municipios.uf", data.uf);
    if (data.faixa) q = q.eq("faixa", data.faixa);
    if (data.status) q = q.eq("status", data.status);
    if (data.q && data.q.trim()) {
      q = q.ilike("municipios.nome", `%${data.q.trim()}%`);
    }

    // ordering
    if (data.orderBy === "score") {
      q = q.order("score", { ascending: data.orderDir === "asc" });
    } else if (data.orderBy === "nome") {
      q = q.order("nome", { referencedTable: "municipios", ascending: data.orderDir === "asc" });
    } else {
      q = q.order(data.orderBy, { referencedTable: "municipios", ascending: data.orderDir === "asc" });
    }

    const from = data.page * data.pageSize;
    const to = from + data.pageSize - 1;
    q = q.range(from, to);

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);

    const items: MunicipioListItem[] = (rows ?? []).map((r: any) => ({
      ibge_id: r.ibge_id,
      nome: r.municipios.nome,
      uf: r.municipios.uf,
      slug: r.municipios.slug,
      populacao: r.municipios.populacao,
      matriculas_total: r.municipios.matriculas_total,
      escolas: r.municipios.escolas,
      fnde_anual: Number(r.municipios.fnde_anual),
      score: r.score,
      faixa: r.faixa,
      status: r.status,
      atualizado_em: r.atualizado_em,
    }));

    return { items, total: count ?? 0 };
  });

// ============ GET ============
export const getMunicipio = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ ibge_id: z.number().int() }).parse(data))
  .handler(async ({ data }): Promise<MunicipioFicha | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: m, error } = await supabaseAdmin
      .from("municipios")
      .select("*, municipios_educacao(*)")
      .eq("ibge_id", data.ibge_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!m) return null;
    const edu = (m as any).municipios_educacao ?? {};
    return {
      ibge_id: m.ibge_id,
      nome: m.nome,
      uf: m.uf,
      slug: m.slug,
      populacao: m.populacao,
      matriculas_total: m.matriculas_total,
      escolas: m.escolas,
      fnde_anual: Number(m.fnde_anual),
      pib_percapita: Number(m.pib_percapita),
      educacao: {
        secretario: edu.secretario ?? null,
        cargo: edu.cargo ?? null,
        email: edu.email ?? null,
        telefone: edu.telefone ?? null,
        horario: edu.horario ?? null,
        equipe: edu.equipe ?? [],
        fonte: edu.fonte ?? null,
        fonte_url: edu.fonte_url ?? null,
        status: edu.status ?? "sem_dados",
        atualizado_em: edu.atualizado_em ?? null,
        score: edu.score ?? 0,
        faixa: edu.faixa ?? "baixo",
        breakdown: edu.breakdown ?? {},
      },
    };
  });

// ============ SEED ============
// Popula/repopula o catálogo com municípios do IBGE + mocks determinísticos.
// Idempotente via upsert por ibge_id.
export const seedCatalog = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { gerarMock, slugify } = await import("./catalog-seed.server");

  // Já populado?
  const { count } = await supabaseAdmin
    .from("municipios")
    .select("ibge_id", { count: "exact", head: true });
  if ((count ?? 0) >= 5000) {
    return { skipped: true, total: count };
  }

  // Fetch IBGE
  const res = await fetch(
    "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome",
  );
  if (!res.ok) throw new Error(`IBGE HTTP ${res.status}`);
  const raw = (await res.json()) as Array<any>;

  const municipios: Array<{ ibge_id: number; nome: string; uf: string; slug: string; populacao: number; matriculas_total: number; escolas: number; fnde_anual: number; pib_percapita: number }> = [];
  const educacao: Array<any> = [];

  for (const m of raw) {
    const uf = m?.["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla
      ?? m?.microrregiao?.mesorregiao?.UF?.sigla;
    if (!uf || typeof m.id !== "number" || typeof m.nome !== "string") continue;
    const slug = slugify(m.nome);
    const mock = gerarMock(m.id, m.nome, uf, slug);
    municipios.push({
      ibge_id: m.id, nome: m.nome, uf, slug,
      populacao: mock.populacao,
      matriculas_total: mock.matriculas_total,
      escolas: mock.escolas,
      fnde_anual: mock.fnde_anual,
      pib_percapita: mock.pib_percapita,
    });
    educacao.push({
      ibge_id: m.id,
      secretario: mock.educacao.secretario,
      cargo: mock.educacao.cargo,
      email: mock.educacao.email,
      telefone: mock.educacao.telefone,
      horario: mock.educacao.horario,
      equipe: mock.educacao.equipe,
      fonte: mock.educacao.fonte,
      fonte_url: mock.educacao.fonte_url,
      status: mock.educacao.status,
      atualizado_em: mock.educacao.atualizado_em,
      score: mock.educacao.score,
      faixa: mock.educacao.faixa,
      breakdown: mock.educacao.breakdown,
    });
  }

  // Upsert em batches de 500
  const CHUNK = 500;
  for (let i = 0; i < municipios.length; i += CHUNK) {
    const chunk = municipios.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin.from("municipios").upsert(chunk, { onConflict: "ibge_id" });
    if (error) throw new Error(`municipios upsert @${i}: ${error.message}`);
  }
  for (let i = 0; i < educacao.length; i += CHUNK) {
    const chunk = educacao.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin.from("municipios_educacao").upsert(chunk, { onConflict: "ibge_id" });
    if (error) throw new Error(`municipios_educacao upsert @${i}: ${error.message}`);
  }

  return { skipped: false, total: municipios.length };
});

// Stats globais (para header)
export const getCatalogStats = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ count: total }, { count: alto }, { count: validado }] = await Promise.all([
    supabaseAdmin.from("municipios").select("ibge_id", { count: "exact", head: true }),
    supabaseAdmin.from("municipios_educacao").select("ibge_id", { count: "exact", head: true }).eq("faixa", "alto"),
    supabaseAdmin.from("municipios_educacao").select("ibge_id", { count: "exact", head: true }).eq("status", "validado"),
  ]);
  return { total: total ?? 0, alto: alto ?? 0, validado: validado ?? 0 };
});
