import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/debug/openai")({
  head: () => ({
    meta: [{ title: "Debug OpenAI — MunicipIA" }, { name: "robots", content: "noindex" }],
  }),
  component: DebugOpenAIPage,
});

type Resp =
  | { ok: true; content: string; model: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }; elapsedMs: number }
  | { ok: false; reason: string; elapsedMs: number };

function DebugOpenAIPage() {
  const [prompt, setPrompt] = useState("Quem é o secretário de educação de Maringá/PR atual?");
  const [model, setModel] = useState("gpt-4o-mini");
  const [useJson, setUseJson] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setErr(null);
    setResp(null);
    try {
      const r = await fetch("/api/debug/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model, useJson }),
      });
      const data = (await r.json()) as Resp;
      setResp(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/debug">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" /> Debug
          </Button>
        </Link>
        <h1 className="text-2xl font-semibold">POC OpenAI</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Testa a conexão direta com a OpenAI usando o token configurado no projeto (<code>OPENAI_API_KEY</code>).
        Não passa pelo Lovable AI Gateway.
      </p>

      <div className="rounded-lg border p-4 space-y-3 bg-white">
        <label className="block text-sm font-medium">Prompt</label>
        <textarea
          className="w-full border rounded px-3 py-2 text-sm min-h-[80px]"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            Modelo
            <input
              className="w-full border rounded px-3 py-2 text-sm mt-1"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm mt-6">
            <input type="checkbox" checked={useJson} onChange={(e) => setUseJson(e.target.checked)} />
            Forçar resposta JSON
          </label>
        </div>

        <Button onClick={run} disabled={loading || !prompt.trim()}>
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Chamando...</> : "Testar OpenAI"}
        </Button>
      </div>

      {err && (
        <div className="rounded border border-red-200 bg-red-50 text-red-700 p-3 text-sm">
          {err}
        </div>
      )}

      {resp && !resp.ok && (
        <div className="rounded border border-red-200 bg-red-50 text-red-700 p-3 text-sm">
          <div className="font-medium">Falha</div>
          <div className="break-all">{resp.reason}</div>
          <div className="text-xs mt-1 opacity-70">{resp.elapsedMs} ms</div>
        </div>
      )}

      {resp && resp.ok && (
        <div className="rounded-lg border p-4 bg-emerald-50 border-emerald-200 space-y-3">
          <div className="text-sm text-emerald-900">
            <b>{resp.model}</b> · <b>{resp.elapsedMs} ms</b>
            {resp.usage && (
              <span className="ml-2 text-xs opacity-80">
                tokens: {resp.usage.prompt_tokens ?? 0} prompt / {resp.usage.completion_tokens ?? 0} completion
              </span>
            )}
          </div>
          <div className="rounded bg-white border p-3 text-sm whitespace-pre-wrap">
            {resp.content}
          </div>
        </div>
      )}
    </div>
  );
}
