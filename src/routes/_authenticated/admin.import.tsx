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
  const [type, setType] = useState<"fundeb_matriculas" | "inep_matriculas" | "inep_escolas" | "fnde">("fundeb_matriculas");
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
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão não encontrada. Faça login novamente.");
      const abort = new AbortController();
      abortRef.current = abort;
      // Envia o arquivo como corpo bruto da requisição (sem FormData) para que o
      // servidor possa consumi-lo em streaming, sem bufferizar o arquivo inteiro
      // em memória (arquivos do Censo Escolar podem ter centenas de MB).
      const res = await fetch("/api/admin/import", {
        method: "POST",
        body: file,
        signal: abort.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Import-Type": type,
          "X-Import-Filename": encodeURIComponent(file.name),
        },
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
            const ts = new Date().toLocaleTimeString("pt-BR", { hour12: false });
            const dataStr = event.data !== undefined ? ` — ${JSON.stringify(event.data)}` : "";
            setLogs((prev) => [...prev, `${ts} [${event.type.toUpperCase()}] ${event.message}${dataStr}`]);
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
            <RadioGroup value={type} onValueChange={(v) => setType(v as typeof type)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="fundeb_matriculas" id="fundeb_matriculas" className="sr-only" />
                <Label htmlFor="fundeb_matriculas" className="cursor-pointer space-y-2 block">
                  <div className="font-semibold">1. FUNDEB — Matrículas por município (recomendado)</div>
                  <div className="text-xs text-muted-foreground">
                    Arquivo <code>FUNDEB_Matriculas.txt</code> (aceita <code>.gz</code>), com colunas <code>sg_uf</code>, <code>no_municipio_ge</code>, <code>esfera_administrativa</code> e <code>qtd_matricula</code>. Só ~35 MB e já vem agregado: filtra <strong>GOVERNO MUNICIPAL</strong>, cruza por UF + nome e distribui por etapa (creche, pré, fund AI/AF, médio, EJA, especial, profissionalizante). Não traz contagem de escolas.
                  </div>
                </Label>
              </div>
              <div className="border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="inep_matriculas" id="inep_matriculas" className="sr-only" />
                <Label htmlFor="inep_matriculas" className="cursor-pointer space-y-2 block">
                  <div className="font-semibold">2. INEP — Matrículas</div>
                  <div className="text-xs text-muted-foreground">
                    Arquivo <code>Tabela_Matricula_YYYY.csv</code> do Censo Escolar. Se vier com <code>CO_MUNICIPIO</code>, agrega direto; se vier só com <code>CO_ENTIDADE</code>, cruza com o arquivo de Escolas já importado. Popula matrículas por etapa e a contagem de escolas municipais ativas.
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
                  <div className="font-semibold">3. INEP — Escolas (opcional)</div>
                  <div className="text-xs text-muted-foreground">
                    Arquivo <code>Tabela_Escola_YYYY.csv</code>. Necessário quando o arquivo de Matrículas não possui <code>CO_MUNICIPIO</code>/<code>TP_DEPENDENCIA</code>. Ele cria o mapa <code>CO_ENTIDADE → município/rede/situação</code> usado no cruzamento.
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
                <RadioGroupItem value="fnde" id="fnde" className="sr-only" />
                <Label htmlFor="fnde" className="cursor-pointer space-y-2 block">
                  <div className="font-semibold">3. FNDE — FUNDEB</div>
                  <div className="text-xs text-muted-foreground">
                    Planilha de liberações do <strong>FUNDEB</strong> por município (principal repasse à educação básica). Se o arquivo tiver coluna <code>Programa</code>, apenas linhas do FUNDEB são consideradas. Aceita colunas mensais (jan..dez) ou <code>Total/Valor Liberado</code>.
                  </div>
                  <a
                    href="https://www.fnde.gov.br/pls/simad/internet_fnde.LIBERACOES_01_PC"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-primary hover:underline inline-block"
                  >
                    Consulta de Liberações FUNDEB (FNDE) →
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">Log detalhado de execução</CardTitle>
            <CardDescription className="text-xs">
              Cada evento do servidor (parsing, mapeamento de colunas, lotes, contagens) aparece aqui em tempo real.
            </CardDescription>
          </div>
          {logs.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => setLogs([])}>
              Limpar
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="bg-muted rounded-lg p-4 h-96 overflow-y-auto font-mono text-xs space-y-1">
            {logs.length === 0 ? (
              <div className="text-muted-foreground">Aguardando execução...</div>
            ) : (
              logs.map((l, i) => (
                <div key={i} className="break-words whitespace-pre-wrap">
                  {l}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
