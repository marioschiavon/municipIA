import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/debug/apify")({
  head: () => ({
    meta: [
      { title: "Debug Apify — MunicipIA" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DebugApifyPage,
});

type PageResult = {
  url: string;
  title?: string | null;
  bytes: number;
  emails: string[];
  telefones: string[];
  preview: string;
};

type OkResp = {
  ok: true;
  elapsedMs: number;
  pagesCrawled: number;
  emails: string[];
  telefones: string[];
  pages: PageResult[];
};
type ErrResp = { ok: false; reason: string; elapsedMs: number };

function DebugApifyPage() {
  const [url, setUrl] = useState("");
  const [maxRequests, setMaxRequests] = useState(8);
  const [maxDepth, setMaxDepth] = useState(2);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<OkResp | ErrResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setErr(null);
    setResp(null);
    try {
      const r = await fetch("/api/debug/apify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, maxRequests, maxDepth }),
      });
      const data = (await r.json()) as OkResp | ErrResp;
      setResp(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/debug">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" /> Debug
            </Button>
          </Link>
          <h1 className="text-2xl font-semibold">POC Apify — Website Content Crawler</h1>
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-3 bg-white">
        <label className="block text-sm font-medium">URL inicial (ex.: site oficial da prefeitura)</label>
        <input
          className="w-full border rounded px-3 py-2 text-sm"
          placeholder="https://www.maringa.pr.gov.br"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            Máx. requests
            <input
              type="number"
              min={1}
              max={20}
              className="w-full border rounded px-3 py-2 text-sm mt-1"
              value={maxRequests}
              onChange={(e) => setMaxRequests(Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            Profundidade
            <input
              type="number"
              min={0}
              max={3}
              className="w-full border rounded px-3 py-2 text-sm mt-1"
              value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
            />
          </label>
        </div>
        <Button onClick={run} disabled={!url || loading}>
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Rodando...</> : "Testar Apify"}
        </Button>
        <p className="text-xs text-slate-500">
          Segue links internos filtrando por rotas de contato / secretarias / educação. Nada aqui altera o pipeline principal.
        </p>
      </div>

      {err && <div className="rounded border border-red-200 bg-red-50 text-red-700 p-3 text-sm">{err}</div>}

      {resp && !resp.ok && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="font-medium text-amber-900">Falhou</div>
          <div className="text-amber-800">{resp.reason}</div>
          <div className="text-xs text-amber-700 mt-1">{resp.elapsedMs} ms</div>
        </div>
      )}

      {resp && resp.ok && (
        <div className="space-y-4">
          <div className="rounded-lg border p-4 bg-emerald-50 border-emerald-200">
            <div className="text-sm text-emerald-900">
              <b>{resp.pagesCrawled}</b> páginas em <b>{(resp.elapsedMs / 1000).toFixed(1)}s</b>
            </div>
            <div className="mt-2 text-sm">
              <div><b>E-mails agregados:</b> {resp.emails.length ? resp.emails.join(", ") : "—"}</div>
              <div><b>Telefones agregados:</b> {resp.telefones.length ? resp.telefones.join(", ") : "—"}</div>
            </div>
          </div>

          {resp.pages.map((p, i) => (
            <div key={i} className="rounded-lg border p-4 bg-white space-y-2">
              <div className="text-xs text-slate-500 break-all">{p.url}</div>
              {p.title && <div className="font-medium">{p.title}</div>}
              <div className="text-xs text-slate-600">
                {p.bytes.toLocaleString()} chars · {p.emails.length} email(s) · {p.telefones.length} telefone(s)
              </div>
              {p.emails.length > 0 && (
                <div className="text-sm"><b>Emails:</b> {p.emails.join(", ")}</div>
              )}
              {p.telefones.length > 0 && (
                <div className="text-sm"><b>Telefones:</b> {p.telefones.join(", ")}</div>
              )}
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer">Preview markdown</summary>
                <pre className="whitespace-pre-wrap mt-2 bg-slate-50 p-2 rounded">{p.preview}</pre>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
