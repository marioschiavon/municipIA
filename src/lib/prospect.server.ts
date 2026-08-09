// Pipeline ESCALONADO (Alpha v0.12).
// 1) Fecha o NOME atual.  2) Busca contato vinculado ao nome.
// 3) Busca contato institucional da Secretaria (inclui Câmara Municipal).
// 4) Fallback geral → gabinete.
import { generateObject } from "ai";
import { z } from "zod";
import { getExtractionModel } from "./ai-gateway.server";
import { fetchHtml, htmlToMarkdown, extractContactsRegex } from "./scraper.server";

import { googleSerp, ragBrowse, type ApifyPage } from "./apify.server";
import type {
  EtapaTag,
  EquipeMembro,
  Hierarquia,
  ProgressEvent,
  ProgressLevel,
  ProspectResult,
} from "./prospect.types";

export type { Hierarquia, ProspectResult };

const ConfiancaEnum = z.enum(["alta", "media", "baixa"]);
const ConfiancaLoose = z
  .union([ConfiancaEnum, z.string()])
  .transform((v) => {
    const s = String(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (["alta", "high", "alto"].includes(s)) return "alta" as const;
    if (["baixa", "low", "baixo"].includes(s)) return "baixa" as const;
    return "media" as const;
  });

// Membro da equipe (coordenador, diretor, assessor, chefe de gabinete, etc.).
const EquipeSchema = z
  .array(
    z.object({
      nome: z.string(),
      cargo: z.string().nullable().optional().default(null),
      email: z.string().nullable().optional().default(null),
      telefone: z.string().nullable().optional().default(null),
    }),
  )
  .optional()
  .default([]);

// Schema completo — usado nos estágios 2/3/4 (contato).
const ExtractSchema = z.object({
  secretario: z.string().nullable().optional().default(null),
  cargo: z.string().nullable().optional().default(null),
  emails: z.array(z.string()).optional().default([]),
  telefones: z.array(z.string()).optional().default([]),
  contexto: z.string().nullable().optional().default(null),
  confianca: ConfiancaLoose.default("baixa"),
  dataReferencia: z.string().nullable().optional().default(null),
  horarioAtendimento: z.string().nullable().optional().default(null),
  equipe: EquipeSchema,
});

// Schema reduzido — usado SOMENTE no Estágio 1 (nome). Sem e-mails/telefones.
const NomeSchema = z.object({
  secretario: z.string().nullable().optional().default(null),
  cargo: z.string().nullable().optional().default(null),
  contexto: z.string().nullable().optional().default(null),
  confianca: ConfiancaLoose.default("baixa"),
  dataReferencia: z.string().nullable().optional().default(null),
  equipe: EquipeSchema,
});

type Extracted = {
  secretario: string | null;
  cargo: string | null;
  emails: string[];
  telefones: string[];
  contexto: string | null;
  confianca: "alta" | "media" | "baixa";
  dataReferencia: string | null;
  horarioAtendimento: string | null;
  equipe: EquipeMembro[];
};

type NomeOnly = {
  secretario: string | null;
  cargo: string | null;
  contexto: string | null;
  confianca: "alta" | "media" | "baixa";
  dataReferencia: string | null;
  equipe: EquipeMembro[];
};


type Emit = (
  level: ProgressLevel,
  etapa: EtapaTag,
  message: string,
  data?: unknown,
) => void;

function getProvider() {
  return getExtractionModel();
}

function shortHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function govUf(url: string): string | null {
  const host = shortHost(url).toLowerCase();
  const m = /\.([a-z]{2})\.gov\.br$/.exec(host);
  return m?.[1] ?? null;
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Timeout duro genérico — resolve null se estourar o limite.
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  emit?: Emit,
  etapa?: EtapaTag,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutP = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      if (emit && etapa) emit("warn", etapa, `⏱ Timeout ${ms}ms em ${label} — seguindo`);
      resolve(null);
    }, ms);
  });
  try {
    return (await Promise.race([promise, timeoutP])) as T | null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Municípios "grandes" — se anti-contam zerar e-mails, NÃO devolver parcial vazio
// (forçar próximo fallback). Mantém comportamento atual para os demais.
const LARGE_MUNI_SLUGS = new Set([
  "curitiba","saopaulo","riodejaneiro","belohorizonte","salvador","fortaleza",
  "manaus","recife","portoalegre","goiania","florianopolis","campinas","maringa",
]);

// Domínio oficial real, para municípios cujo site NÃO segue o padrão
// {slug}.{uf}.gov.br (ex.: Belo Horizonte usa pbh.gov.br). Sem essa exceção,
// a query "site:{slug}.{uf}.gov.br" não acha nada e o fallback genérico
// "site:{uf}.gov.br {municipio}" acaba varrendo o PORTAL DO ESTADO — que
// menciona a capital o tempo todo por outros motivos (é onde o governo
// estadual fica sediado) e pode contaminar o resultado com o secretário
// ESTADUAL de educação em vez do municipal.
const DOMINIO_OFICIAL_ESPECIAL: Record<string, string> = {
  belohorizonte: "prefeitura.pbh.gov.br",
  saopaulo: "prefeitura.sp.gov.br",
  riodejaneiro: "rio.rj.gov.br",
  florianopolis: "pmf.sc.gov.br",
};

function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** true se `host` é o domínio oficial especial (ou subdomínio dele), ignorando "www." */
function isDominioOficialEspecial(host: string, dominioOficial?: string): boolean {
  if (!dominioOficial) return false;
  const h = stripWww(host);
  const d = stripWww(dominioOficial);
  return h === d || h.endsWith(`.${d}`);
}

/** true se o host é o portal genérico do ESTADO (ex.: mg.gov.br) — nunca é a
 * fonte certa para o secretário MUNICIPAL, mesmo quando a UF bate. */
function isBareStateHost(host: string, ufLow: string): boolean {
  const h = stripWww(host);
  return h === `${ufLow}.gov.br` || h === `educacao.${ufLow}.gov.br` || h === `see.${ufLow}.gov.br` || h === `seduc.${ufLow}.gov.br`;
}

/**
 * true se `host` segue o padrão-padrão {slug}.{uf}.gov.br mas é de OUTRO
 * município (ex.: barreiras.ba.gov.br aparecendo numa busca por Paratinga/BA —
 * cidade vizinha/polo regional que domina os resultados de busca). Sem esse
 * filtro, o site inteiro de outro município pode ser tratado como se fosse o
 * oficial do alvo, contaminando nome/cargo/e-mail/telefone com os dados de
 * outra cidade inteira.
 */
function isForeignMunicipioHost(host: string, slug: string): boolean {
  const h = stripWww(host);
  const m = /^([a-z-]+)\.[a-z]{2}\.(?:gov|leg)\.br$/.exec(h);
  if (!m) return false;
  return slugify(m[1]) !== slug;
}

/**
 * true se `host` é confiável o suficiente pra ser PERSISTIDO como domínio
 * oficial do município (fonte exclusiva em runs futuros). NUNCA confirma
 * Câmara Municipal (.leg.br — outra entidade), portal genérico do estado,
 * ou o domínio-padrão de outro município.
 */
function isConfirmableOfficialHost(host: string, slug: string, ufLow: string, dominioOficialOverride?: string): boolean {
  const h = stripWww(host);
  if (h.endsWith(".leg.br")) return false;
  if (isBareStateHost(h, ufLow)) return false;
  if (isForeignMunicipioHost(h, slug)) return false;
  if (isDominioOficialEspecial(h, dominioOficialOverride)) return true;
  return /\.gov\.br$/.test(h) && h.includes(slug);
}

/** Remove candidatos cujo host é claramente o site oficial de OUTRO município. */
function filterForeignMunicipio(cands: SearchCandidate[], slug: string, emit?: Emit, etapa?: EtapaTag): SearchCandidate[] {
  const kept = cands.filter((c) => !isForeignMunicipioHost(shortHost(c.url), slug));
  if (emit && etapa && kept.length !== cands.length) {
    emit("warn", etapa, `Removi ${cands.length - kept.length} resultado(s) de site oficial de OUTRO município`);
  }
  return kept;
}

type SearchCandidate = {
  url: string;
  title: string;
  description: string;
  markdown: string | null;
};

function isBlockedHost(url: string): boolean {
  return /(?:instagram\.com|facebook\.com|youtube\.com|tiktok\.com|twitter\.com|x\.com)/i.test(url);
}

/** Falha do provedor de busca (crédito/quota/401/402/rede) — distinta de "0 resultados". */
class ProviderSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderSearchError";
  }
}

const QUOTA_RE = /(insufficient credits|payment required|quota|rate limit|402|401|403|unauthorized|forbidden)/i;

/** Motor de busca da OpenAI (Responses API + web_search) — usado quando o Apify
 * fica indisponível (cota/crédito/token). Devolve [] se a OpenAI também falhar. */
async function openaiSearch(
  query: string,
  emit: Emit,
  etapa: EtapaTag,
  opts: { limit?: number; timeoutMs?: number; uf?: string } = {},
): Promise<SearchCandidate[]> {
  const { openaiWebSearch } = await import("./openai.server");
  emit("info", etapa, `OpenAI web search: "${query}"`);
  const r = await openaiWebSearch(query, { limit: opts.limit ?? 10, timeoutMs: opts.timeoutMs ?? 60_000 });
  if (!r.ok) {
    emit("warn", etapa, `OpenAI web search indisponível (${r.reason.slice(0, 160)})`);
    return [];
  }
  const ufLow = opts.uf?.toLowerCase();
  const cands: SearchCandidate[] = r.hits
    .filter((p) => !isBlockedHost(p.url) && (!ufLow || !govUf(p.url) || govUf(p.url) === ufLow))
    .map((p) => ({ url: p.url, title: p.title, description: p.snippet, markdown: null }));
  emit("info", etapa, `OpenAI trouxe ${cands.length} resultado(s) em ${(r.elapsedMs / 1000).toFixed(1)}s`, {
    candidatos: cands.slice(0, 5).map((c) => ({ url: c.url, snippet: `${c.title} — ${c.description}`.slice(0, 260) })),
  });
  return cands;
}


/** Último elo da cadeia de busca: Gemini (Lovable AI Gateway). Não tem acesso à
 * web — responde com URLs prováveis a partir do conhecimento do modelo, então o
 * resultado vale só como pista (sempre acaba marcado para revisão). */
async function geminiSearch(
  query: string,
  emit: Emit,
  etapa: EtapaTag,
  opts: { limit?: number; uf?: string } = {},
): Promise<SearchCandidate[]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    emit("warn", etapa, "Gemini indisponível (LOVABLE_API_KEY ausente)");
    return [];
  }
  emit("info", etapa, `Gemini (Lovable AI) sugerindo fontes para: "${query}"`);
  try {
    const { createLovableAiGatewayProvider, LOVABLE_DEFAULT_MODEL } = await import("./ai-gateway.server");
    const model = createLovableAiGatewayProvider(key)(LOVABLE_DEFAULT_MODEL);
    const { object } = await generateObject({
      model,
      schema: z.object({
        resultados: z.array(
          z.object({
            url: z.string(),
            titulo: z.string(),
            resumo: z.string(),
          }),
        ),
      }),
      prompt: `Liste até ${opts.limit ?? 5} URLs oficiais brasileiras (preferência .gov.br) que provavelmente respondem a esta busca: "${query}".
Só inclua endereços que você tem alta certeza de que existem. Se não tiver certeza, devolva lista vazia.
Responda apenas com JSON válido no schema.`,
    });
    const ufLow = opts.uf?.toLowerCase();
    const cands: SearchCandidate[] = (object.resultados ?? [])
      .filter((r) => /^https?:\/\//i.test(r.url))
      .filter((r) => !isBlockedHost(r.url) && (!ufLow || !govUf(r.url) || govUf(r.url) === ufLow))
      .map((r) => ({ url: r.url, title: r.titulo, description: r.resumo, markdown: null }));
    emit(
      cands.length > 0 ? "info" : "warn",
      etapa,
      `Gemini sugeriu ${cands.length} fonte(s) (baixa confiança — sem busca real na web)`,
      { candidatos: cands.slice(0, 5).map((c) => c.url) },
    );
    return cands;
  } catch (e) {
    emit("warn", etapa, "Gemini falhou ao sugerir fontes", String(e));
    return [];
  }
}

/** Cascata de fallback quando o Apify não entrega: OpenAI → Gemini. */
async function fallbackSearch(
  query: string,
  emit: Emit,
  etapa: EtapaTag,
  opts: { limit?: number; timeoutMs?: number; uf?: string } = {},
): Promise<SearchCandidate[]> {
  const viaOpenai = await openaiSearch(query, emit, etapa, opts);
  if (viaOpenai.length > 0) return viaOpenai;
  emit("warn", etapa, "OpenAI não trouxe resultados — última tentativa pelo Gemini");
  return geminiSearch(query, emit, etapa, { limit: opts.limit, uf: opts.uf });
}

/** Google SERP Scraper do Apify — motor principal de busca.
 * Se falhar ou vier vazio, cai para OpenAI (web_search) e, por último, Gemini. */
