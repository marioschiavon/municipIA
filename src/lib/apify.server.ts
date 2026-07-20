// POC Apify — Website Content Crawler via run-sync-get-dataset-items.
// Isolado, não faz parte do pipeline de prospecção.

export type ApifyPage = {
  url: string;
  title?: string | null;
  markdown: string;
};

export type ApifyCrawlResult = {
  ok: true;
  pages: ApifyPage[];
  elapsedMs: number;
  requestsUsed: number;
} | {
  ok: false;
  reason: string;
  elapsedMs: number;
};

const ACTOR_ID = "apify~website-content-crawler";

export async function crawlSite(
  startUrl: string,
  opts: { timeoutMs?: number; maxRequests?: number; maxDepth?: number; useGlobs?: boolean } = {},
): Promise<ApifyCrawlResult> {
  const started = Date.now();
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, reason: "APIFY_TOKEN não configurado", elapsedMs: 0 };

  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxRequests = opts.maxRequests ?? 8;
  const maxDepth = opts.maxDepth ?? 2;

  const useGlobs = opts.useGlobs ?? true;
  const input: Record<string, unknown> = {
    startUrls: [{ url: startUrl }],
    crawlerType: "playwright:adaptive",
    maxCrawlDepth: maxDepth,
    maxCrawlPages: maxRequests,
    maxRequestsPerCrawl: maxRequests,
    saveMarkdown: true,
    saveHtml: false,
    removeCookieWarnings: true,
    readableTextCharThreshold: 100,
    initialConcurrency: 3,
    maxConcurrency: 5,
    requestTimeoutSecs: 20,
  };
  if (useGlobs) {
    input.includeUrlGlobs = [
      { glob: "**/educacao/**" },
      { glob: "**/educa/**" },
      { glob: "**/sme/**" },
      { glob: "**/seduc/**" },
      { glob: "**/secretaria*/**" },
      { glob: "**/secretarias/**" },
      { glob: "**/contato*" },
      { glob: "**/fale-conosco*" },
      { glob: "**/faleconosco*" },
      { glob: "**/telefone*" },
      { glob: "**/endereco*" },
      { glob: "**/enderecos*" },
      { glob: startUrl.replace(/\/$/, "") + "/*" },
    ];
  }

  const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${Math.floor(timeoutMs / 1000)}&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 5_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 300)}`, elapsedMs };
    }
    const data = (await res.json()) as Array<Record<string, unknown>>;
    // eslint-disable-next-line no-console
    console.log("[apify] raw items:", Array.isArray(data) ? data.length : "not-array", "sample keys:", Array.isArray(data) && data[0] ? Object.keys(data[0]).slice(0, 20) : []);
    if (Array.isArray(data) && data[0]) {
      const s = data[0];
      // eslint-disable-next-line no-console
      console.log("[apify] sample item url/loadedUrl/text.len/markdown.len:", s.url, s.loadedUrl, typeof s.text === "string" ? s.text.length : null, typeof s.markdown === "string" ? s.markdown.length : null);
    }
    const pages: ApifyPage[] = (Array.isArray(data) ? data : []).map((r) => ({
      url: String(r.url ?? r.loadedUrl ?? ""),
      title: (r.metadata as { title?: string } | undefined)?.title ?? (r.title as string | undefined) ?? null,
      markdown:
        (typeof r.markdown === "string" && r.markdown) ||
        (typeof r.text === "string" && r.text) ||
        "",
    })).filter((p) => p.url && p.markdown);

    return { ok: true, pages, elapsedMs, requestsUsed: pages.length };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return {
      ok: false,
      reason: aborted ? `timeout ${timeoutMs}ms` : String(e),
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- helper genérico ----------
async function runActorSync(
  actorId: string,
  input: unknown,
  timeoutMs: number,
): Promise<{ ok: true; items: Array<Record<string, unknown>>; elapsedMs: number } | { ok: false; reason: string; elapsedMs: number }> {
  const started = Date.now();
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, reason: "APIFY_TOKEN não configurado", elapsedMs: 0 };
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${Math.floor(timeoutMs / 1000)}&format=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 5_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 300)}`, elapsedMs };
    }
    const items = (await res.json()) as Array<Record<string, unknown>>;
    // eslint-disable-next-line no-console
    console.log(`[apify:${actorId}] items=${Array.isArray(items) ? items.length : "?"} keys=`, Array.isArray(items) && items[0] ? Object.keys(items[0]).slice(0, 15) : []);
    return { ok: true, items: Array.isArray(items) ? items : [], elapsedMs };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return { ok: false, reason: aborted ? `timeout ${timeoutMs}ms` : String(e), elapsedMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- RAG Web Browser ----------
// apify/rag-web-browser: recebe query, faz Google + scrape dos top N, devolve markdown limpo.
export async function ragBrowse(
  query: string,
  opts: { maxResults?: number; timeoutMs?: number; startUrls?: string[] } = {},
): Promise<ApifyCrawlResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const input: Record<string, unknown> = {
    query,
    maxResults: opts.maxResults ?? 5,
    outputFormats: ["markdown"],
    requestTimeoutSecs: 30,
    scrapingTool: "browser-playwright",
    removeCookieWarnings: true,
  };
  if (opts.startUrls && opts.startUrls.length > 0) {
    input.startUrls = opts.startUrls.map((url) => ({ url }));
  }
  const r = await runActorSync("apify~rag-web-browser", input, timeoutMs);
  if (!r.ok) return r;
  const pages: ApifyPage[] = r.items.map((it) => {
    const md = (typeof it.markdown === "string" && it.markdown) || (typeof it.text === "string" && it.text) || "";
    const meta = (it.metadata as { url?: string; title?: string } | undefined) ?? {};
    const gs = (it.googleSearchResult as { url?: string; title?: string; description?: string } | undefined) ?? {};
    return {
      url: String(meta.url ?? gs.url ?? ""),
      title: meta.title ?? gs.title ?? null,
      markdown: md || (gs.description ?? ""),
    };
  }).filter((p) => p.url);
  return { ok: true, pages, elapsedMs: r.elapsedMs, requestsUsed: pages.length };
}


// ---------- Google Search Scraper ----------
// apify/google-search-scraper: só SERP (title, url, snippet). Sem scrape das páginas.
export async function googleSerp(
  query: string,
  opts: { resultsPerPage?: number; timeoutMs?: number; countryCode?: string; languageCode?: string } = {},
): Promise<ApifyCrawlResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const input = {
    queries: query,
    resultsPerPage: opts.resultsPerPage ?? 10,
    maxPagesPerQuery: 1,
    countryCode: opts.countryCode ?? "br",
    languageCode: opts.languageCode ?? "pt-BR",
    mobileResults: false,
    saveHtml: false,
  };
  const r = await runActorSync("apify~google-search-scraper", input, timeoutMs);
  if (!r.ok) return r;
  const pages: ApifyPage[] = [];
  for (const it of r.items) {
    const organic = (it.organicResults as Array<{ url?: string; title?: string; description?: string; emails?: string[]; phones?: string[] }> | undefined) ?? [];
    for (const o of organic) {
      const parts = [o.title, o.description].filter(Boolean).join("\n");
      pages.push({
        url: String(o.url ?? ""),
        title: o.title ?? null,
        markdown: parts,
      });
    }
  }
  return { ok: true, pages: pages.filter((p) => p.url), elapsedMs: r.elapsedMs, requestsUsed: pages.length };
}

