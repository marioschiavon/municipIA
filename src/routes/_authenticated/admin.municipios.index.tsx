import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, useMemo } from "react";
import { adminListMunicipios, adminListMunicipioIds, adminFetchFndeAtual } from "@/lib/admin.functions";
import { useProspectQueue, type QueueMunicipio } from "@/lib/use-prospect-queue";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, ChevronLeft, ChevronRight, Pencil, PlayCircle, StopCircle, AlertTriangle } from "lucide-react";

const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];
const PAGE_SIZE = 50;
const INTERVALO_MS = 30_000;
// SICONFI (Tesouro Nacional) limita a 1 requisição/segundo — folga de 300ms.
const INTERVALO_FNDE_MS = 1_300;

type FndeLogEntry = { ibge_id: number; nome: string; uf: string; status: "found" | "not_found" | "error"; detalhe?: string };

/** Rótulos em português para os status técnicos das filas. */
const STATUS_LABEL: Record<"found" | "partial" | "not_found" | "error", string> = {
  found: "OK",
  partial: "Parcial",
  not_found: "Não encontrado",
  error: "Erro",
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Cancelado", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Cancelado", "AbortError"));
    }, { once: true });
  });
}

export const Route = createFileRoute("/_authenticated/admin/municipios/")({
  component: AdminMunicipios,
});