async function apifySearch(
  query: string,
  emit: Emit,
  etapa: EtapaTag,
  opts: { limit?: number; timeoutMs?: number; uf?: string } = {},
): Promise<SearchCandidate[]> {
  const limit = opts.limit ?? 10;
  emit("info", etapa, `Apify Google SERP: "${query}"`);
  const r = await googleSerp(query, { resultsPerPage: limit, timeoutMs: opts.timeoutMs ?? 45_000 });
  if (!r.ok) {
    emit("warn", etapa, `Apify SERP indisponível (${r.reason})`);
    if (QUOTA_RE.test(r.reason) || /APIFY_TOKEN|monthly usage|usage limit/i.test(r.reason)) {
      emit("warn", etapa, "Apify sem cota/crédito — refazendo a busca pela OpenAI");
      return fallbackSearch(query, emit, etapa, opts);
    }
    return fallbackSearch(query, emit, etapa, opts);
  }
  const ufLow = opts.uf?.toLowerCase();
  const cands: SearchCandidate[] = r.pages
    .filter((p) => p.url && !isBlockedHost(p.url) && (!ufLow || !govUf(p.url) || govUf(p.url) === ufLow))
    .map((p) => ({
      url: p.url,
      title: p.title ?? "",
      description: p.markdown,
      markdown: null,
    }));
  emit("info", etapa, `Apify SERP trouxe ${cands.length} resultado(s) em ${(r.elapsedMs / 1000).toFixed(1)}s`, {
    candidatos: cands.slice(0, 5).map((c) => ({
      url: c.url,
      snippet: `${c.title} — ${c.description}`.slice(0, 260),
    })),
  });
  if (cands.length === 0) {
    emit("warn", etapa, "Apify retornou SERP vazio — tentando OpenAI web search");
    return fallbackSearch(query, emit, etapa, opts);
  }
  return cands;
}


type SearchFn = (
  query: string,
  etapa: EtapaTag,
  opts?: { limit?: number; tbs?: string; withScrape?: boolean; timeoutMs?: number; uf?: string },
) => Promise<SearchCandidate[]>;

/** Fábrica do dispatcher de busca — cadeia única em todos os fluxos:
 * Apify (SERP) → OpenAI (web_search) → Gemini (Lovable AI, baixa confiança). */
function makeSearchDispatcher(emit: Emit): SearchFn {
  return async (query, etapa, opts = {}) =>
    apifySearch(query, emit, etapa, {
      limit: opts.limit,
      timeoutMs: opts.timeoutMs ?? 45_000,
      uf: opts.uf,
    });
}

/** Leitura de página com timeout duro — devolve null se estourar.
 * Ordem: fetch nativo → Apify (navegador real). */
async function gScrape(
  url: string,
  emit: Emit,
  etapa: EtapaTag,
  opts: { timeoutMs?: number; hardTimeoutMs?: number } = {},
): Promise<string | null> {
  const hard = opts.hardTimeoutMs ?? 8000;
  const inner: { timeoutMs?: number } = { timeoutMs: opts.timeoutMs ?? hard };
  const md = await withTimeout(scrapeMarkdown(url, emit, etapa, inner), hard, `scrapeMarkdown(${shortHost(url)})`, emit, etapa);
  if (md) return md;
  try {
    emit("info", etapa, `Tentando ${shortHost(url)} pelo Apify (navegador real)...`);
    const { ragBrowse } = await import("./apify.server");
    const r = await ragBrowse(url, { maxResults: 1, startUrls: [url], timeoutMs: 90_000 });
    const page = r.ok ? r.pages.find((p) => p.markdown && p.markdown.length > 200) : undefined;
    if (page) {
      emit("success", etapa, `Apify baixou ${shortHost(url)} (${page.markdown.length} chars)`);
      return page.markdown;
    }
    emit("warn", etapa, `Apify também não conseguiu conteúdo de ${shortHost(url)}`);
  } catch (e) {
    emit("warn", etapa, `Falha no fallback Apify em ${shortHost(url)}`, String(e));
  }
  return null;
}


function snippetsBlock(cands: SearchCandidate[]): string {
  if (cands.length === 0) return "";
  const lines = cands.map(
    (c, i) =>
      `[${i + 1}] ${c.title}\n    URL: ${c.url}\n    Resumo: ${c.description || "(sem resumo)"}`,
  );
  return `### Resultados do Google (snippets — frequentemente já trazem nome/contato)\n${lines.join("\n")}\n`;
}

function preferGov(cands: SearchCandidate[], extra?: (u: string) => boolean, ufLow?: string): SearchCandidate[] {
  const OTHER_SECRETARIAS = /(esporte|saude|sa[uú]de|obras|tr[âa]nsito|transito|turismo|cultura|assistencia|assist[êe]ncia|meio[-_.\s]?ambiente|fazenda|planejamento|habitacao|habita[çc][ãa]o|agricultura)/i;
  const SCHOOL_PAGE = /(\bescola\b|cmei|creche|colegio|col[ée]gio|educacao-infantil|ensino-fundamental|educacao-especial|alimentacao-escolar)/i;
  const score = (c: SearchCandidate) => {
    let s = 0;
    const blob = `${c.url} ${c.title ?? ""} ${c.description ?? ""}`;
    if (/\.gov\.br/i.test(c.url)) s += 10;
    if (/\.leg\.br/i.test(c.url)) s += 6;
    if (extra && extra(c.url)) s += 5;
    if (c.markdown) s += 2;
    // Penaliza fortemente páginas claramente de OUTRAS secretarias.
    if (OTHER_SECRETARIAS.test(blob) && !/(educa|seduc|sme|smed)/i.test(blob)) s -= 8;
    // Página de escola/departamento/unidade não deve vencer a página-mãe da Secretaria.
    if (SCHOOL_PAGE.test(blob) && !/secret[áa]ri[ao]\s*:/i.test(blob)) s -= 12;
    // Portal genérico do ESTADO nunca é a fonte certa do secretário MUNICIPAL —
    // penaliza forte (evita contaminação em buscas de capitais de estado).
    if (ufLow && isBareStateHost(shortHost(c.url), ufLow)) s -= 20;
    return -s;
  };
  return [...cands].sort((a, b) => score(a) - score(b));
}

function dedupeByUrl(arr: SearchCandidate[]): SearchCandidate[] {
  const seen = new Set<string>();
  const out: SearchCandidate[] = [];
  for (const c of arr) {
    if (!seen.has(c.url)) {
      seen.add(c.url);
      out.push(c);
    }
  }
  return out;
}

// ---- Seleção/ranking de e-mails ----
const GENERIC_LOCAL = /^(ouvidoria|faleconosco|fale-conosco|falecom|contato|imprensa|gabinete|prefeito|atendimento|protocolo|rh)@/i;
const EDUCATION_LOCAL = /^(seduc|sme|smed|educacao|educa|secretariadeeducacao|secretaria\.educacao)/i;
// Escolas/CMEIs/creches/conselhos — NUNCA devem virar contato da Secretaria.
// "em[a-z]{2,}" cobre a convenção comum de sigla "EM + iniciais da escola"
// (ex.: emsha@ = "EM Secretário Humberto Almeida"), não só emef/emei/etc.
const SCHOOL_LOCAL = /^(escola|colegio|col[ée]gio|em[a-z]{2,}|cmei|cmeb|cei|creche|biblioteca|cras|cmdca|conselho)/i;
const SCHOOL_DOMAIN = /(^|\.)(escola|colegio|cmei|emei|emef|creche)\./i;

function isSchoolEmail(e: string): boolean {
  const [local = "", domain = ""] = e.toLowerCase().split("@");
  return SCHOOL_LOCAL.test(local) || SCHOOL_DOMAIN.test(domain);
}

function rankEmails(emails: string[], municipio: string, uf: string, topHost?: string): string[] {
  const slug = slugify(municipio);
  const ufLow = uf.toLowerCase();
  const topHostLow = (topHost ?? "").toLowerCase();
  const score = (e: string) => {
    const [local = "", domain = ""] = e.toLowerCase().split("@");
    let s = 0;
    if (EDUCATION_LOCAL.test(`${local}@`) || /(seduc|educa)/i.test(local)) s += 20;
    // Bônus para local part EXATA (sem ramal/sufixo) — seduc@ > seduc_dir_*@
    if (/^(seduc|sme|smed|educacao)$/.test(local)) s += 10;
    // Penalidade para ramais internos: token_edu seguido de underscore (seduc_dir_*, educacao_geral_*)
    if (/^(seduc|sme|smed|educacao|educa)_/.test(local)) s -= 5;
    if (/^educacao\./i.test(domain)) s += 8;
    if (domain.includes(`${slug}.${ufLow}.gov.br`) || domain.endsWith(`.${slug}.${ufLow}.gov.br`)) s += 6;
    if (domain.endsWith(".gov.br")) s += 3;
    if (topHostLow && (domain === topHostLow || topHostLow.endsWith(domain) || domain.endsWith(topHostLow))) s += 5;
    if (GENERIC_LOCAL.test(e)) s -= 15;
    if (isSchoolEmail(e)) s -= 100;
    return -s;
  };
  const uniq = Array.from(new Set(emails.map((e) => e.trim()).filter(Boolean)));
  return uniq.sort((a, b) => score(a) - score(b));
}

/**
 * Filtra e-mails para o resultado final.
 * - Remove SEMPRE e-mails de escolas/CMEIs (não são contato da Secretaria).
 * - Se houver e-mail bom (não-genérico), descarta os genéricos.
 * Retorna [] se sobrar apenas lixo (chamador então tenta próximo estágio).
 */
function filterEmailsForFinal(emails: string[], municipio: string, uf: string, topHost?: string): string[] {
  const ranked = rankEmails(emails, municipio, uf, topHost).filter((e) => !isSchoolEmail(e));
  const good = ranked.filter((e) => !GENERIC_LOCAL.test(e));
  return good.length > 0 ? good : ranked;
}

// ---- Validação anti-alucinação: manter só o que aparece literalmente no texto-fonte ----
function digits(s: string): string {
  return s.replace(/\D+/g, "");
}

function filterPresent(extracted: Extracted, source: string, municipio?: string, uf?: string): Extracted {
  const lower = source.toLowerCase();
  let emails = extracted.emails.filter((e) => lower.includes(e.toLowerCase().trim()));

  // Anti-contaminação: e-mail .gov.br tem que conter o SLUG do município-alvo
  // no domínio. Se não contém, é de outro município mesmo dentro da UF correta
  // (ex.: educacao@barreiras.ba.gov.br aparecendo em busca de Paratinga/BA).
  // NUNCA mantém como "último recurso" — um e-mail confirmado de outra
  // cidade é pior que nenhum e-mail (o próximo estágio da cascata tenta de novo).
  if (municipio && uf && emails.length > 0) {
    const slug = slugify(municipio);
    const isForeignGov = (e: string) => {
      const domain = (e.split("@")[1] ?? "").toLowerCase();
      if (!domain.endsWith(".gov.br")) return false;
      return !domain.includes(slug);
    };
    emails = emails.filter((e) => !isForeignGov(e));
  }

  const sourceDigits = digits(source);
  const telefones = extracted.telefones.filter((t) => {
    const d = digits(t);
    return d.length >= 8 && sourceDigits.includes(d);
  });
  return { ...extracted, emails, telefones };
}

function extractSecretaryLine(source: string): { nome: string | null; email: string | null; cargo: string | null } {
  const m = /\b(Secret[áa]ri[ao](?:a)?(?:\s+Municipal\s+de\s+Educa[çc][ãa]o)?)\s*:\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ'.-]+(?:\s+(?:de|da|do|dos|das|e)\s+|\s+)[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ'.-]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ'.-]+){0,4})(?:\s*\(([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\))?/i.exec(source);
  if (!m) return { nome: null, email: null, cargo: null };
  return {
    cargo: /educa/i.test(m[1]) ? m[1].trim() : "Secretária Municipal de Educação",
    nome: m[2].replace(/\s+/g, " ").trim(),
    email: m[3]?.trim() ?? null,
  };
}

function extractHorario(source: string): string | null {
  const labeled = /Hor[áa]rio\s+(?:de\s+Atendimento|de\s+funcionamento)?\s*:\s*([^\n.]{8,140})/i.exec(source);
  if (labeled) return labeled[1].replace(/\s+/g, " ").trim();
  const inline = /(De\s+segunda\s+a\s+sexta(?:-feira)?[^\n.]{0,80}(?:\d{1,2}h\d{0,2}|\d{1,2}:\d{2})[^\n.]{0,80})/i.exec(source);
  return inline ? inline[1].replace(/\s+/g, " ").trim() : null;
}

function looksLikeOfficialEducationPage(c: SearchCandidate, slug: string, ufLow: string): boolean {
  const url = c.url.toLowerCase();
  const host = shortHost(url).toLowerCase();
  const dominioOficial = DOMINIO_OFICIAL_ESPECIAL[slug];
  if (isDominioOficialEspecial(host, dominioOficial)) {
    return /(secretaria[^/]*educacao|secretarias\/secretaria-educacao|secretaria-de-educacao|secretaria\s+de\s+educa|secretaria municipal de educa|\/educacao\b)/i.test(
      `${url} ${c.title} ${c.description}`,
    );
  }
  if (!host.endsWith(".gov.br")) return false;
  // ATENÇÃO: NÃO usar url.includes(`${ufLow}.gov.br`) aqui — isso bate com o
  // domínio de QUALQUER outro município do mesmo estado (ex.: "barreiras.ba.gov.br"
  // contém a substring "ba.gov.br"). Só aceita o slug do alvo ou o portal
  // genérico do estado (sem subdomínio de outro município).
  if (!host.includes(slug) && !url.includes(slug) && !isBareStateHost(host, ufLow)) return false;
  return /(secretaria[^/]*educacao|secretarias\/secretaria-educacao|secretaria-de-educacao|secretaria\s+de\s+educa|secretaria municipal de educa)/i.test(
    `${url} ${c.title} ${c.description}`,
  );
}

