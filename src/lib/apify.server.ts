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
  opts: { timeoutMs?: number; maxRequests?: number; maxDepth?: number } = {},
): Promise<ApifyCrawlResult> {
  const started = Date.now();
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, reason: "APIFY_TOKEN não configurado", elapsedMs: 0 };

  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxRequests = opts.maxRequests ?? 8;
  const maxDepth = opts.maxDepth ?? 2;

  const input = {
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
    includeUrlGlobs: [
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
    ],
  };

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