function AdminMunicipios() {
  const listFn = useServerFn(adminListMunicipios);
  const listIdsFn = useServerFn(adminListMunicipioIds);
  const qc = useQueryClient();
  const [uf, setUf] = useState("all");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [revisao, setRevisao] = useState(false);
  const [page, setPage] = useState(0);

  const filters = useMemo(() => ({
    uf: uf === "all" ? undefined : uf,
    status: status === "all" ? undefined : status,
    q: q || undefined,
    revisao: revisao || undefined,
    page, pageSize: PAGE_SIZE,
  }), [uf, status, q, revisao, page]);

  const list = useQuery({
    queryKey: ["admin-municipios", filters],
    queryFn: () => listFn({ data: filters }),
  });

  const totalPages = Math.ceil((list.data?.total ?? 0) / PAGE_SIZE);

  // ===== Prospecção em massa, modo "completo" (fila com pausa de 30s entre municípios) =====
  // Fila em fases separadas (domínio/secretário/contato) fica na aba /admin/prospeccao.
  const queue = useProspectQueue(INTERVALO_MS);

  async function iniciarProspeccaoEmMassa() {
    queue.setLoadingIds(true);
    try {
      const { items } = await listIdsFn({
        data: { uf: filters.uf, status: filters.status, q: filters.q },
      });
      await queue.iniciar(items, "completo", "apify", () => {
        qc.invalidateQueries({ queryKey: ["admin-municipios"] });
      });
    } finally {
      queue.setLoadingIds(false);
    }
  }

  function cancelarProspeccaoEmMassa() {
    queue.cancelar();
  }

  // ===== Busca de FUNDEB em massa (fila com pausa curta — limite de 1 req/s do SICONFI) =====
  const fetchFndeFn = useServerFn(adminFetchFndeAtual);
  const [fndeRunning, setFndeRunning] = useState(false);
  const [fndeTotal, setFndeTotal] = useState(0);
  const [fndeDone, setFndeDone] = useState(0);
  const [fndeCurrent, setFndeCurrent] = useState<QueueMunicipio | null>(null);
  const [fndeLog, setFndeLog] = useState<FndeLogEntry[]>([]);
  const [fndeLoadingIds, setFndeLoadingIds] = useState(false);
  const fndeAbortRef = useRef<AbortController | null>(null);

  async function processarUmFnde(m: QueueMunicipio): Promise<FndeLogEntry> {
    try {
      const r = await fetchFndeFn({ data: { ibge_id: m.ibge_id } });
      if (!r.ok) return { ibge_id: m.ibge_id, nome: m.nome, uf: m.uf, status: "not_found" };
      return {
        ibge_id: m.ibge_id, nome: m.nome, uf: m.uf, status: "found",
        detalhe: `R$ ${r.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} (${r.ano}/${r.periodo})`,
      };
    } catch (e) {
      return { ibge_id: m.ibge_id, nome: m.nome, uf: m.uf, status: "error", detalhe: e instanceof Error ? e.message : "Falha" };
    }
  }

  async function iniciarBuscaFndeEmMassa() {
    setFndeLoadingIds(true);
    try {
      const { items } = await listIdsFn({
        data: { uf: filters.uf, status: filters.status, q: filters.q },
      });
      if (items.length === 0) return;
      const controller = new AbortController();
      fndeAbortRef.current = controller;
      setFndeTotal(items.length);
      setFndeDone(0);
      setFndeLog([]);
      setFndeRunning(true);
      try {
        for (let i = 0; i < items.length; i++) {
          if (controller.signal.aborted) break;
          const m = items[i];
          setFndeCurrent(m);
          const entry = await processarUmFnde(m);
          setFndeLog((prev) => [entry, ...prev].slice(0, 300));
          setFndeDone((d) => d + 1);
          if (i < items.length - 1) {
            await sleep(INTERVALO_FNDE_MS, controller.signal);
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) throw e;
      } finally {
        setFndeRunning(false);
        setFndeCurrent(null);
        fndeAbortRef.current = null;
        qc.invalidateQueries({ queryKey: ["admin-municipios"] });
      }
    } finally {
      setFndeLoadingIds(false);
    }
  }

  function cancelarBuscaFndeEmMassa() {
    fndeAbortRef.current?.abort();
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Municípios</h2>
        <p className="text-sm text-muted-foreground">Edite dados quantitativos, contatos da secretaria e matrículas por etapa.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-4">
        <form className="flex flex-1 gap-2 min-w-[280px]" onSubmit={(e) => { e.preventDefault(); setQ(qInput); setPage(0); }}>
          <Input placeholder="Nome do município..." value={qInput} onChange={(e) => setQInput(e.target.value)} />
          <Button type="submit" size="icon" variant="outline"><Search className="h-4 w-4" /></Button>
        </form>
        <Select value={uf} onValueChange={(v) => { setUf(v); setPage(0); }}>
          <SelectTrigger className="w-[110px]"><SelectValue placeholder="UF" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos UFs</SelectItem>
            {UFS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="sem_dados">Sem dados</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
            <SelectItem value="validado">Validado</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={revisao} onCheckedChange={(v) => { setRevisao(!!v); setPage(0); }} />
          <span className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Precisa revisão</span>
        </label>
        <div className="ml-auto text-sm text-muted-foreground">
          {list.data ? `${list.data.total.toLocaleString("pt-BR")} resultado(s)` : "..."}
        </div>
        {queue.running ? (
          <Button size="sm" variant="destructive" onClick={cancelarProspeccaoEmMassa}>
            <StopCircle className="mr-1.5 h-4 w-4" /> Cancelar
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={iniciarProspeccaoEmMassa} disabled={queue.loadingIds || fndeRunning}>
            {queue.loadingIds ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-1.5 h-4 w-4" />}
            Prospectar todos os filtrados
          </Button>
        )}
        {fndeRunning ? (
          <Button size="sm" variant="destructive" onClick={cancelarBuscaFndeEmMassa}>
            <StopCircle className="mr-1.5 h-4 w-4" /> Cancelar
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={iniciarBuscaFndeEmMassa} disabled={fndeLoadingIds || queue.running}>
            {fndeLoadingIds ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-1.5 h-4 w-4" />}
            Buscar FUNDEB de todos os filtrados
          </Button>
        )}
      </div>

      {(queue.running || queue.log.length > 0) && (
        <div className="rounded-lg border border-border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">
              Prospecção em massa {queue.running ? "— em andamento" : "— finalizada"}
            </span>
            <span className="text-muted-foreground">{queue.done}/{queue.total} processado(s)</span>
          </div>
          <Progress value={queue.total > 0 ? (queue.done / queue.total) * 100 : 0} />
          {queue.running && (
            <p className="text-xs text-muted-foreground">
              {queue.waiting
                ? `Aguardando 30s antes do próximo município...`
                : queue.current
                  ? `Processando: ${queue.current.nome}/${queue.current.uf}...`
                  : "Iniciando..."}
            </p>
          )}
          {queue.log.length > 0 && (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {queue.log.map((e, i) => (
                <div key={`${e.ibge_id}-${i}`} className="rounded border border-border px-2 py-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span>{e.nome}/{e.uf}</span>
                    <span className="flex items-center gap-2">
                      {e.detalhe && <span className="text-muted-foreground">{e.detalhe}</span>}
                      <Badge variant={e.status === "found" ? "default" : e.status === "partial" ? "secondary" : e.status === "error" ? "destructive" : "outline"}>
                        {STATUS_LABEL[e.status]}
                      </Badge>
                    </span>
                  </div>
                  {e.status !== "found" && e.motivo && (
                    <p className="mt-0.5 text-[11px] leading-snug text-amber-700" title={e.motivo}>Motivo: {e.motivo}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(fndeRunning || fndeLog.length > 0) && (
        <div className="rounded-lg border border-border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">
              Busca de FUNDEB em massa {fndeRunning ? "— em andamento" : "— finalizada"}
            </span>
            <span className="text-muted-foreground">{fndeDone}/{fndeTotal} processado(s)</span>
          </div>
          <Progress value={fndeTotal > 0 ? (fndeDone / fndeTotal) * 100 : 0} />
          {fndeRunning && (
            <p className="text-xs text-muted-foreground">
              {fndeCurrent ? `Processando: ${fndeCurrent.nome}/${fndeCurrent.uf}...` : "Iniciando..."}
            </p>
          )}
          {fndeLog.length > 0 && (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {fndeLog.map((e, i) => (
                <div key={`${e.ibge_id}-${i}`} className="flex items-center justify-between rounded border border-border px-2 py-1 text-xs">
                  <span>{e.nome}/{e.uf}</span>
                  <span className="flex items-center gap-2">
                    {e.detalhe && <span className="text-muted-foreground">{e.detalhe}</span>}
                    <Badge variant={e.status === "found" ? "default" : e.status === "error" ? "destructive" : "outline"}>
                      {STATUS_LABEL[e.status]}
                    </Badge>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Município</TableHead>
              <TableHead>UF</TableHead>
              <TableHead className="text-right">População</TableHead>
              <TableHead className="text-right">Matrículas</TableHead>
              <TableHead>Secretário(a)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead></TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow><TableCell colSpan={9} className="text-center py-8"><Loader2 className="inline h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
            )}
            {list.data?.items.map((m) => (
              <TableRow key={m.ibge_id}>
                <TableCell className="font-medium">{m.nome}</TableCell>
                <TableCell>{m.uf}</TableCell>
                <TableCell className="text-right tabular-nums">{m.populacao.toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-right tabular-nums">{m.matriculas_total.toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-sm text-slate-600">{m.secretario ?? <span className="text-muted-foreground italic">—</span>}</TableCell>
                <TableCell>
                  <Badge variant={m.status === "validado" ? "default" : m.status === "pendente" ? "secondary" : "outline"}>
                    {m.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{m.score}</TableCell>
                <TableCell>
                  {m.revisao_necessaria && (
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                      <AlertTriangle className="mr-1 h-3 w-3" /> Revisar
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Link to="/admin/municipios/$ibgeId" params={{ ibgeId: String(m.ibge_id) }}
                    className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-accent">
                    <Pencil className="h-3 w-3" /> Editar
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Página {page + 1} de {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