function normNome(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Anti-alucinação da equipe: cada nome precisa aparecer literalmente (por tokens) no texto-fonte. */
function filterEquipeAgainstSource(
  equipe: EquipeMembro[],
  conteudo: string,
  secretario?: string | null,
): EquipeMembro[] {
  if (!Array.isArray(equipe) || equipe.length === 0) return [];
  const srcNorm = normNome(conteudo);
  const titular = secretario ? normNome(secretario) : "";
  return dedupeEquipe(
    equipe.filter((m) => {
      if (!m?.nome) return false;
      const n = normNome(m.nome);
      if (n.length < 5) return false;
      if (titular && n === titular) return false;
      const tokens = n.split(" ").filter((t) => t.length >= 3);
      if (tokens.length < 2) return false;
      return tokens.every((t) => srcNorm.includes(t));
    }),
  );
}

function dedupeEquipe(list: EquipeMembro[]): EquipeMembro[] {
  const byKey = new Map<string, EquipeMembro>();
  for (const m of list) {
    if (!m?.nome || m.nome.trim().length < 3) continue;
    const key = normNome(m.nome);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...m, nome: m.nome.trim() });
    } else {
      byKey.set(key, {
        nome: prev.nome,
        cargo: prev.cargo ?? m.cargo ?? null,
        email: prev.email ?? m.email ?? null,
        telefone: prev.telefone ?? m.telefone ?? null,
      });
    }
  }
  return Array.from(byKey.values());
}

function mergeExtracted(base: Extracted, patch: Partial<Extracted>, municipio: string, uf: string, topHost?: string): Extracted {
  const emails = filterEmailsForFinal([...(patch.emails ?? []), ...base.emails], municipio, uf, topHost);
  const telefones = Array.from(new Set([...(base.telefones ?? []), ...(patch.telefones ?? [])]));
  const equipe = dedupeEquipe([...(base.equipe ?? []), ...(patch.equipe ?? [])]);
  return {
    ...base,
    secretario: base.secretario ?? patch.secretario ?? null,
    cargo: base.cargo ?? patch.cargo ?? null,
    emails,
    telefones,
    contexto: base.contexto ?? patch.contexto ?? null,
    dataReferencia: base.dataReferencia ?? patch.dataReferencia ?? null,
    horarioAtendimento: base.horarioAtendimento ?? patch.horarioAtendimento ?? null,
    equipe,
  };
}


// Páginas de "estrutura organizacional/organograma" são comuns em sites de
// prefeitura (geralmente exigidas por lei de transparência) e frequentemente
// são um diretório renderizado 100% via JS (dados vêm de uma API depois do
// carregamento) — o fetch nativo baixa só o HTML estático (menu/rodapé, sem
// nenhum dado real), que ainda assim passa fácil no teste de tamanho.
const DIRECTORY_PAGE_RE = /(estrutura-organizacional|estrutura-administrativa|organograma|quem-e-quem)/i;
const HAS_EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

async function scrapeMarkdown(
  url: string,
  emit: Emit,
  etapa: EtapaTag,
  opts: { timeoutMs?: number } = {},
): Promise<string | null> {
  emit("info", etapa, `Baixando ${shortHost(url)} (fetch nativo)...`);
  const native = await fetchHtml(url, {
    timeoutMs: opts.timeoutMs,
    emit: (msg, data) => emit("info", etapa, msg, data),
  });
  if (native.ok) {
    const md = htmlToMarkdown(native.html, native.finalUrl);
    const flat = md.replace(/\s+/g, " ").trim();
    const pareceVazioPorJs = DIRECTORY_PAGE_RE.test(url) && !HAS_EMAIL_RE.test(flat);
    if (flat.length >= 200 && !pareceVazioPorJs) {
      emit("success", etapa, `Página baixada direto (${(native.bytes / 1024).toFixed(1)} KB → ${md.length} chars markdown)`, { via: "native" });
      return md.slice(0, 18000);
    }
    if (pareceVazioPorJs) {
      emit("warn", etapa, "Página de estrutura organizacional sem e-mail no HTML estático (provável renderização via JS) — caindo para o Apify");
    } else {
      emit("warn", etapa, "HTML nativo curto — caindo para o Apify");
    }
  } else {
    emit("warn", etapa, `Fetch nativo falhou (${native.reason}) — caindo para o Apify`);
  }
  return null;
}

// ===== Estágio 1: extrai SOMENTE o nome atual =====
async function extractNomeWithAI(
  conteudo: string,
  url: string,
  municipio: string,
  uf: string,
  emit: Emit,
  opts: { diarioBlock?: string } = {},
): Promise<NomeOnly | null> {
  const { diarioBlock = "" } = opts;
  const ai = getProvider();
  const anoAtual = new Date().getFullYear();
  const prompt = `Você identifica o(a) SECRETÁRIO(A) MUNICIPAL DE EDUCAÇÃO ATUAL de ${municipio}/${uf}.
Hoje é ${new Date().toISOString().slice(0, 10)} (ano corrente: ${anoAtual}).

OBJETIVO desta etapa:
1) NOME e CARGO do(a) SECRETÁRIO(A) titular. NÃO devolva e-mail nem telefone da pessoa aqui.
2) EQUIPE: TODAS as demais pessoas da Secretaria de Educação citadas com NOME + CARGO (Secretário(a) Adjunto(a), Chefe de Gabinete, Diretor(a), Coordenador(a), Assessor(a), Chefe de Divisão/Departamento, Assistente etc.). Devolva no campo "equipe" como array de {nome, cargo, email?, telefone?}. Se o texto trouxer e-mail/telefone ao lado da pessoa, inclua; senão deixe null.

REGRAS:
- NUNCA invente. Só extraia o que aparece LITERALMENTE no texto/snippets.
- "secretario" só com nome de pessoa real citada como responsável pela Educação.
- Se houver mais de um nome no topo, escolha o ATUAL — mais recentemente empossado (pistas: "nomeado", "empossado", "tomou posse", "a partir de DD/MM/AAAA", data mais recente, ${anoAtual}).
- Se houver exoneração/troca do titular, ignore o nome antigo NO CAMPO "secretario" (mas pode listar em "equipe" se o cargo atual ainda for citado).
- Snippets do Google geralmente refletem o titular ATUAL — prefira-os ao Diário Oficial quando houver conflito, salvo se o trecho do diário for claramente mais recente.
- "dataReferencia": data/mês/ano da evidência (ex.: "${anoAtual}-11", "abril/${anoAtual}"); senão null.
- "confianca" = "alta" só quando o nome ATUAL está claramente identificado.
- Se encontrar um nome em snippets de domínio ".gov.br" do próprio município, marque confiança como "alta" automaticamente, mesmo que o snippet seja curto.
- Aceite o nome se ele aparecer ao menos 2 vezes nos snippets combinados, mesmo sem data explícita — nesse caso, confiança "media" ou "alta".
- Antes de retornar confiança "baixa", releia mentalmente APENAS os snippets de ".gov.br" isolados e tente extrair novamente; só desista se ainda assim não houver evidência clara.
- Em "equipe", NÃO inclua diretores(as) de escolas/CMEIs individuais — apenas quadro da Secretaria.

URL: ${url}
${diarioBlock}
Conteúdo:
"""
${conteudo}
"""

Responda APENAS com JSON válido seguindo o schema.`;
  emit("info", "nome", "IA extraindo NOME atual (sem contatos)...");
  try {
    const { object } = await generateObject({
      model: ai.model,
      schema: NomeSchema,
      prompt,
    });
    const out = object as NomeOnly;
    // Anti-alucinação da equipe.
    const beforeEqNome = out.equipe?.length ?? 0;
    out.equipe = filterEquipeAgainstSource(out.equipe, conteudo, out.secretario);
    if (beforeEqNome !== out.equipe.length) {
      emit("info", "nome", `Equipe: IA propôs ${beforeEqNome}, ${out.equipe.length} confirmados no texto`);
    }
    emit(
      out.confianca === "baixa" ? "warn" : "success",
      "nome",
      `Nome: ${out.secretario ?? "—"} · confiança ${out.confianca}${out.dataReferencia ? ` · ref ${out.dataReferencia}` : ""}${out.equipe.length ? ` · equipe ${out.equipe.length}` : ""}`,
      out,
    );
    return out;
  } catch (e) {
    emit("error", "nome", "IA falhou ao extrair nome", String(e));
    return null;
  }
}

// ===== Estágios 2/3/4: extrai contatos =====
async function extractWithAI(
  conteudo: string,
  url: string,
  etapa: Hierarquia,
  municipio: string,
  uf: string,
  emit: Emit,
  opts: {
    nomeAlvo?: string | null;
    diarioBlock?: string;
    modo?: "snippets" | "site";
    topHost?: string;
  } = {},
): Promise<Extracted | null> {
  const { nomeAlvo = null, diarioBlock = "", modo = "site", topHost } = opts;
  const ai = getProvider();

  const focoEtapa = nomeAlvo
    ? `E-MAIL e TELEFONE vinculados a "${nomeAlvo}" / Secretaria de Educação que ele(a) chefia.`
    : etapa === "educacao"
      ? "E-MAIL e TELEFONE institucionais da Secretaria Municipal de Educação."
      : etapa === "geral"
        ? "Contato institucional GERAL da prefeitura (ouvidoria, fale-conosco, telefone/e-mail principal)."
        : "Contato do Gabinete do Prefeito (último recurso).";

  const hints = extractContactsRegex(conteudo);
  const hintsBlock =
    hints.emails.length || hints.telefones.length
      ? `\nPISTAS pré-extraídas por regex (só use se também aparecerem no texto):\n  e-mails: ${hints.emails.join(", ") || "—"}\n  telefones: ${hints.telefones.join(", ") || "—"}\n`
      : "";

  const fonteLbl = modo === "snippets" ? "snippets do Google" : "página oficial";
  const prompt = `Você extrai CONTATOS institucionais da Secretaria de Educação de ${municipio}/${uf} a partir de ${fonteLbl}.

${nomeAlvo ? `NOME CONFIRMADO: "${nomeAlvo}". Priorize contatos vinculados a essa pessoa/secretaria.\n` : ""}FOCO (${etapa}): ${focoEtapa}

REGRAS GERAIS:
- NUNCA invente. Só extraia e-mails/telefones que aparecem LITERALMENTE no texto/snippets.
- Telefones BR com DDD quando possível. Não devolva números soltos sem contexto de telefone.
- "confianca" = "alta" só quando o contato está claramente ligado à Secretaria de Educação${nomeAlvo ? " ou ao(à) titular" : ""}.

REGRAS DE E-MAIL (CRÍTICO — não erre isso):
- PRIORIZE e-mails específicos da Educação: começam com "seduc@", "sme@", "smed@", "educacao@", "educa@", ou domínio "educacao.{municipio}.gov.br".
- PROIBIDO devolver e-mail de ESCOLA, COLÉGIO, EMEF, EMEI, CMEI, CRECHE, CEI ou Conselho/Biblioteca. Esses são unidades, NÃO são a Secretaria. Se só houver e-mail de escola/CMEI, devolva "emails": [] e deixe o próximo estágio buscar o contato geral.
- EVITE e-mails genéricos da prefeitura ("ouvidoria@", "faleconosco@", "contato@", "imprensa@", "gabinete@", "prefeito@") — só os devolva se forem os ÚNICOS presentes.
- Quando houver um e-mail bom de Educação no texto, NÃO inclua os genéricos.
- Ordene "emails" do MAIS ESPECÍFICO (Educação) para o MAIS GENÉRICO.
- Mesma regra vale para telefones: prefira o ramal/linha direta da Secretaria de Educação ao da central da prefeitura.

HORÁRIO DE ATENDIMENTO:
- Preencha "horarioAtendimento" SOMENTE se aparecer literalmente no texto (ex.: "Segunda a Sexta, 8h às 17h", "Seg–Sex 08:00–17:00"). Senão null.

EQUIPE (importantíssimo):
- Devolva em "equipe" TODAS as pessoas citadas com NOME + CARGO ligadas à Secretaria: Secretário(a) Adjunto(a), Chefe de Gabinete, Diretor(a) de Departamento, Coordenador(a) de área/etapa (Educação Infantil, Fundamental, Especial, EJA, Alimentação Escolar, Transporte, Formação, Tecnologia), Assessor(a), Chefe de Divisão, Assistente, Ouvidor(a).
- Para cada pessoa: {"nome": "...", "cargo": "...", "email": "..." ou null, "telefone": "..." ou null}. Só inclua email/telefone se aparecerem LITERALMENTE ao lado da pessoa no texto.
- NÃO inclua diretores(as) de escolas/CMEIs individuais.
- Não repita o(a) titular no array "equipe" (ele(a) já vai em "secretario"/"cargo").

DATA: preencha "dataReferencia" (ex.: "${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}") quando o texto indicar; senão null.

URL: ${url}
${diarioBlock}${hintsBlock}
Conteúdo:
"""
${conteudo}
"""

Responda APENAS com JSON válido seguindo o schema.`;
  emit("info", etapa, `IA ${modo === "snippets" ? "(snippets)" : "(página)"} extraindo contatos${nomeAlvo ? ` de "${nomeAlvo}"` : ""}...`, { pistas: hints });
  try {
    const { object } = await generateObject({
      model: ai.model,
      schema: ExtractSchema,
      prompt,
    });
    let out = object as Extracted;
    if (nomeAlvo && !out.secretario) out.secretario = nomeAlvo;
    // Anti-alucinação: descarta o que não aparece literalmente.
    const beforeE = out.emails.length;
    const beforeT = out.telefones.length;
    out = filterPresent(out, conteudo, municipio, uf);
    if (beforeE !== out.emails.length || beforeT !== out.telefones.length) {
      emit("warn", etapa, `Descartei ${beforeE - out.emails.length} e-mail(s) e ${beforeT - out.telefones.length} tel sem correspondência literal no texto`);
    }
    // Filtro escola/CMEI + ranking final (Educação primeiro, genéricos por último).
    const beforeSchool = out.emails.length;
    if (out.emails.length > 0) {
      out.emails = filterEmailsForFinal(out.emails, municipio, uf, topHost);
    }
    if (beforeSchool !== out.emails.length) {
      emit("warn", etapa, `Descartei ${beforeSchool - out.emails.length} e-mail(s) de escola/CMEI`);
    }
    // Anti-alucinação da equipe: exige que cada NOME apareça literalmente no texto (por tokens normalizados).
    const beforeEq = out.equipe?.length ?? 0;
    out.equipe = filterEquipeAgainstSource(out.equipe, conteudo, out.secretario);
    if (beforeEq !== out.equipe.length) {
      emit("info", etapa, `Equipe: IA propôs ${beforeEq}, ${out.equipe.length} confirmados no texto (${beforeEq - out.equipe.length} descartado(s) sem correspondência literal)`);
    }
    emit(
      out.confianca === "baixa" ? "warn" : "success",
      etapa,
      `IA respondeu — ${out.emails.length} email · ${out.telefones.length} tel · ${out.equipe.length} equipe · confiança ${out.confianca}${out.horarioAtendimento ? ` · 🕒` : ""}${out.dataReferencia ? ` · ref ${out.dataReferencia}` : ""}`,
      out,
    );
    return out;
  } catch (e) {
    const err = e as { message?: string };
    // Sem fallback burro por regex: regex não entende contexto (não distingue
    // e-mail da Secretaria de e-mail de escola/pessoa), então uma falha da IA
    // aqui deve virar "não encontrado nesta fonte" e deixar o próximo estágio
    // tentar — nunca um contato de baixa confiança inventado por regex.
    emit("error", etapa, "IA falhou ao extrair contatos — não encontrado, seguindo para próxima fonte", { message: err?.message });
    return null;
  }
}

