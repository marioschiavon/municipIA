import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Upload, ArrowLeft, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { adminSyncPopulacao, adminRecalcularScores } from "@/lib/admin.functions";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/import")({
  component: AdminImportPage,
  head: () => ({
    meta: [
      { title: "Importar dados - MunicipIA Admin" },
      { name: "description", content: "Importe dados oficiais do INEP e FNDE para o catálogo municipal." },
    ],
  }),
});

function AdminImportPage() {
  const [type, setType] = useState<"inep_escolas" | "inep_matriculas" | "fnde">("inep_escolas");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<{ ok: boolean; message: string; data?: unknown } | null>(null);
  const [syncPopLoading, setSyncPopLoading] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const syncPopFn = useServerFn(adminSyncPopulacao);
  const recalcFn = useServerFn(adminRecalcularScores);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setLogs([]);
    setResult(null);
    try {
      const form = new FormData();
      form.append("type", type);
      form.append("file", file);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão não encontrada. Faça login novamente.");
      const abort = new AbortController();
      abortRef.current = abort;
      const res = await fetch("/api/admin/import", {
        method: "POST",
        body: form,
        signal: abort.signal,
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Resposta vazia");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            setLogs((prev) => [...prev, `[${event.type.toUpperCase()}] ${event.message}`]);
            if (event.type === "done" || event.type === "error") {
              setResult({ ok: event.type === "done", message: event.message, data: event.data });
            }
          } catch {
            setLogs((prev) => [...prev, line]);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ ok: false, message: msg });
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  async function syncPopulacao() {
    setSyncPopLoading(true);
    setLogs((prev) => [...prev, "[POPULACAO] Sincronizando população via IBGE..."]);
    try {
      const r = await syncPopFn({ data: undefined });
      setLogs((prev) => [...prev, `[POPULACAO] OK: ${r.total.toLocaleString("pt-BR")} municípios atualizados (ano ${r.ano}).`]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [...prev, `[POPULACAO] ERRO: ${msg}`]);
    } finally {
      setSyncPopLoading(false);
    }
  }

  async function recalc() {
    setRecalcLoading(true);
    setLogs((prev) => [...prev, "[SCORE] Recalculando scores de todos os municípios..."]);
    try {
      const r = await recalcFn({ data: undefined });
      setLogs((prev) => [...prev, `[SCORE] OK: ${r.total.toLocaleString("pt-BR")} scores atualizados.`, JSON.stringify(r.faixas)]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [...prev, `[SCORE] ERRO: ${msg}`]);
    } finally {
      setRecalcLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/admin" className="hover:underline flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Admin
        </Link>
        <span>/</span>
        <span>Importar dados</span>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Importar dados oficiais</h1>
      <p className="text-muted-foreground">
        Utilize arquivos baixados dos portais oficiais do INEP e FNDE para alimentar o catálogo.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sincronizar população (IBGE)</CardTitle>
            <CardDescription>Atualiza estimativas populacionais de todos os municípios via API oficial.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={syncPopulacao} disabled={syncPopLoading} className="w-full">
              {syncPopLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
              Sincronizar população
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recalcular scores</CardTitle>
            <CardDescription>Reprocessa o score de todos os municípios após importações.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={recalc} disabled={recalcLoading} variant="outline" className="w-full">
              {recalcLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
              Recalcular scores
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload de arquivo</CardTitle>
          <CardDescription>Selecione o tipo de importação e o arquivo CSV/XLSX.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <RadioGroup value={type} onValueChange={(v) => setType(v as typeof type)} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="inep_matriculas" id="inep_matriculas" className="sr-only" />
                <Label htmlFor="inep_matriculas" className="cursor-pointer space-y-2 block">
                  <div className="font-semibold">INEP - Matrículas</div>
                  <div className="text-xs text-muted-foreground">
                    Microdados do Censo Escolar (arquivo <code>matricula_*.CSV</code>) ou versão resumida por etapa (<code>ibge_id, etapa, matriculas</code>).
                  </div>
                  <a
                    href="https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/censo-escolar"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-primary hover:underline inline-block"
                  >
                    Baixar Microdados do Censo Escolar (INEP) →
                  </a>
                </Label>
              </div>
              <div className="border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="inep_escolas" id="inep_escolas" className="sr-only" />
                <Label htmlFor="inep_escolas" className="cursor-pointer space-y-2 block">
                  <div className="font-semibold">INEP - Escolas</div>
                  <div className="text-xs text-muted-foreground">
                    Catálogo de escolas ativas por município (<code>escolas.CSV</code> do Censo ou resumo <code>ibge_id, escolas</code>).
                  </div>
                  <a
                    href="https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/inep-data/catalogo-de-escolas"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-primary hover:underline inline-block"
                  >
                    Catálogo de Escolas (INEP) →
                  </a>
                </Label>
              </div>
              <div className="border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="fnde" id="fnde" className="sr-only" />
                <Label htmlFor="fnde" className="cursor-pointer space-y-2 block">
                  <div className="font-semibold">FNDE - Liberações</div>
                  <div className="text-xs text-muted-foreground">
                    Planilha de liberações financeiras por município. Aceita colunas mensais (jan..dez) ou uma coluna <code>Total/Valor Liberado</code>.
                  </div>
                  <a
                    href="https://www.fnde.gov.br/sigefweb/index.php/liberacoes"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-primary hover:underline inline-block"
                  >
                    Consulta de Liberações (SIGEF/FNDE) →
                  </a>
                </Label>
              </div>
            </RadioGroup>

            <div className="space-y-2">
              <Label htmlFor="file">Arquivo</Label>
              <input
                id="file"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
              />
              {file && (
                <p className="text-xs text-muted-foreground">
                  {file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={loading || !file} className="flex-1">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                {loading ? "Importando..." : "Iniciar importação"}
              </Button>
              {loading && (
                <Button type="button" variant="destructive" onClick={cancel}>
                  Cancelar
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Alert variant={result.ok ? "default" : "destructive"}>
          {result.ok ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}

      {logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Log de execução</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted rounded-lg p-4 h-64 overflow-y-auto font-mono text-xs space-y-1">
              {logs.map((l, i) => (
                <div key={i} className="break-words">
                  {l}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
