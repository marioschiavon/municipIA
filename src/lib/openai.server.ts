// Helper leve para chamadas diretas à OpenAI API usando o token do usuário.
// Não depende do Lovable AI Gateway — usa OPENAI_API_KEY configurada no projeto.

export type OpenAIChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null };

export type OpenAIChatOptions = {
  model?: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "json_object" } | { type: "json_schema"; json_schema: unknown };
  timeoutMs?: number;
};

export type OpenAIChatResult = {
  ok: true;
  content: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  elapsedMs: number;
} | {
  ok: false;
  reason: string;
  elapsedMs: number;
};

export function getOpenAIKey(): string | null {
  return process.env.OPENAI_API_KEY ?? null;
}

export async function chatOpenAI(opts: OpenAIChatOptions): Promise<OpenAIChatResult> {
  const started = Date.now();
  const key = getOpenAIKey();
  if (!key) {
    return { ok: false, reason: "OPENAI_API_KEY não configurada", elapsedMs: 0 };
  }

  const model = opts.model ?? "gpt-4o-mini";
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 1024,
  };
  if (opts.responseFormat) {
    body.response_format = opts.responseFormat;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: `HTTP ${res.status}: ${text.slice(0, 400)}`, elapsedMs };
    }
    const data = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    return { ok: true, content, model: data.model ?? model, usage: data.usage, elapsedMs };
  } catch (e) {
    const elapsedMs = Date.now() - started;
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return { ok: false, reason: aborted ? `timeout ${opts.timeoutMs ?? 60_000}ms` : String(e), elapsedMs };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Busca web via OpenAI (Responses API + ferramenta web_search).
// Usada como motor de busca alternativo quando o Apify falha por cota/token.
// ---------------------------------------------------------------------------

export type WebSearchHit = { url: string; title: string; snippet: string };

export type OpenAIWebSearchResult =
  | { ok: true; hits: WebSearchHit[]; elapsedMs: number }
  | { ok: false; reason: string; elapsedMs: number };

export async function openaiWebSearch(
  query: string,
  opts: { limit?: number; timeoutMs?: number } = {},
): Promise<OpenAIWebSearchResult> {
  const started = Date.now();
  const key = getOpenAIKey();
  if (!key) return { ok: false, reason: "OPENAI_API_KEY não configurada", elapsedMs: 0 };

  const limit = opts.limit ?? 8;
  const model = process.env.OPENAI_SEARCH_MODEL ?? "gpt-4o-mini";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
        input: [
          {
            role: "system",
            content:
              "Você é um motor de busca. Pesquise na web e devolve APENAS um JSON " +
              `{"results":[{"url":"...","title":"...","snippet":"..."}]} com até ${limit} resultados ` +
              "reais e relevantes (priorize domínios .gov.br). O snippet deve conter o trecho útil " +
              "encontrado (nomes, cargos, e-mails, telefones), não uma descrição genérica. Sem markdown.",
          },
          { role: "user", content: query },
        ],
      }),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: `HTTP ${res.status}: ${text.slice(0, 300)}`, elapsedMs };
    }
    const data = (await res.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    const text =
      data.output_text ??
      (data.output ?? [])
        .flatMap((o) => o.content ?? [])
        .filter((c) => typeof c.text === "string")
        .map((c) => c.text as string)
        .join("\n");
    const raw = text?.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) return { ok: false, reason: "resposta sem JSON", elapsedMs };
    let parsed: { results?: Array<Partial<WebSearchHit>> };
    try {
      parsed = JSON.parse(raw) as { results?: Array<Partial<WebSearchHit>> };
    } catch {
      return { ok: false, reason: "JSON inválido na resposta", elapsedMs };
    }
    const hits: WebSearchHit[] = (parsed.results ?? [])
      .filter((r): r is WebSearchHit => typeof r?.url === "string" && /^https?:\/\//.test(r.url))
      .slice(0, limit)
      .map((r) => ({ url: r.url, title: r.title ?? "", snippet: r.snippet ?? "" }));
    return { ok: true, hits, elapsedMs };
  } catch (e) {
    const elapsedMs = Date.now() - started;
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return { ok: false, reason: aborted ? `timeout ${opts.timeoutMs ?? 60_000}ms` : String(e), elapsedMs };
  } finally {
    clearTimeout(timer);
  }
}
