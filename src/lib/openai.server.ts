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
