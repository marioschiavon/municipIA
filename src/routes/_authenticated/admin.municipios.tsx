import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import { adminListMunicipios } from "@/lib/admin.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, ChevronLeft, ChevronRight, Pencil } from "lucide-react";

const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];
const PAGE_SIZE = 50;

export const Route = createFileRoute("/_authenticated/admin/municipios")({
  component: AdminMunicipios,
});

function AdminMunicipios() {
  const listFn = useServerFn(adminListMunicipios);
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
      </div>

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
