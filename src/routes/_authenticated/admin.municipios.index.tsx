import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, useMemo } from "react";
import { adminListMunicipios, adminListMunicipioIds } from "@/lib/admin.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, ChevronLeft, ChevronRight, Pencil, PlayCircle, StopCircle } from "lucide-react";

const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];
const PAGE_SIZE = 50;
const INTERVALO_MS = 30_000;

type QueueMunicipio = { ibge_id: number; nome: string; uf: string };
type QueueLogEntry = { ibge_id: number; nome: string; uf: string; status: "found" | "partial" | "not_found" | "error"; detalhe?: string };

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
  const [page, setPage] = useState(0);

  const filters = useMemo(() => ({
    uf: uf === "all" ? undefined : uf,
    status: status === "all" ? undefined : status,
    q: q || undefined,
    page, pageSize: PAGE_SIZE,
  }), [uf, status, q, page]);

  const list = useQuery({
    queryKey: ["admin-municipios", filters],
    queryFn: () => listFn({ data: filters }),
  });

  const totalPages = Math.ceil((list.data?.total ?? 0) / PAGE_SIZE);

  // ===== Prospecção em massa (fila com pausa de 30s entre municípios) =====
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueDone, setQueueDone] = useState(0);
  const [queueCurrent, setQueueCurrent] = useState<QueueMunicipio | null>(null);
  const [queueWaiting, setQueueWaiting] = useState(false);
  const [queueLog, setQueueLog] = useState<QueueLogEntry[]>([]);
  const [queueLoadingIds, setQueueLoadingIds] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function processarUm(m: QueueMunicipio, signal: AbortSignal): Promise<QueueLogEntry> {
    try {
      const res = await fetch("/api/prospect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ municipio: m.nome, uf: m.uf, ibgeId: m.ibge_id }),
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalStatus: QueueLogEntry["status"] = "not_found";
      let contatos = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const s = line.trim();
          if (!s) continue;
          try {
            const evt = JSON.parse(s);
            if (evt.kind === "final") {
              finalStatus = evt.result?.status ?? "not_found";
              contatos = (evt.result?.emails?.length ?? 0) + (evt.result?.telefones?.length ?? 0);
            }
          } catch { /* noop */ }
        }
      }
      return { ibge_id: m.ibge_id, nome: m.nome, uf: m.uf, status: finalStatus, detalhe: `${contatos} contato(s)` };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      return { ibge_id: m.ibge_id, nome: m.nome, uf: m.uf, status: "error", detalhe: e instanceof Error ? e.message : "Falha" };
    }
  }

  async function iniciarProspeccaoEmMassa() {
    setQueueLoadingIds(true);
    try {
      const { items } = await listIdsFn({
        data: { uf: filters.uf, status: filters.status, q: filters.q },
      });
      if (items.length === 0) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setQueueTotal(items.length);
      setQueueDone(0);
      setQueueLog([]);
      setQueueRunning(true);
      try {
        for (let i = 0; i < items.length; i++) {
          if (controller.signal.aborted) break;
          const m = items[i];
          setQueueCurrent(m);
          const entry = await processarUm(m, controller.signal);
          setQueueLog((prev) => [entry, ...prev].slice(0, 300));
          setQueueDone((d) => d + 1);
          if (i < items.length - 1) {
            setQueueWaiting(true);
            await sleep(INTERVALO_MS, controller.signal);
            setQueueWaiting(false);
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) throw e;
      } finally {
        setQueueRunning(false);
        setQueueWaiting(false);
        setQueueCurrent(null);
        abortRef.current = null;
        qc.invalidateQueries({ queryKey: ["admin-municipios"] });
      }
    } finally {
      setQueueLoadingIds(false);
    }
  }

  function cancelarProspeccaoEmMassa() {
    abortRef.current?.abort();
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
        <div className="ml-auto text-sm text-muted-foreground">
          {list.data ? `${list.data.total.toLocaleString("pt-BR")} resultado(s)` : "..."}
        </div>
        {queueRunning ? (
          <Button size="sm" variant="destructive" onClick={cancelarProspeccaoEmMassa}>
            <StopCircle className="mr-1.5 h-4 w-4" /> Cancelar
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={iniciarProspeccaoEmMassa} disabled={queueLoadingIds}>
            {queueLoadingIds ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-1.5 h-4 w-4" />}
            Prospectar todos os filtrados
          </Button>
        )}
      </div>

      {(queueRunning || queueLog.length > 0) && (
        <div className="rounded-lg border border-border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">
              Prospecção em massa {queueRunning ? "— em andamento" : "— finalizada"}
            </span>
            <span className="text-muted-foreground">{queueDone}/{queueTotal} processado(s)</span>
          </div>
          <Progress value={queueTotal > 0 ? (queueDone / queueTotal) * 100 : 0} />
          {queueRunning && (
            <p className="text-xs text-muted-foreground">
              {queueWaiting
                ? `Aguardando 30s antes do próximo município...`
                : queueCurrent
                  ? `Processando: ${queueCurrent.nome}/${queueCurrent.uf}...`
                  : "Iniciando..."}
            </p>
          )}
          {queueLog.length > 0 && (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {queueLog.map((e, i) => (
                <div key={`${e.ibge_id}-${i}`} className="flex items-center justify-between rounded border border-border px-2 py-1 text-xs">
                  <span>{e.nome}/{e.uf}</span>
                  <span className="flex items-center gap-2">
                    {e.detalhe && <span className="text-muted-foreground">{e.detalhe}</span>}
                    <Badge variant={e.status === "found" ? "default" : e.status === "partial" ? "secondary" : e.status === "error" ? "destructive" : "outline"}>
                      {e.status}
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow><TableCell colSpan={8} className="text-center py-8"><Loader2 className="inline h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
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