function hasUsefulContact(e: Extracted | null): boolean {
  return !!e && (e.emails.length > 0 || e.telefones.length > 0);
}

const EnrichSchema = z.object({
  equipe: EquipeSchema,
  horarioAtendimento: z.string().nullable().optional().default(null),
});

/**
 * Segunda passada, focada SÓ em equipe/horário, sobre o MESMO conteúdo já baixado
 * (sem custo de rede extra). Roda quando a extração principal já achou um contato
 * bom mas voltou sem equipe/horário — a IA principal prioriza secretário/e-mail e
 * frequentemente deixa esses campos secundários na mesa num único prompt.
 */
async function extractEquipeHorario(
  conteudo: string,
  url: string,
  municipio: string,
  uf: string,
  emit: Emit,
  etapa: EtapaTag,
  secretarioConhecido: string | null,
): Promise<{ equipe: EquipeMembro[]; horarioAtendimento: string | null } | null> {
  const ai = getProvider();
  const prompt = `O(a) titular da Secretaria Municipal de Educação de ${municipio}/${uf} já foi identificado(a)${secretarioConhecido ? ` (${secretarioConhecido})` : ""}. Releia o texto abaixo À PROCURA APENAS de:

1) EQUIPE: outras pessoas citadas com NOME + CARGO ligadas à Secretaria (Secretário(a) Adjunto(a), Chefe de Gabinete, Diretor(a) de Departamento, Coordenador(a) de área/etapa — Educação Infantil, Fundamental, Especial, EJA, Alimentação Escolar, Transporte, Formação, Tecnologia —, Assessor(a), Chefe de Divisão, Assistente, Ouvidor(a)).
   - Para cada pessoa: {"nome", "cargo", "email" ou null, "telefone" ou null}. Só inclua email/telefone se aparecerem LITERALMENTE ao lado da pessoa.
   - NÃO inclua diretores(as) de escola/CMEI individuais nem repita o(a) titular.
2) HORÁRIO DE ATENDIMENTO: só se aparecer literalmente (ex.: "Segunda a Sexta, 8h às 17h").

NUNCA invente — só o que aparece LITERALMENTE no texto. Se não achar nada num dos dois campos, devolva vazio/null nesse campo.

URL: ${url}
Conteúdo:
"""
${conteudo}
"""

Responda APENAS com JSON válido seguindo o schema.`;
  try {
    const { object } = await generateObject({
      model: ai.model,
      schema: EnrichSchema,
      prompt,
    });
    const out = object as { equipe: EquipeMembro[]; horarioAtendimento: string | null };
    const beforeEq = out.equipe?.length ?? 0;
    const equipe = filterEquipeAgainstSource(out.equipe, conteudo, secretarioConhecido);
    if (beforeEq !== equipe.length) {
      emit("info", etapa, `Enriquecimento equipe: IA propôs ${beforeEq}, ${equipe.length} confirmados no texto`);
    }
    let horarioAtendimento = out.horarioAtendimento?.trim() || null;
    if (horarioAtendimento && !conteudo.toLowerCase().includes(horarioAtendimento.toLowerCase().slice(0, 20))) {
      emit("warn", etapa, `Enriquecimento: descartei horário sem correspondência literal ("${horarioAtendimento}")`);
      horarioAtendimento = null;
    }
    return { equipe, horarioAtendimento };
  } catch (e) {
    emit("warn", etapa, "Enriquecimento equipe/horário falhou", String(e));
    return null;
  }
}

function fonteLabel(etapa: Hierarquia) {
  return etapa === "educacao"
    ? "Secretaria de Educação"
    : etapa === "camara"
      ? "Câmara Municipal (fallback)"
      : etapa === "geral"
        ? "Contato geral da prefeitura"
        : "Gabinete do Prefeito (último recurso)";
}


const empty = (contexto: string | null = null): ProspectResult => ({
  status: "not_found",
  hierarquia: null,
  secretario: null,
  cargo: null,
  emails: [],
  telefones: [],
  fonte: null,
  fonteUrl: null,
  contexto,
});

// ============================================================
// FASE 1 (isolada) — só descobre e confirma o domínio oficial. Sem IA.
// ============================================================
export async function prospectarDominio(
  municipio: string,
  uf: string,
  onEvent?: (evt: ProgressEvent) => void,
): Promise<ProspectResult> {
  const t0 = Date.now();
  const emit: Emit = (level, etapa, message, data) => {
    onEvent?.({ kind: "progress", level, etapa, message, data, ts: Date.now(), elapsedMs: Date.now() - t0 });
  };
  const slug = slugify(municipio);
  const ufLow = uf.toLowerCase();
  const dominioEspecial = DOMINIO_OFICIAL_ESPECIAL[slug];
  const search = makeSearchDispatcher(emit);

  emit("info", "init", `Fase domínio — descobrindo site oficial de ${municipio}/${uf}`);

  // Query A = padrão direto (o mesmo domínio-padrão usado no Estágio 1 do fluxo completo,
  // ou o override conhecido) — quando bate, é confirmação FORTE. Query B = busca genérica,
  // usada só quando A não acha nada — confirmação mais fraca (fica marcada para revisão).
  const queryA = `site:${dominioEspecial ?? `${slug}.${ufLow}.gov.br`} prefeitura`;
  const queryB = `"${municipio}" prefeitura ${uf} site oficial`;
  // 45s: o SERP do Apify leva de 10s a 40s por consulta — com o timeout antigo de 8s
  // a resposta era cortada e a fase voltava vazia como se nada existisse.
  const candsA = await search(queryA, "init", { limit: 5, timeoutMs: 45_000, uf });
  const candsB = candsA.length === 0 ? await search(queryB, "init", { limit: 5, timeoutMs: 45_000, uf }) : [];

  const fortesHosts = new Set(
    candsA
      .filter((c) => isConfirmableOfficialHost(shortHost(c.url), slug, ufLow, dominioEspecial))
      .map((c) => stripWww(shortHost(c.url))),
  );
  const cands = preferGov(filterForeignMunicipio(dedupeByUrl([...candsA, ...candsB]), slug, emit, "init"), undefined, ufLow);

  for (const c of cands) {
    const host = shortHost(c.url);
    if (!isConfirmableOfficialHost(host, slug, ufLow, dominioEspecial)) continue;
    const dominio = isDominioOficialEspecial(host, dominioEspecial) ? dominioEspecial! : stripWww(host);
    const forte = isDominioOficialEspecial(host, dominioEspecial) || fortesHosts.has(stripWww(host));
    emit("success", "init", `Domínio confirmado: ${dominio}${forte ? "" : " (confirmação fraca — só via busca genérica)"}`);
    return {
      ...empty(),
      status: "found",
      fonte: forte ? "Busca direta no domínio padrão" : "Busca genérica (prefeitura + site oficial)",
      fonteUrl: c.url,
      dominioOficialConfirmado: dominio,
      confianca: forte ? "alta" : "media",
      revisar: !forte,
      motivoRevisao: forte ? null : "dominio: confirmação incerta (achado só por busca genérica, não pelo padrão site:{slug}.{uf}.gov.br)",
    };
  }
  const brutos = candsA.length + candsB.length;
  const motivo =
    brutos === 0
      ? `A busca (Apify/OpenAI/Gemini) não retornou nenhum resultado para "${queryA}" nem para "${queryB}" — pode ser cota/timeout do provedor ou o município realmente não ter site indexado.`
      : `A busca retornou ${brutos} resultado(s), mas nenhum host confirmável como oficial (esperado algo como ${dominioEspecial ?? `${slug}.${ufLow}.gov.br`}); os achados eram de outro município/UF ou não-.gov.br. Hosts vistos: ${cands.slice(0, 4).map((c) => stripWww(shortHost(c.url))).join(", ") || "nenhum após filtro"}.`;
  emit("warn", "init", `Nenhum domínio oficial confirmável encontrado — ${motivo}`);
  return empty(motivo);
}

// ============================================================
// FASE 2 (isolada) — só descobre o nome/cargo do secretário, dentro do
// domínio JÁ confirmado (sitemap, sem Google/Apify).
// ============================================================

/** Descobre páginas da Secretaria de Educação dentro do domínio confirmado:
 * sitemap/robots/home primeiro (grátis) e, só se vier vazio, uma única consulta
 * SERP restrita ao próprio domínio (`site:dominio ...`) — sem risco de contaminação
 * por outro município, já que o host é o confirmado. */
async function descobrirPaginasEducacao(
  dominioOficial: string,
  emit: Emit,
  etapa: EtapaTag,
): Promise<{ candidates: string[]; via: string }> {
  const { discoverEducationPages } = await import("./sitemap.server");
  const disc = await discoverEducationPages(dominioOficial);
  if (disc.candidates.length > 0) return { candidates: disc.candidates, via: disc.via };

  emit("warn", etapa, `Sem candidatos por sitemap/home em ${dominioOficial} — tentando SERP restrita ao domínio`);
  const cands = await apifySearch(`site:${dominioOficial} secretaria municipal de educação`, emit, etapa, {
    limit: 10,
    timeoutMs: 45_000,
  });
  const host = dominioOficial.toLowerCase();
  const urls = cands
    .map((c) => c.url)
    .filter((u) => stripWww(shortHost(u)).toLowerCase().endsWith(stripWww(host).toLowerCase()))
    .slice(0, 8);
  return { candidates: urls, via: urls.length > 0 ? "serp-no-dominio" : "none" };
}


export async function prospectarSecretario(
  municipio: string,
  uf: string,
  dominioOficial: string,
  onEvent?: (evt: ProgressEvent) => void,
): Promise<ProspectResult> {
  const t0 = Date.now();
  const emit: Emit = (level, etapa, message, data) => {
    onEvent?.({ kind: "progress", level, etapa, message, data, ts: Date.now(), elapsedMs: Date.now() - t0 });
  };
  emit("info", "nome", `Fase secretário — vasculhando ${dominioOficial} via sitemap`);
  const { candidates, via } = await descobrirPaginasEducacao(dominioOficial, emit, "nome");
  emit("info", "nome", `${candidates.length} candidato(s) via ${via}`);

  let melhor: { out: NomeOnly; url: string } | null = null;
  let lidas = 0;
  for (const url of candidates) {
    const md = await gScrape(url, emit, "nome", { hardTimeoutMs: 20_000 });
    if (!md) continue;
    lidas++;
    const out = await extractNomeWithAI(md, url, municipio, uf, emit);
    if (!out?.secretario) continue;
    if (out.confianca === "alta") {
      return {
        ...empty(out.contexto),
        status: "found",
        hierarquia: "educacao",
        secretario: out.secretario,
        cargo: out.cargo,
        fonte: `Sitemap do domínio confirmado (${via})`,
        fonteUrl: url,
        dataReferencia: out.dataReferencia,
        equipe: out.equipe,
        confianca: out.confianca,
        revisar: false,
      };
    }
    if (!melhor) melhor = { out, url };
  }
  if (melhor) {
    emit("warn", "nome", `Nome com confiança ${melhor.out.confianca} — marcado para revisão`);
    return {
      ...empty(melhor.out.contexto),
      status: "partial",
      hierarquia: "educacao",
      secretario: melhor.out.secretario,
      cargo: melhor.out.cargo,
      fonte: `Sitemap do domínio confirmado (${via})`,
      fonteUrl: melhor.url,
      dataReferencia: melhor.out.dataReferencia,
      equipe: melhor.out.equipe,
      confianca: melhor.out.confianca,
      revisar: true,
      motivoRevisao: `secretario: confiança ${melhor.out.confianca}`,
    };
  }
  const motivoNome =
    candidates.length === 0
      ? `Nenhuma página de Educação encontrada em ${dominioOficial} (sitemap/home e busca no domínio vieram vazios).`
      : lidas === 0
        ? `${candidates.length} página(s) candidata(s) em ${dominioOficial}, mas nenhuma pôde ser lida (scrape bloqueado ou timeout).`
        : `${lidas} página(s) lida(s) em ${dominioOficial}, mas a IA não identificou nome de secretário(a).`;
  emit("warn", "nome", `Nenhum nome de secretário encontrado — ${motivoNome}`);
  return empty(motivoNome);
}

