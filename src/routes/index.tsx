import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import { Search, Loader2, Database, TrendingUp, MapPin, AlertTriangle, Download, Sparkles, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { APP_VERSION } from "@/lib/version";
import { listMunicipios, getCatalogStats, exportMunicipios, EXPORT_MAX } from "@/lib/catalog.functions";
import { exportMunicipiosCSV, exportMunicipiosXLSX } from "@/lib/export";
import { useProspectStream } from "@/lib/use-prospect-stream";
import { resumirResultado } from "@/lib/prospect-completeness";
import type { ProspectResult } from "@/lib/prospect.types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MunicipIA — Catálogo Nacional de Prospecção Educacional" },
      {
        name: "description",
        content:
          "Catálogo de todos os 5.570 municípios brasileiros com score de prospecção, dados da Secretaria de Educação, indicadores IBGE, INEP e FNDE.",
      },
      { property: "og:title", content: "MunicipIA — Catálogo Nacional" },
      { property: "og:description", content: "5.570 municípios com score de prospecção para Secretarias de Educação." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CatalogPage,
});

const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

const PAGE_SIZE = 50;

function CatalogPage() {
  const navigate = useNavigate();
  const listFn = useServerFn(listMunicipios);
  const statsFn = useServerFn(getCatalogStats);
  const exportFn = useServerFn(exportMunicipios);
  const stream = useProspectStream();

  const [uf, setUf] = useState<string>("all");
  const [faixa, setFaixa] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState<string>("");
  const [qInput, setQInput] = useState<string>("");
  const [page, setPage] = useState(0);
  const [orderBy, setOrderBy] = useState<"score" | "populacao" | "nome" | "matriculas_total">("score");
  const [prospectOpen, setProspectOpen] = useState(false);
  const [prospectItem, setProspectItem] = useState<{ ibge_id: number; nome: string; uf: string } | null>(null);
  const [prospectDone, setProspectDone] = useState<ProspectResult | null>(null);


  const [exportOpen, setExportOpen] = useState(false);
  const [exportQtd, setExportQtd] = useState(500);
  const [exportFaixa, setExportFaixa] = useState<string>("all");
  const [exportScoreMin, setExportScoreMin] = useState<string>("");
  const [exportScoreMax, setExportScoreMax] = useState<string>("");
  const [exportContato, setExportContato] = useState<"secretario" | "equipe" | "ambos">("ambos");
  const [exportCount, setExportCount] = useState<number | null>(null);

  const exportMut = useMutation({
    mutationFn: async (formato: "csv" | "xlsx") => {
      const { items } = await exportFn({
        data: {
          uf: uf === "all" ? undefined : uf,
          status: status === "all" ? undefined : (status as any),
          q: q || undefined,
          faixa: exportFaixa === "all" ? undefined : (exportFaixa as any),
          scoreMin: exportScoreMin ? Number(exportScoreMin) : undefined,
          scoreMax: exportScoreMax ? Number(exportScoreMax) : undefined,
          contato: exportContato,
          quantidade: exportQtd,
          orderBy,
          orderDir: "desc",
        },
      });
      if (formato === "csv") exportMunicipiosCSV(items);
      else exportMunicipiosXLSX(items);
      return items.length;
    },
    onSuccess: (count) => setExportCount(count),
  });

  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: () => statsFn(),
  });

  const filters = useMemo(() => ({
    uf: uf === "all" ? undefined : uf,
    faixa: faixa === "all" ? undefined : (faixa as any),
    status: status === "all" ? undefined : (status as any),
    q: q || undefined,
    page,
    pageSize: PAGE_SIZE,
    orderBy,
    orderDir: "desc" as const,
  }), [uf, faixa, status, q, page, orderBy]);

  const list = useQuery({
    queryKey: ["municipios", filters],
    queryFn: () => listFn({ data: filters }),
  });


  const empty = (stats.data?.total ?? 0) === 0 && !stats.isLoading;
  const matriculasCoberturaBaixa =
    (stats.data?.total ?? 0) > 0 && (stats.data?.comMatriculas ?? 0) / (stats.data?.total ?? 1) < 0.5;
  const totalPages = Math.ceil((list.data?.total ?? 0) / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-slate-50 text-foreground">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2">
              <Database className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight">MunicipIA</h1>
                <Link
                  to="/debug"
                  className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 hover:bg-amber-100"
                >
                  {APP_VERSION}
                </Link>
              </div>
              <p className="text-xs text-muted-foreground">Catálogo nacional de prospecção educacional</p>
            </div>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <StatChip label="Municípios" value={stats.data?.total ?? 0} />
            <StatChip label="Score alto" value={stats.data?.alto ?? 0} accent="emerald" />
            <StatChip label="Validados" value={stats.data?.validado ?? 0} accent="blue" />
            <Link to="/admin" className="ml-2 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent">
              Admin
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        {empty && (
          <div className="mb-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
            <h2 className="text-lg font-semibold text-slate-900">Catálogo vazio</h2>
            <p className="mt-2 text-sm text-slate-600">
              Nenhum município cadastrado ainda. Acesse o painel administrativo para sincronizar a lista oficial do IBGE
              e começar a inserir dados reais.
            </p>
            <Link to="/admin" className="mt-4 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Ir para o painel Admin
            </Link>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-4">
          <div className="flex-1 min-w-[220px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Buscar município</label>
            <form
              onSubmit={(e) => { e.preventDefault(); setPage(0); setQ(qInput); }}
              className="flex gap-2"
            >
              <Input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Ex: Maringá, São Paulo..."
                className="h-9"
              />
              <Button type="submit" size="sm" variant="outline">
                <Search className="h-4 w-4" />
              </Button>
            </form>
          </div>
          <FilterSelect label="UF" value={uf} onChange={(v) => { setUf(v); setPage(0); }}
            options={[{ v: "all", l: "Todas" }, ...UFS.map((u) => ({ v: u, l: u }))]} />
          <FilterSelect label="Faixa" value={faixa} onChange={(v) => { setFaixa(v); setPage(0); }}
            options={[
              { v: "all", l: "Todas" },
              { v: "alto", l: "Alto (≥70)" },
              { v: "medio", l: "Médio (40-69)" },
              { v: "baixo", l: "Baixo (<40)" },
            ]} />
          <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); setPage(0); }}
            options={[
              { v: "all", l: "Todos" },
              { v: "validado", l: "Validado" },
              { v: "pendente", l: "Pendente" },
              { v: "sem_dados", l: "Sem dados" },
            ]} />
          <FilterSelect label="Ordenar" value={orderBy} onChange={(v) => setOrderBy(v as any)}
            options={[
              { v: "score", l: "Score" },
              { v: "populacao", l: "População" },
              { v: "matriculas_total", l: "Matrículas" },
              { v: "nome", l: "Nome" },
            ]} />
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => { setExportCount(null); setExportOpen(true); }}
          >
            <Download className="mr-1.5 h-4 w-4" /> Exportar
          </Button>
        </div>

        <Dialog open={exportOpen} onOpenChange={setExportOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Exportar leads</DialogTitle>
              <DialogDescription>
                Escolha a quantidade e os filtros. Os filtros de UF, status e busca já ativos na tela também são aplicados.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="export-qtd">Quantidade</Label>
                <Input
                  id="export-qtd"
                  type="number"
                  min={1}
                  max={EXPORT_MAX}
                  value={exportQtd}
                  onChange={(e) => setExportQtd(Math.max(1, Math.min(EXPORT_MAX, +e.target.value || 1)))}
                />
                <p className="text-xs text-muted-foreground">Máx. {EXPORT_MAX.toLocaleString("pt-BR")}</p>
              </div>

              <div className="space-y-1.5">
                <Label>Faixa de score</Label>
                <Select value={exportFaixa} onValueChange={setExportFaixa}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="alto">Alto (≥70)</SelectItem>
                    <SelectItem value="medio">Médio (40-69)</SelectItem>
                    <SelectItem value="baixo">Baixo (&lt;40)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="export-score-min">Score mín. (opcional)</Label>
                  <Input
                    id="export-score-min"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="0"
                    value={exportScoreMin}
                    onChange={(e) => setExportScoreMin(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="export-score-max">Score máx. (opcional)</Label>
                  <Input
                    id="export-score-max"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="100"
                    value={exportScoreMax}
                    onChange={(e) => setExportScoreMax(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Tipo de contato</Label>
                <RadioGroup value={exportContato} onValueChange={(v) => setExportContato(v as any)}>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="secretario" id="contato-secretario" />
                    Somente secretário(a)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="equipe" id="contato-equipe" />
                    Somente pessoas relacionadas (equipe)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="ambos" id="contato-ambos" />
                    Ambos
                  </label>
                </RadioGroup>
              </div>

              {exportMut.isError && (
                <p className="text-sm text-red-600">
                  Erro ao exportar: {(exportMut.error as Error).message}
                </p>
              )}
              {exportCount != null && !exportMut.isPending && (
                <p className="text-sm text-emerald-700">✓ {exportCount.toLocaleString("pt-BR")} município(s) exportado(s)</p>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                disabled={exportMut.isPending}
                onClick={() => exportMut.mutate("csv")}
              >
                {exportMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Exportar CSV
              </Button>
              <Button
                disabled={exportMut.isPending}
                onClick={() => exportMut.mutate("xlsx")}
              >
                {exportMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Exportar Excel (.xlsx)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {orderBy === "matriculas_total" && matriculasCoberturaBaixa && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Apenas {(stats.data?.comMatriculas ?? 0).toLocaleString("pt-BR")} de {(stats.data?.total ?? 0).toLocaleString("pt-BR")} municípios
              têm matrículas importadas — a ordenação por Matrículas pode não refletir todos os dados ainda.
            </span>
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
                <TableHead className="text-right">FNDE anual</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Score</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading && (
                <TableRow><TableCell colSpan={8} className="h-32 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell></TableRow>
              )}
              {!list.isLoading && list.data?.items.length === 0 && (
                <TableRow><TableCell colSpan={8} className="h-32 text-center text-sm text-muted-foreground">
                  {empty ? "Popule o catálogo para começar." : "Nenhum município encontrado com esses filtros."}
                </TableCell></TableRow>
              )}
              {list.data?.items.map((m) => (
                <TableRow key={m.ibge_id} className="cursor-pointer hover:bg-slate-50"
                  onClick={() => navigate({ to: "/municipio/$ibgeId", params: { ibgeId: String(m.ibge_id) } })}>
                  <TableCell className="font-medium">{m.nome}</TableCell>
                  <TableCell><span className="font-mono text-xs">{m.uf}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{m.populacao.toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.matriculas_total.toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.fnde_anual.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell><StatusBadge status={m.status} /></TableCell>
                  <TableCell><ScoreBadge score={m.score} faixa={m.faixa} /></TableCell>
                  <TableCell className="text-right">
                    <MapPin className="ml-auto h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                Página {page + 1} de {totalPages} · {list.data?.total.toLocaleString("pt-BR")} municípios
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="mt-10 border-t border-border bg-white">
        <div className="mx-auto max-w-[1400px] px-6 py-4 text-center text-[11px] text-muted-foreground">
          Powered by Leaderei · Desenvolvido por S7
        </div>
      </footer>
    </div>
  );
}

function StatChip({ label, value, accent }: { label: string; value: number; accent?: "emerald" | "blue" }) {
  const cls = accent === "emerald"
    ? "text-emerald-700"
    : accent === "blue"
    ? "text-blue-700"
    : "text-foreground";
  return (
    <div className="flex flex-col items-end">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`text-lg font-bold tabular-nums ${cls}`}>{value.toLocaleString("pt-BR")}</span>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ v: string; l: string }>;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { l: string; c: string }> = {
    validado: { l: "Validado", c: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    pendente: { l: "Pendente", c: "bg-amber-50 text-amber-700 border-amber-200" },
    sem_dados: { l: "Sem dados", c: "bg-slate-50 text-slate-500 border-slate-200" },
  };
  const s = map[status] ?? map.sem_dados;
  return <Badge variant="outline" className={s.c}>{s.l}</Badge>;
}

function ScoreBadge({ score, faixa }: { score: number; faixa: string }) {
  const c = faixa === "alto"
    ? "bg-emerald-500 text-white"
    : faixa === "medio"
    ? "bg-amber-500 text-white"
    : "bg-slate-300 text-slate-700";
  return (
    <div className="flex items-center gap-1.5">
      <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
      <span className={`inline-flex min-w-[38px] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${c}`}>
        {score}
      </span>
    </div>
  );
}