// ============================================================
// FASE 3 (isolada) — só descobre e-mails/telefones, dentro do domínio JÁ
// confirmado. Regex primeiro (ranking já prioriza local-parts tipo
// seduc/sme/smed/educacao via EDUCATION_LOCAL em rankEmails/filterEmailsForFinal);
// IA só como fallback quando o regex não acha nada de bom.
// ============================================================
export async function prospectarContato(
  municipio: string,
  uf: string,
  dominioOficial: string,
  onEvent?: (evt: ProgressEvent) => void,
  paginaEducacaoUrl?: string | null,
): Promise<ProspectResult> {
  const t0 = Date.now();
  const emit: Emit = (level, etapa, message, data) => {
    onEvent?.({ kind: "progress", level, etapa, message, data, ts: Date.now(), elapsedMs: Date.now() - t0 });
  };
  emit("info", "educacao", `Fase contato — buscando e-mails/telefones em ${dominioOficial}`);

  let candidateUrls: string[];
  let via: string;
  if (paginaEducacaoUrl) {
    candidateUrls = [paginaEducacaoUrl];
    via = "página conhecida";
  } else {
    const disc = await descobrirPaginasEducacao(dominioOficial, emit, "educacao");
    candidateUrls = disc.candidates;
    via = disc.via;
  }
  emit("info", "educacao", `${candidateUrls.length} candidato(s) via ${via}`);

  let melhor: { emails: string[]; telefones: string[]; url: string } | null = null;
  let lidas = 0;

  for (const url of candidateUrls) {
    const md = await gScrape(url, emit, "educacao", { hardTimeoutMs: 20_000 });
    if (!md) continue;
    lidas++;
    const hints = extractContactsRegex(md);
    const emails = filterEmailsForFinal(hints.emails, municipio, uf, dominioOficial).filter((e) => !isSchoolEmail(e));
    const telefones = hints.telefones;
    if (emails.length === 0 && telefones.length === 0) continue;

    const hasGoodEmail = emails.some((e) => !GENERIC_LOCAL.test(e));
    if (hasGoodEmail) {
      emit("success", "educacao", `Regex achou e-mail direto em ${shortHost(url)}`);
      return {
        ...empty(),
        status: "found",
        hierarquia: "educacao",
        emails,
        telefones,
        fonte: `Regex (${via})`,
        fonteUrl: url,
        confianca: "alta",
        revisar: false,
      };
    }
    if (!melhor) melhor = { emails, telefones, url };
  }

  // Regex não achou e-mail direto (só genérico ou nada) — tenta IA na melhor candidata.
  const urlFallback = melhor?.url ?? candidateUrls[0];
  if (urlFallback) {
    const md = await gScrape(urlFallback, emit, "educacao", { hardTimeoutMs: 20_000 });
    if (md) {
      const ext = await extractWithAI(md, urlFallback, "educacao", municipio, uf, emit, { topHost: dominioOficial });
      if (ext && (ext.emails.length > 0 || ext.telefones.length > 0)) {
        const hasGoodEmail = ext.emails.some((e) => !GENERIC_LOCAL.test(e));
        return {
          ...empty(ext.contexto),
          status: hasGoodEmail ? "found" : "partial",
          hierarquia: "educacao",
          emails: ext.emails,
          telefones: ext.telefones,
          fonte: `IA fallback (${via})`,
          fonteUrl: urlFallback,
          confianca: ext.confianca,
          revisar: !hasGoodEmail || ext.confianca !== "alta",
          motivoRevisao: !hasGoodEmail
            ? "contato: apenas e-mail genérico (ouvidoria/faleconosco/etc.)"
            : `contato: confiança ${ext.confianca}`,
        };
      }
    }
  }

  if (melhor) {
    emit("warn", "educacao", "Só achei e-mail/telefone genérico — marcado para revisão");
    return {
      ...empty(),
      status: "partial",
      hierarquia: "educacao",
      emails: melhor.emails,
      telefones: melhor.telefones,
      fonte: `Regex (${via})`,
      fonteUrl: melhor.url,
      confianca: "media",
      revisar: true,
      motivoRevisao: "contato: apenas e-mail genérico (ouvidoria/faleconosco/etc.)",
    };
  }

  const motivoContato =
    candidateUrls.length === 0
      ? `Nenhuma página de Educação encontrada em ${dominioOficial} (sitemap/home e busca no domínio vieram vazios).`
      : lidas === 0
        ? `${candidateUrls.length} página(s) candidata(s) em ${dominioOficial}, mas nenhuma pôde ser lida (scrape bloqueado ou timeout).`
        : `${lidas} página(s) lida(s) em ${dominioOficial}, mas sem e-mail/telefone válido (regex e IA não acharam contato aproveitável).`;
  emit("warn", "educacao", `Nenhum contato encontrado — ${motivoContato}`);
  return empty(motivoContato);
}

export async function prospectar(
  municipio: string,
  uf: string,
  onEvent?: (evt: ProgressEvent) => void,
  ibgeId?: number,
  dominioConfirmado?: string | null,
  paginaEducacaoConhecida?: string | null,
): Promise<ProspectResult> {
  const t0 = Date.now();
  

  const emit: Emit = (level, etapa, message, data) => {
    onEvent?.({
      kind: "progress",
      level,
      etapa,
      message,
      data,
      ts: Date.now(),
      elapsedMs: Date.now() - t0,
    });
  };
  // Pool global de EQUIPE — coletada a cada extração e injetada no resultado final.
  const equipePool: EquipeMembro[] = [];
  const pushEquipe = (list?: EquipeMembro[] | null) => {
    if (!list || list.length === 0) return;
    for (const m of list) if (m?.nome) equipePool.push(m);
  };

  const runExtract: typeof extractWithAI = async (...args) => {
    const r = await extractWithAI(...args);
    if (r?.equipe?.length) pushEquipe(r.equipe);
    // Enriquecimento: quando a extração principal já achou um contato útil mas
    // voltou sem equipe/horário, faz uma 2ª passada focada SÓ nesses campos sobre
    // o MESMO conteúdo (sem custo de rede extra) — a passada principal costuma
    // priorizar secretário/e-mail e deixar detalhes secundários na mesa.
    if (r && hasUsefulContact(r) && (r.equipe.length === 0 || !r.horarioAtendimento)) {
      const [conteudo, url, etapa] = args;
      if (conteudo.length > 800) {
        emit("info", etapa, "Enriquecimento — 2ª passada focada em equipe/horário sobre a mesma fonte");
        const extra = await extractEquipeHorario(conteudo, url, municipio, uf, emit, etapa, r.secretario);
        if (extra) {
          if (extra.equipe.length > 0) {
            r.equipe = dedupeEquipe([...r.equipe, ...extra.equipe]);
            pushEquipe(extra.equipe);
          }
          if (!r.horarioAtendimento && extra.horarioAtendimento) {
            r.horarioAtendimento = extra.horarioAtendimento;
          }
          if (extra.equipe.length > 0 || extra.horarioAtendimento) {
            const parts = [
              extra.equipe.length > 0 ? `+${extra.equipe.length} equipe` : null,
              extra.horarioAtendimento ? "horário" : null,
            ].filter(Boolean);
            emit("success", etapa, `Enriquecimento trouxe ${parts.join(" · ")}`);
          } else {
            emit("info", etapa, "Enriquecimento não achou equipe/horário adicionais nesta fonte");
          }
        }
      }
    }
    return r;
  };
  const runExtractNome: typeof extractNomeWithAI = async (...args) => {
    const r = await extractNomeWithAI(...args);
    if (r?.equipe?.length) pushEquipe(r.equipe);
    return r;
  };


  // Decide se o resultado desta run confirma um domínio oficial pra persistir
  // (usado em runs futuras como fonte exclusiva — ver Estágio 0 mais abaixo).
  // Câmara Municipal NUNCA confirma (é outra entidade, mesmo que .gov.br por engano).
  const dominioParaConfirmar = (result: ProspectResult): { dominio: string | null; pagina: string | null } => {
    if (result.hierarquia === "camara" || !result.fonteUrl) return { dominio: null, pagina: null };
    const host = shortHost(result.fonteUrl);
    if (!isConfirmableOfficialHost(host, slug, ufLow, dominioOficial)) return { dominio: null, pagina: null };
    const dominio = isDominioOficialEspecial(host, dominioOficial) ? dominioOficial! : stripWww(host);
    return { dominio, pagina: result.hierarquia === "educacao" ? result.fonteUrl : null };
  };

  const sendFinal = (result: ProspectResult) => {
    const { dominio, pagina } = dominioParaConfirmar(result);
    const merged: ProspectResult = {
      ...result,
      equipe: dedupeEquipe([...(result.equipe ?? []), ...equipePool]),
      dominioOficialConfirmado: dominio,
      paginaEducacaoUrl: pagina,
    };
    onEvent?.({ kind: "final", result: merged, ts: Date.now(), elapsedMs: Date.now() - t0 });
    return merged;
  };

  emit("info", "init", `Iniciando ${municipio}/${uf} — pipeline ESCALONADO (nome → contato)`);

  // Dispatcher de busca — Apify SERP com fallback automático OpenAI → Gemini.
  const search = makeSearchDispatcher(emit);
  const anoAtual = new Date().getFullYear();
  const slug = slugify(municipio);
  const ufLow = uf.toLowerCase();
  const dominioOficial = DOMINIO_OFICIAL_ESPECIAL[slug];
  if (dominioOficial) emit("info", "nome", `Domínio oficial conhecido para ${municipio}: ${dominioOficial} (não segue o padrão {slug}.{uf}.gov.br)`);

  // ============================================================
  // ESTÁGIO 0 — domínio oficial JÁ CONFIRMADO em run anterior (ou pelo admin)
  // ============================================================
  // Quando presente, essa é a fonte EXCLUSIVA — não busca no Google/Apify
  // (por decisão de produto: menos custo, sem risco de contaminação entre
  // municípios). Precisa rodar ANTES da IIFE do RAG em background (mais
  // abaixo), senão as chamadas Apify já teriam disparado mesmo com o
  // short-circuit, anulando o ganho de custo desta feature.
  if (dominioConfirmado) {
    const runConfirmedDomainFlow = async (): Promise<ProspectResult | null> => {
      if (paginaEducacaoConhecida) {
        const md = await gScrape(paginaEducacaoConhecida, emit, "educacao", { hardTimeoutMs: 8000 });
        if (md) {
          const ext = await runExtract(md, paginaEducacaoConhecida, "educacao", municipio, uf, emit, { topHost: dominioConfirmado });
          const hasGoodEmail = ext?.emails.some((e) => !GENERIC_LOCAL.test(e)) ?? false;
          if (ext && (hasGoodEmail || ext.telefones.length > 0 || ext.secretario)) {
            return {
              status: hasGoodEmail ? "found" : "partial",
              hierarquia: "educacao",
              secretario: ext.secretario,
              cargo: ext.cargo,
              emails: ext.emails,
              telefones: ext.telefones,
              fonte: "Página conhecida da Secretaria (domínio confirmado)",
              fonteUrl: paginaEducacaoConhecida,
              contexto: ext.contexto,
              dataReferencia: ext.dataReferencia,
              horarioAtendimento: ext.horarioAtendimento,
            };
          }
        }
      }
      const { discoverEducationPages } = await import("./sitemap.server");
      const { candidates, via } = await discoverEducationPages(dominioConfirmado);
      emit("info", "educacao", `Estágio 0 — ${candidates.length} candidato(s) via ${via} em ${dominioConfirmado}`);
      let melhor: ProspectResult | null = null;
      for (const url of candidates) {
        const md = await gScrape(url, emit, "educacao", { hardTimeoutMs: 8000 });
        if (!md) continue;
        const ext = await runExtract(md, url, "educacao", municipio, uf, emit, { topHost: dominioConfirmado });
        if (!ext || !hasUsefulContact(ext)) continue;
        const hasGoodEmail = ext.emails.some((e) => !GENERIC_LOCAL.test(e));
        const candidateResult: ProspectResult = {
          status: hasGoodEmail ? "found" : "partial",
          hierarquia: "educacao",
          secretario: ext.secretario,
          cargo: ext.cargo,
          emails: ext.emails,
          telefones: ext.telefones,
          fonte: `Sitemap do domínio confirmado (${via})`,
          fonteUrl: url,
          contexto: ext.contexto,
          dataReferencia: ext.dataReferencia,
          horarioAtendimento: ext.horarioAtendimento,
        };
        if (hasGoodEmail) return candidateResult;
        if (!melhor) melhor = candidateResult;
      }
      return melhor;
    };

    emit("info", "educacao", `Estágio 0 — domínio oficial já confirmado (${dominioConfirmado}); pulando Google/Apify`);
    const stage0 = await withTimeout(runConfirmedDomainFlow(), 45_000, "runConfirmedDomainFlow", emit, "educacao");
    if (stage0) return sendFinal(stage0);
    emit("warn", "educacao", "Domínio confirmado não teve página localizável — not_found (sem fallback ao Google, por decisão de produto)");
    return sendFinal({
      status: "not_found",
      hierarquia: null,
      secretario: null,
      cargo: null,
      emails: [],
      telefones: [],
      fonte: null,
      fonteUrl: null,
      contexto: `Domínio confirmado (${dominioConfirmado}) sem página de contato localizável via sitemap/links.`,
      horarioAtendimento: null,
    });
  }

  // Pool global de snippets — reaproveitado entre estágios.
  const snippetPool: SearchCandidate[] = [];
  const seenUrls = new Set<string>();
  const addToPool = (cands: SearchCandidate[]) => {
    for (const c of cands) {
      if (!c?.url || seenUrls.has(c.url)) continue;
      seenUrls.add(c.url);
      snippetPool.push(c);
    }
  };


  // Querido Diário foi desativado do pipeline para evitar atrasos e dados desatualizados.
  const diarioBlock = "";


  // RAG Web Browser (Apify) em background — DUAS queries paralelas.
  //  A) foco em nome do secretário (SERP + scrape dos top resultados)
  //  B) foco na subpágina da Secretaria dentro do domínio oficial do município
  // Ambas com timeout longo (120s) — o pipeline aguarda o RAG antes de desistir.
  const ragPagesMap = new Map<string, ApifyPage>();
  const addRagPages = (pages: ApifyPage[]) => {
    for (const p of pages) {
      if (!p.url) continue;
      if (isForeignMunicipioHost(shortHost(p.url), slug)) continue;
      const prev = ragPagesMap.get(p.url);
      if (!prev || (p.markdown?.length ?? 0) > (prev.markdown?.length ?? 0)) {
        ragPagesMap.set(p.url, p);
      }
    }
  };
  const ragQueryA = `prefeitura ${municipio} ${uf} secretaria municipal de educação secretário atual contato email telefone`;
  const ragQueryB = DOMINIO_OFICIAL_ESPECIAL[slug]
    ? `site:${DOMINIO_OFICIAL_ESPECIAL[slug]} "Secretaria Municipal de Educação" contato email telefone`
    : `site:${ufLow}.gov.br "${municipio}" "Secretaria Municipal de Educação" contato email telefone`;
  emit("info", "init", `RAG (Apify) A em background: "${ragQueryA.slice(0, 80)}"`);
  emit("info", "init", `RAG (Apify) B em background: "${ragQueryB.slice(0, 80)}"`);
  const runRag = async (
    label: "A" | "B",
    query: string,
    opts: { maxResults: number; timeoutMs: number; startUrls?: string[] },
  ) => {
    let r = await ragBrowse(query, opts);
    if (!r.ok && /memory-limit|exceed the memory/i.test(r.reason)) {
      emit("warn", "init", `RAG ${label} sem memória no Apify — aguardando 20s e tentando novamente`);
      await new Promise<void>((resolve) => setTimeout(resolve, 20_000));
      r = await ragBrowse(query, { ...opts, maxResults: Math.min(opts.maxResults, 3) });
    }
    if (!r.ok) {
      emit("warn", "init", `RAG ${label} indisponível (${r.reason})`);
      return;
    }
    const good = r.pages.filter((p) => p.markdown && p.markdown.length > 200);
    addRagPages(good);
    emit("success", "init", `RAG ${label}: ${good.length} pág. em ${(r.elapsedMs / 1000).toFixed(1)}s`);
  };
  const ragAll: Promise<void> = (async () => {
    // Serializado: dois actors Playwright simultâneos estouram o limite de memória do Apify.
    await runRag("B", ragQueryB, {
      maxResults: 5,
      timeoutMs: 120_000,
      startUrls: [
        `https://${slug}.${ufLow}.gov.br/`,
        `https://www.${slug}.${ufLow}.gov.br/`,
        `https://${slug}.${ufLow}.gov.br/secretarias/secretaria-educacao/`,
        `https://www.${slug}.${ufLow}.gov.br/secretarias/secretaria-educacao/`,
      ],
    });
    await runRag("A", ragQueryA, { maxResults: 5, timeoutMs: 120_000 });
  })().catch((e) => emit("warn", "init", `RAG erro: ${String(e)}`));

  const getRagPages = (): ApifyPage[] =>
    Array.from(ragPagesMap.values()).sort((a, b) => (b.markdown?.length ?? 0) - (a.markdown?.length ?? 0));

  // Helper: aguarda até `ms` pelo RAG e devolve markdown consolidado (top páginas).
  const awaitRagBlock = async (ms: number, label: string): Promise<string> => {
    await Promise.race([ragAll, new Promise<void>((r) => setTimeout(r, ms))]);
    const pages = getRagPages();
    if (pages.length === 0) return "";
    const block = pages
      .slice(0, 3)
      .map((p, i) => `[RAG ${i + 1}] ${p.title ?? ""}\nURL: ${p.url}\n${p.markdown.slice(0, 4000)}`)
      .join("\n\n---\n\n");
    emit("info", "educacao", `${label} — anexando ${Math.min(3, pages.length)} pág. do RAG ao prompt`);
    return `### Páginas recuperadas via RAG Web Browser\n${block}\n`;
  };

  // Busca uma página do RAG que combine com uma URL/host (usada nos fallbacks).
  const findRagPageFor = (url: string): ApifyPage | null => {
    const host = shortHost(url).toLowerCase();
    const pages = getRagPages();
    const exact = pages.find((p) => p.url === url);
    if (exact) return exact;
    return pages.find((p) => {
      const h = shortHost(p.url).toLowerCase();
      return h === host || h.endsWith(`.${host}`) || host.endsWith(`.${h}`);
    }) ?? null;
  };

  const isRagResultTrustworthy = (ext: Extracted | null): boolean => {
    if (!ext) return false;
    if (!ext.secretario && ext.emails.length === 0) return false;
    const hasGoodEmail = ext.emails.some((e) => !GENERIC_LOCAL.test(e));
    return !!ext.secretario || hasGoodEmail;
  };



  // ============================================================
  // ESTÁGIO 1 — NOME ATUAL (apenas nome, sem contato)
  // ============================================================
  emit("info", "nome", "Estágio 1 — identificar NOME atual do(a) Secretário(a) de Educação");
  // Query principal (validada manualmente: traz o site oficial + nome do titular
  // nos snippets na maioria dos municípios testados).
  const queryNome0 = `nome e contato do secretário(a) de educação de ${municipio} ${uf}`;
  const queryNomeA = `prefeitura municipal ${municipio} ${uf} secretaria de educação secretário atual`;
  const queryNomeB = `secretário OR secretária de educação ${municipio} ${uf} ${anoAtual} atual`;
  const queryNomeC = `site:${dominioOficial ?? `${slug}.${ufLow}.gov.br`} secretaria educação secretário`;
  const [candsNome0, candsNomeA, candsNomeB, candsNomeC] = await Promise.all([
    search(queryNome0, "nome", { limit: 8, timeoutMs: 8000, uf }),
    search(queryNomeA, "nome", { limit: 8, tbs: "qdr:y", timeoutMs: 8000, uf }),
    search(queryNomeB, "nome", { limit: 6, tbs: "qdr:y", timeoutMs: 8000, uf }),
    search(queryNomeC, "nome", { limit: 5, tbs: "qdr:y", timeoutMs: 8000, uf }),
  ]);

  // Fallback de domínio: se o domínio padrão {slug}.{uf}.gov.br não retornou nada e não
  // conhecemos o domínio real do município, tenta {uf}.gov.br com o nome do município.
  // CUIDADO: em capitais de estado, o portal do próprio ESTADO ({uf}.gov.br) menciona a
  // capital o tempo todo (é onde o governo estadual fica sediado) e pode contaminar o
  // resultado com o secretário ESTADUAL de educação em vez do municipal — por isso só
  // usamos esse fallback quando não há domínio oficial conhecido, e os resultados vindos
  // do portal estadual "puro" são descartados logo abaixo (preferGov penaliza isBareStateHost).
  let candsNomeCfb: SearchCandidate[] = [];
  if (candsNomeC.length === 0 && !dominioOficial) {
    const queryNomeCfb = `site:${ufLow}.gov.br "${municipio}" secretaria educação secretário`;
    candsNomeCfb = await search(queryNomeCfb, "nome", { limit: 5, tbs: "qdr:y", timeoutMs: 8000, uf });
  }
  // Priorizar resultados do domínio oficial do município (queryNomeC/fb) ANTES de A/B.
  const candsNome = filterForeignMunicipio(dedupeByUrl([...candsNomeC, ...candsNomeCfb, ...candsNome0, ...candsNomeA, ...candsNomeB]), slug, emit, "nome");
  addToPool(candsNome);
  const rankedNome = preferGov(candsNome, (u) => /(educa|secretari)/i.test(u), ufLow);
  const snippetsNome = snippetsBlock(rankedNome);
  const topNome = rankedNome[0] ?? null;
  const topHost = topNome ? shortHost(topNome.url) : undefined;

  let nomeSecretario: string | null = null;
  let cargoSecretario: string | null = null;
  let nomeFonte: ProspectResult["nomeFonte"] = null;
  let dataReferenciaGlobal: string | null = null;


  if (snippetsNome) {
    const nomeRes = await runExtractNome(snippetsNome, topNome?.url ?? "(snippets)", municipio, uf, emit, {
      diarioBlock,
    });

    // ---- Promoção determinística da confiança (não depende da IA) ----
    // Normaliza texto removendo acentos, lowercase, colapsa espaços.
    const norm = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    // Preposições descartáveis na comparação por tokens.
    const STOP = new Set(["de","da","do","dos","das","e","a","o"]);
    // Verifica se o nome aparece num blob de texto, com tolerância a acentos e tokens parciais.
    const nameAppearsIn = (nome: string, blob: string): boolean => {
      const nNome = norm(nome);
      const nBlob = norm(blob);
      // Match direto (nome completo normalizado).
      if (nBlob.includes(nNome)) return true;
      // Match por tokens: pelo menos 2 tokens significativos (len >= 4, fora das preposições) presentes no blob.
      const tokens = nNome.split(" ").filter(t => t.length >= 4 && !STOP.has(t));
      if (tokens.length >= 2) {
        const hits = tokens.filter(t => nBlob.includes(t));
        if (hits.length >= 2) return true;
      }
      return false;
    };
    let confianca: "alta" | "media" | "baixa" = nomeRes?.confianca ?? "baixa";
    let appearsCount = 0;
    let appearsInOwnGov = false;
    let aggregateMatch = false;
    if (nomeRes?.secretario) {
      for (const c of rankedNome) {
        const blob = `${c.title ?? ""} ${c.description ?? ""} ${c.url}`;
        if (!nameAppearsIn(nomeRes.secretario, blob)) continue;
        appearsCount += 1;
        const host = shortHost(c.url).toLowerCase();
        if (isConfirmableOfficialHost(host, slug, ufLow, dominioOficial)) appearsInOwnGov = true;
      }
      // Match agregado: soma de TODOS os snippets, para pegar nomes montados a
      // partir de fragmentos espalhados em snippets diferentes (comum quando o
      // Google trunca resultados). Mantém a mesma checagem literal, só amplia
      // a evidência considerada de "um snippet" para "todos os snippets".
      const aggregateBlob = rankedNome.map(c => `${c.title ?? ""} ${c.description ?? ""} ${c.url}`).join(" ");
      aggregateMatch = nameAppearsIn(nomeRes.secretario, aggregateBlob);

      if (appearsInOwnGov) confianca = "alta";
      else if (appearsCount >= 1 && confianca === "baixa") confianca = "media";
      else if (appearsCount >= 2) confianca = "media";
      else if (aggregateMatch && confianca === "baixa") confianca = "media";

      emit("info", "nome", `Confiança ajustada: IA=${nomeRes.confianca} → ${confianca} (aparições=${appearsCount}, agregado=${aggregateMatch}, govPróprio=${appearsInOwnGov})`);
      // Warn detalhado se ainda não bateu — facilita debug futuro.
      if (appearsCount === 0 && !aggregateMatch) {
        const sample = rankedNome.slice(0, 3).map(c => norm(`${c.title} ${c.description}`));
        emit("warn", "nome", `Nome "${norm(nomeRes.secretario)}" não bateu em nenhum snippet nem no agregado — blobs normalizados:`, { sample });
      } else if (appearsCount === 0 && aggregateMatch) {
        emit("info", "nome", `Nome "${norm(nomeRes.secretario)}" não bateu em um snippet isolado, mas bateu no agregado de todos os snippets — aceitando.`);
      }
    }
    // Aceita o nome se: existe E (confiança não-baixa OU aparece em pelo menos 1 snippet
    // OU bate no agregado de todos os snippets OU a própria IA retornou media/alta).
    const aceitaNome =
      !!nomeRes?.secretario &&
      (confianca !== "baixa" ||
        appearsCount >= 1 ||
        aggregateMatch ||
        nomeRes.confianca === "media" ||
        nomeRes.confianca === "alta");
    if (nomeRes?.secretario && !aceitaNome) {
      emit("warn", "nome", `Descartando nome "${nomeRes.secretario}" — confiança baixa e sem aparições nos snippets`);
    }
    if (aceitaNome && nomeRes?.secretario) {
      nomeSecretario = nomeRes.secretario;
      cargoSecretario = nomeRes.cargo ?? cargoSecretario;
      nomeFonte = "snippet";
      dataReferenciaGlobal = nomeRes.dataReferencia ?? dataReferenciaGlobal;
    }
  } else {
    emit("warn", "nome", "Busca de nome não retornou resultados");
  }

  if (nomeSecretario) {
    emit("success", "nome", `Estágio 1 OK — nome atual: ${nomeSecretario} (fonte: ${nomeFonte})`);
  } else {
    emit("warn", "nome", "Estágio 1 não fechou o nome — seguirei para contato institucional");
  }

  let melhorParcial: { ext: Extracted; url: string | null; via: string } | null = null;

  // ============================================================
  // ESTÁGIO 1.5 — Scrape oportunista do topo (se for página da Secretaria)
  // ============================================================
  const looksLikeSeducPage = (c?: SearchCandidate | null) => {
    if (!c) return false;
    const text = `${c.url} ${c.title ?? ""} ${c.description ?? ""}`.toLowerCase();
    return (
      /\.gov\.br|\.leg\.br/.test(c.url) &&
      /(seduc|sme|smed|educa)/.test(text)
    );
  };
  if (looksLikeSeducPage(topNome)) {
    emit("info", "educacao", `Estágio 1.5 — scrape oportunista de ${topHost}`);
    let md = await gScrape(topNome!.url, emit, "educacao", { timeoutMs: 6000, hardTimeoutMs: 6000 });
    let usedRag = false;
    if (!md || md.replace(/\s+/g, " ").trim().length < 500) {
      // Site lento ou markdown pobre — tenta reaproveitar RAG (se já retornou).
      await Promise.race([ragAll, new Promise<void>((r) => setTimeout(r, 8000))]);
      const ragPage = findRagPageFor(topNome!.url);
      if (ragPage && ragPage.markdown.length > (md?.length ?? 0)) {
        emit("info", "educacao", `Estágio 1.5 — usando página do RAG (${shortHost(ragPage.url)}, ${ragPage.markdown.length} chars)`);
        md = ragPage.markdown.slice(0, 18000);
        usedRag = true;
      }
    }
    if (md) {
      const combined = `### Site\n${md}\n\n### Snippets\n${snippetsBlock(rankedNome)}`;
      const ext = await runExtract(combined, topNome!.url, "educacao", municipio, uf, emit, {
        nomeAlvo: nomeSecretario,
        diarioBlock,
        modo: "site",
        topHost,
      });
      if (ext && hasUsefulContact(ext)) {
        const hasGood = ext.emails.some((e) => !GENERIC_LOCAL.test(e)) || ext.telefones.length > 0;
        if (hasGood) {
          emit("success", "educacao", `✨ Contato via página oficial topo${usedRag ? " (via RAG)" : ""} (${Date.now() - t0}ms)`);
          return sendFinal({
            status: "found",
            hierarquia: "educacao",
            secretario: nomeSecretario ?? ext.secretario,
            cargo: cargoSecretario ?? ext.cargo,
            emails: ext.emails,
            telefones: ext.telefones,
            fonte: usedRag ? "Site oficial da Secretaria de Educação (via RAG)" : "Site oficial da Secretaria de Educação",
            fonteUrl: topNome!.url,
            contexto: ext.contexto,
            nomeFonte: nomeFonte ?? (ext.secretario ? "snippet" : null),
            dataReferencia: ext.dataReferencia ?? dataReferenciaGlobal,
            horarioAtendimento: ext.horarioAtendimento ?? null,
          });
        }
      }
    }
  }

  // Estágio 1.6 — Google SERP Scraper do Apify.
  // Em alguns portais lentos (ex.: SJP), o snippet do Google via Apify traz mais
  // contexto que o Firecrawl: nome/e-mail no resultado principal e telefone/horário
  // no snippet da página oficial.
  {
    emit("info", "educacao", "Estágio 1.6 — enriquecendo por Apify Google SERP (snippets ricos)");
    const apifyNome = await apifySearch(
      `prefeitura municipal ${municipio} ${uf} secretaria de educação secretário atual contato email telefone`,
      emit,
      "educacao",
      { limit: 10, timeoutMs: 45_000, uf },
    );
    const apifyPagina = await apifySearch(
      dominioOficial
        ? `site:${dominioOficial} ${municipio} Secretaria de Educação email telefone horário`
        : `site:www.${slug}.${ufLow}.gov.br/secretarias/secretaria-educacao/ ${municipio} Secretaria de Educação email telefone horário`,
      emit,
      "educacao",
      { limit: 10, timeoutMs: 45_000, uf },
    );
    const apifyCands = filterForeignMunicipio(dedupeByUrl([...apifyNome, ...apifyPagina]), slug, emit, "educacao");
    addToPool(apifyCands);
    const official = preferGov(apifyCands.filter((c) => looksLikeOfficialEducationPage(c, slug, ufLow)), (u) => /(educa|seduc|sme)/i.test(u), ufLow);
    const ranked = official.length > 0 ? official : preferGov(apifyCands, (u) => /(educa|seduc|sme)/i.test(u), ufLow);
    const snippets = snippetsBlock(ranked);
    if (snippets) {
      const line = extractSecretaryLine(snippets);
      const regex = extractContactsRegex(snippets);
      const deterministic: Extracted = filterPresent({
        secretario: line.nome ?? nomeSecretario,
        cargo: line.cargo ?? cargoSecretario,
        emails: filterEmailsForFinal([...(line.email ? [line.email] : []), ...regex.emails], municipio, uf, topHost),
        telefones: regex.telefones,
        contexto: "Dados extraídos de snippets ricos do Google SERP Scraper do Apify.",
        confianca: line.nome || regex.emails.length > 0 ? "alta" : "media",
        dataReferencia: dataReferenciaGlobal,
        horarioAtendimento: extractHorario(snippets),
        equipe: [],
      }, snippets, municipio, uf);
      let ext = deterministic;
      if (!ext.secretario || (ext.emails.length === 0 && ext.telefones.length === 0)) {
        const aiExt = await runExtract(snippets, ranked[0]?.url ?? "(apify-serp)", "educacao", municipio, uf, emit, {
          nomeAlvo: nomeSecretario ?? line.nome,
          modo: "snippets",
          topHost,
        });
        if (aiExt) ext = mergeExtracted(deterministic, aiExt, municipio, uf, topHost);
      }
      const hasGoodEmail = ext.emails.some((e) => !GENERIC_LOCAL.test(e));
      if (ext.secretario && (hasGoodEmail || ext.telefones.length > 0)) {
        emit("success", "educacao", `✨ Contato enriquecido via Apify SERP (${Date.now() - t0}ms)`);
        return sendFinal({
          status: hasGoodEmail ? "found" : "partial",
          hierarquia: "educacao",
          secretario: nomeSecretario ?? ext.secretario,
          cargo: cargoSecretario ?? ext.cargo,
          emails: ext.emails,
          telefones: ext.telefones,
          fonte: "Google SERP Scraper (Apify)",
          fonteUrl: ranked[0]?.url ?? null,
          contexto: ext.contexto,
          nomeFonte: nomeFonte ?? (ext.secretario ? "snippet" : null),
          dataReferencia: ext.dataReferencia ?? dataReferenciaGlobal,
          horarioAtendimento: ext.horarioAtendimento ?? null,
        });
      }
      if (hasUsefulContact(ext) && !melhorParcial) melhorParcial = { ext, url: ranked[0]?.url ?? null, via: "Google SERP Scraper (Apify)" };
    }
  }


  // ============================================================
  // ESTÁGIO 2 — CONTATO VINCULADO AO NOME (cascata interna)
  // ============================================================
  const tentarContato = async (
    query: string,
    via: string,
    etapaTag: EtapaTag,
    hierarquia: Hierarquia,
  ): Promise<ProspectResult | null> => {
    const cands = filterForeignMunicipio(await search(query, etapaTag, { limit: 8, tbs: "qdr:y", timeoutMs: 8000, uf }), slug, emit, etapaTag);
    addToPool(cands);
    if (cands.length === 0) return null;
    const ranked = preferGov(cands, (u) => /(educa|seduc|sme)/i.test(u), ufLow);
    const snippets = snippetsBlock(ranked);
    const ext = await runExtract(snippets, ranked[0]?.url ?? "(snippets)", hierarquia, municipio, uf, emit, {
      nomeAlvo: nomeSecretario,
      modo: "snippets",
      topHost,
    });
    if (ext && hasUsefulContact(ext)) {
      const hasGoodEmail = ext.emails.some((e) => !GENERIC_LOCAL.test(e));
      if (hasGoodEmail) {
        emit("success", etapaTag, `✨ Contato encontrado via ${via} (${Date.now() - t0}ms)`);
        return {
          status: "found",
          hierarquia,
          secretario: nomeSecretario ?? ext.secretario,
          cargo: cargoSecretario ?? ext.cargo,
          emails: ext.emails,
          telefones: ext.telefones,
          fonte: via,
          fonteUrl: ranked[0]?.url ?? null,
          contexto: ext.contexto ?? `Snippet (${via}).`,
          nomeFonte: nomeFonte ?? (nomeSecretario ? "snippet" : null),
          dataReferencia: ext.dataReferencia ?? dataReferenciaGlobal,
          horarioAtendimento: ext.horarioAtendimento ?? null,
        };
      }
      if (ext.telefones.length > 0) {
        emit("warn", etapaTag, `${via} trouxe só telefone — guardando parcial e continuando atrás de nome/e-mail/horário`);
      }
      if (!melhorParcial) melhorParcial = { ext, url: ranked[0]?.url ?? null, via };
    }
    return null;
  };

  if (nomeSecretario) {
    emit("info", "contato-secretario", `Estágio 2 — contato vinculado a "${nomeSecretario}"`);
    const r2a = await tentarContato(
      `"${nomeSecretario}" "secretaria de educação" ${municipio} ${uf}`,
      `Snippet vinculado ao nome (${nomeSecretario})`,
      "contato-secretario",
      "educacao",
    );
    if (r2a) return sendFinal(r2a);

    const r2b = await tentarContato(
      `"${nomeSecretario}" ${municipio} ${uf} (email OR e-mail OR telefone OR contato)`,
      `Snippet "${nomeSecretario}" + contato`,
      "contato-secretario",
      "educacao",
    );
    if (r2b) return sendFinal(r2b);

    const all = filterForeignMunicipio(dedupeByUrl([
      ...(await search(`"${nomeSecretario}" secretaria educação ${municipio} ${uf}`, "contato-secretario", { limit: 5, tbs: "qdr:y", timeoutMs: 8000, uf })),
    ]), slug, emit, "contato-secretario");
    addToPool(all);
    const rankedAll = preferGov(all, (u) => /(educa|seduc|sme)/i.test(u), ufLow);
    const topGov = rankedAll.find((c) => /\.gov\.br/i.test(c.url));
    if (topGov) {
      emit("info", "contato-secretario", `Estágio 2.3 — scrape do site oficial (${shortHost(topGov.url)})`);
      const md = await gScrape(topGov.url, emit, "contato-secretario", { hardTimeoutMs: 8000 });
      if (md) {
        const combined = `### Site\n${md}`;
        const ext = await runExtract(combined, topGov.url, "educacao", municipio, uf, emit, {
          nomeAlvo: nomeSecretario,
          modo: "site",
          topHost,
        });
        if (ext && hasUsefulContact(ext)) {
          const hasGood = ext.emails.some((e) => !GENERIC_LOCAL.test(e)) || ext.telefones.length > 0;
          if (hasGood) {
            emit("success", "contato-secretario", `✨ Contato via site oficial (${Date.now() - t0}ms)`);
            return sendFinal({
              status: "found",
              hierarquia: "educacao",
              secretario: nomeSecretario ?? ext.secretario,
              cargo: cargoSecretario ?? ext.cargo,
              emails: ext.emails,
              telefones: ext.telefones,
              fonte: "Site oficial (busca por nome)",
              fonteUrl: topGov.url,
              contexto: ext.contexto,
              nomeFonte,
              dataReferencia: ext.dataReferencia ?? dataReferenciaGlobal,
              horarioAtendimento: ext.horarioAtendimento ?? null,
            });
          }
          if (!melhorParcial) melhorParcial = { ext, url: topGov.url, via: "Site oficial (busca por nome)" };
        }
      }
    }
  }

  // ============================================================
  // ESTÁGIO 3 — CONTATO INSTITUCIONAL DA SECRETARIA (sem o nome)
  // ============================================================
  emit("info", "educacao", "Estágio 3 — contato institucional da Secretaria de Educação");

  // Estágio 3.0 — RAG-first: aguarda até 60s pelo RAG e tenta extração imediata.
  // Se resultado for confiável (nome OU e-mail específico), fecha aqui sem cair
  // em scrapes lentos do Firecrawl que já falharam antes.
  {
    const ragEarly = await awaitRagBlock(60_000, "Estágio 3.0 (RAG-first)");
    if (ragEarly) {
      const ragTopUrl = getRagPages()[0]?.url ?? "(rag)";
      const ext = await runExtract(ragEarly, ragTopUrl, "educacao", municipio, uf, emit, {
        nomeAlvo: nomeSecretario,
        diarioBlock,
        modo: "site",
        topHost,
      });
      if (isRagResultTrustworthy(ext)) {
        const e = ext!;
        const hasGood = e.emails.some((x) => !GENERIC_LOCAL.test(x)) || e.telefones.length > 0;
        if (hasGood) {
          emit("success", "educacao", `✨ RAG-first fechou (${Date.now() - t0}ms)`);
          return sendFinal({
            status: "found",
            hierarquia: "educacao",
            secretario: nomeSecretario ?? e.secretario,
            cargo: cargoSecretario ?? e.cargo,
            emails: e.emails,
            telefones: e.telefones,
            fonte: "RAG Web Browser (Apify)",
            fonteUrl: ragTopUrl,
            contexto: e.contexto,
            nomeFonte: nomeFonte ?? (e.secretario ? "site" : null),
            dataReferencia: e.dataReferencia ?? dataReferenciaGlobal,
            horarioAtendimento: e.horarioAtendimento ?? null,
          });
        }
        if (!melhorParcial) melhorParcial = { ext: e, url: ragTopUrl, via: "RAG Web Browser (Apify)" };
      }
    }
  }

  const ragBlockS3 = await awaitRagBlock(2000, "Estágio 3");


  const r3a = await tentarContato(
    `"secretaria municipal de educação" ${municipio} ${uf} (email OR contato OR telefone)`,
    "Snippet institucional Educação",
    "educacao",
    "educacao",
  );
  if (r3a) return sendFinal(r3a);

  const r3b = await tentarContato(
    `secretaria de educação ${municipio} ${uf} site:gov.br`,
    "Snippet site:gov.br Educação",
    "educacao",
    "educacao",
  );
  if (r3b) return sendFinal(r3b);

  const all3 = filterForeignMunicipio(dedupeByUrl([
    ...(await search(`secretaria municipal de educação ${municipio} ${uf} contato`, "educacao", { limit: 6, timeoutMs: 8000, uf })),
  ]), slug, emit, "educacao");
  addToPool(all3);
  const ranked3 = preferGov(all3, (u) => /(educa|seduc|sme)/i.test(u), ufLow);
  const top3 = ranked3.find((c) => /\.gov\.br|\.leg\.br/i.test(c.url)) ?? ranked3[0];

  // Estágio 3.2 — scrape DEDICADO da página de contato do host de top3 (Correção 3).
  // Captura e-mails como "seduc@municipio.gov.br" que aparecem só em /contato.
  if (top3) {
    const top3Host = shortHost(top3.url);
    const contactQuery = `site:${top3Host} contato OR "fale conosco" OR "e-mail" secretaria educação`;
    const contactCands = await search(contactQuery, "educacao", { limit: 3, timeoutMs: 8000, uf });
    addToPool(contactCands);
    const contactRe = /(\/contato|\/fale[-_]?conosco|\/fale[-_]?com[-_]?nos|\/secretarias?\/educa|\/educacao\/contato|\/atendimento|estrutura-organizacional|estrutura-administrativa|organograma|quem-e-quem)/i;
    const contactUrls = contactCands
      .filter((c) => contactRe.test(c.url))
      .map((c) => c.url)
      .slice(0, 2);
    for (const cu of contactUrls) {
      emit("info", "educacao", `Estágio 3.2 — scrape página de contato ${shortHost(cu)}`);
      const cmd = await gScrape(cu, emit, "educacao", { hardTimeoutMs: 8000 });
      if (!cmd) continue;
      const cext = await runExtract(`### Página de Contato\n${cmd}`, cu, "educacao", municipio, uf, emit, {
        nomeAlvo: nomeSecretario,
        modo: "site",
        topHost,
      });
      if (cext && hasUsefulContact(cext)) {
        const hasGood = cext.emails.some((e) => !GENERIC_LOCAL.test(e)) || cext.telefones.length > 0;
        if (hasGood) {
          emit("success", "educacao", `✨ Contato via página de contato dedicada (${Date.now() - t0}ms)`);
          return sendFinal({
            status: "found",
            hierarquia: "educacao",
            secretario: nomeSecretario ?? cext.secretario,
            cargo: cargoSecretario ?? cext.cargo,
            emails: cext.emails,
            telefones: cext.telefones,
            fonte: "Página de contato da Secretaria",
            fonteUrl: cu,
            contexto: cext.contexto,
            nomeFonte,
            dataReferencia: cext.dataReferencia ?? dataReferenciaGlobal,
            horarioAtendimento: cext.horarioAtendimento ?? null,
          });
        }
        if (!melhorParcial) melhorParcial = { ext: cext, url: cu, via: "Página de contato da Secretaria" };
      }
    }
  }

  if (top3) {
    emit("info", "educacao", `Estágio 3.3 — scrape de ${shortHost(top3.url)}`);
    const md = await gScrape(top3.url, emit, "educacao", { hardTimeoutMs: 8000 });
    if (md) {
      const combined = [`### Site\n${md}`, ragBlockS3].filter(Boolean).join("\n\n");
      const ext = await runExtract(combined, top3.url, "educacao", municipio, uf, emit, {
        nomeAlvo: nomeSecretario,
        modo: "site",
        topHost,
      });
      if (ext && hasUsefulContact(ext)) {
        const hasGood = ext.emails.some((e) => !GENERIC_LOCAL.test(e)) || ext.telefones.length > 0;
        if (hasGood) {
          emit("success", "educacao", `✨ Contato institucional via site (${Date.now() - t0}ms)`);
          return sendFinal({
            status: "found",
            hierarquia: "educacao",
            secretario: nomeSecretario ?? ext.secretario,
            cargo: cargoSecretario ?? ext.cargo,
            emails: ext.emails,
            telefones: ext.telefones,
            fonte: fonteLabel("educacao"),
            fonteUrl: top3.url,
            contexto: ext.contexto,
            nomeFonte,
            dataReferencia: ext.dataReferencia ?? dataReferenciaGlobal,
            horarioAtendimento: ext.horarioAtendimento ?? null,
          });
        }
        if (!melhorParcial) melhorParcial = { ext, url: top3.url, via: fonteLabel("educacao") };
      }
    }
  }

  // Estágio 3.5 — Tentativa exclusiva com RAG Web Browser (última tentativa RAG)
  {
    const ragBlockLate = await awaitRagBlock(90_000, "Estágio 3.5");
    const ragPagesNow = getRagPages();
    if (ragBlockLate) {
      const ext = await runExtract(ragBlockLate, ragPagesNow[0]?.url ?? "(rag)", "educacao", municipio, uf, emit, {
        nomeAlvo: nomeSecretario,
        modo: "site",
        topHost,
      });
      if (ext && hasUsefulContact(ext)) {
        const hasGood = ext.emails.some((e) => !GENERIC_LOCAL.test(e)) || ext.telefones.length > 0;
        if (hasGood) {
          emit("success", "educacao", `✨ Contato via RAG Web Browser (${Date.now() - t0}ms)`);
          return sendFinal({
            status: "found",
            hierarquia: "educacao",
            secretario: nomeSecretario ?? ext.secretario,
            cargo: cargoSecretario ?? ext.cargo,
            emails: ext.emails,
            telefones: ext.telefones,
            fonte: "RAG Web Browser (Apify)",
            fonteUrl: ragPagesNow[0]?.url ?? null,
            contexto: ext.contexto,
            nomeFonte,
            dataReferencia: ext.dataReferencia ?? dataReferenciaGlobal,
            horarioAtendimento: ext.horarioAtendimento ?? null,
          });
        }
        if (!melhorParcial) melhorParcial = { ext, url: ragPagesNow[0]?.url ?? null, via: "RAG Web Browser" };
      }
    }
  }



  // Devolve parcial bom de Educação se houver
  if (melhorParcial) {
    const { ext, url, via } = melhorParcial as { ext: Extracted; url: string | null; via: string };
    emit("warn", "educacao", `Sem e-mail específico de Educação — devolvendo parcial (${via})`);
    return sendFinal({
      status: "partial",
      hierarquia: "educacao",
      secretario: nomeSecretario ?? ext.secretario,
      cargo: cargoSecretario ?? ext.cargo,
      emails: ext.emails,
      telefones: ext.telefones,
      fonte: via,
      fonteUrl: url,
      contexto: ext.contexto,
      nomeFonte,
      dataReferencia: ext.dataReferencia ?? dataReferenciaGlobal,
      horarioAtendimento: ext.horarioAtendimento ?? null,
    });
  }

  // ============================================================
  // ESTÁGIO 4 — Fallbacks institucionais (Câmara → Geral → Gabinete)
  // ============================================================
  async function runFallback(etapa: Hierarquia, query: string, label: string): Promise<ProspectResult | null> {
    emit("info", etapa, `${label} — snippet-only`);
    const cands = filterForeignMunicipio(await search(query, etapa, { limit: 8, timeoutMs: 5000, uf }), slug, emit, etapa);
    addToPool(cands);
    const ranked = preferGov(cands, undefined, ufLow);
    if (ranked.length === 0) return null;
    const snippets = snippetsBlock(ranked);
    let ext = await runExtract(snippets, ranked[0].url, etapa, municipio, uf, emit, { modo: "snippets", topHost });
    if (!ext || !hasUsefulContact(ext)) {
      const md = await gScrape(ranked[0].url, emit, etapa, { hardTimeoutMs: 5000 });
      if (md) {
        const combined = [snippets, `### Site\n${md}`].filter(Boolean).join("\n\n");
        ext = await runExtract(combined, ranked[0].url, etapa, municipio, uf, emit, { modo: "site", topHost });
      }
    }
    if (!ext || !hasUsefulContact(ext)) return null;
    // Correção 4: para cidades grandes, NÃO devolver parcial com emails vazios
    // (anti-contam zerou tudo). Devolver null força o próximo fallback a tentar.
    if (ext.emails.length === 0 && LARGE_MUNI_SLUGS.has(slug)) {
      emit("warn", etapa, `Cidade grande (${slug}) + emails=[] após anti-contam — recusando parcial vazio, próximo fallback`);
      return null;
    }
    return {
      status: "partial",
      hierarquia: etapa,
      secretario: nomeSecretario ?? ext.secretario,
      cargo: cargoSecretario ?? ext.cargo,
      emails: ext.emails,
      telefones: ext.telefones,
      fonte: fonteLabel(etapa),
      fonteUrl: ranked[0].url,
      contexto: ext.contexto,
      nomeFonte: nomeSecretario ? nomeFonte : null,
      dataReferencia: ext.dataReferencia ?? dataReferenciaGlobal,
      horarioAtendimento: ext.horarioAtendimento ?? null,
    };
  }

  // 4.1 — Câmara Municipal (geralmente tem "Fale Conosco" com e-mail institucional)
  emit("warn", "fallback", "Estágio 4.1 — Câmara Municipal (contato/fale conosco)");
  const r4a = await runFallback(
    "camara",
    `câmara municipal ${municipio} ${uf} contato fale conosco (site:${slug}.${ufLow}.leg.br OR site:camara${slug}.${ufLow}.leg.br OR site:.leg.br)`,
    "Câmara Municipal",
  );
  if (r4a) return sendFinal(r4a);

  // 4.2 — Contato geral da Prefeitura
  emit("warn", "fallback", "Estágio 4.2 — contato geral da Prefeitura");
  const r4b = await runFallback(
    "geral",
    `prefeitura ${municipio} ${uf} ouvidoria contato e-mail telefone`,
    "Contato geral da Prefeitura",
  );
  if (r4b) return sendFinal(r4b);

  // 4.3 — Gabinete do Prefeito
  emit("warn", "fallback", "Estágio 4.3 — Gabinete do Prefeito");
  const r4c = await runFallback(
    "gabinete",
    `gabinete do prefeito ${municipio} ${uf} contato e-mail telefone`,
    "Gabinete do Prefeito",
  );
  if (r4c) return sendFinal(r4c);

  if (nomeSecretario) {
    emit("warn", "final", "Só consegui o nome — devolvendo parcial");
    return sendFinal({
      status: "partial",
      hierarquia: "educacao",
      secretario: nomeSecretario,
      cargo: cargoSecretario,
      emails: [],
      telefones: [],
      fonte: nomeFonte === "snippet" ? "Snippet do Google" : "Fonte não identificada",
      fonteUrl: topNome?.url ?? null,
      contexto: "Nome identificado, mas não localizamos e-mail/telefone associados.",
      nomeFonte,
      dataReferencia: dataReferenciaGlobal,
      horarioAtendimento: null,
    });
  }

  emit("error", "final", `Nada utilizável encontrado (${Date.now() - t0}ms)`);
  return sendFinal({
    status: "not_found",
    hierarquia: null,
    secretario: null,
    cargo: null,
    emails: [],
    telefones: [],
    fonte: null,
    fonteUrl: null,
    contexto: "Nenhum contato encontrado.",
    horarioAtendimento: null,
  });
}

