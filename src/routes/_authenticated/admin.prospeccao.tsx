// Aba dedicada à prospecção em lotes, por fase separada (domínio → secretário
// → contato) — cada fase evita rebuscar o que a anterior já achou, e resultados
// fracos/incertos aparecem na hora pra auditoria/correção manual do admin.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  adminListMunicipioIds,
  adminCountElegiveis,
  adminResolveRevisao,
  adminProspeccaoCiclo,
  adminResetCicloProspeccao,
} from "@/lib/admin.functions";

import { useProspectQueue, type QueueLogEntry } from "@/lib/use-prospect-queue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MunicipioDetalheModal } from "@/components/MunicipioDetalheModal";
import { Loader2, PlayCircle, StopCircle, AlertTriangle, Check, Eye } from "lucide-react";

const UFS = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
];

type FaseIsolada = "dominio" | "secretario" | "contato";

/** Rótulos em português para o status técnico da fila (valor interno segue igual). */
const STATUS_LABEL: Record<QueueLogEntry["status"], string> = {
  found: "OK",
  partial: "Parcial",
  not_found: "Não encontrado",
  error: "Erro",
};

const FASE_LABEL: Record<FaseIsolada, string> = {
  dominio: "Fase 1 — Domínio",
  secretario: "Fase 2 — Secretário",
  contato: "Fase 3 — Contato",
};
// Fase 1/3 são baratas (sem IA ou regex-primeiro) — pausa curta. Fase 2 usa IA por
// candidato — pausa maior, pra não estourar rate limit do provider. A busca em si
// (SERP do Apify) já leva 10–40s por município, então a pausa da Fase 1 é curta.
const FASE_INTERVALO_MS: Record<FaseIsolada, number> = {
  dominio: 2_000,
  secretario: 30_000,
  contato: 15_000,
};

export const Route = createFileRoute("/_authenticated/admin/prospeccao")({
  component: AdminProspeccao,
});

function AdminProspeccao() {
  const listIdsFn = useServerFn(adminListMunicipioIds);
  const countFn = useServerFn(adminCountElegiveis);
  const cicloFn = useServerFn(adminProspeccaoCiclo);
  const resetFn = useServerFn(adminResetCicloProspeccao);
  const qc = useQueryClient();

  const [fase, setFase] = useState<FaseIsolada>("dominio");
  const [uf, setUf] = useState("all");
  const [loteSize, setLoteSize] = useState(500);
  const [provider, setProvider] = useState<"apify" | "firecrawl">("apify");
  const [modo, setModo] = useState<"continuar" | "repescagem">("continuar");
  const [resolvidos, setResolvidos] = useState<Set<number>>(new Set());
  const [detalheId, setDetalheId] = useState<number | null>(null);
  const [lote, setLote] = useState<{ inicio: string; fim: string } | null>(null);
  const [resetando, setResetando] = useState(false);

  const filtros = { uf: uf === "all" ? undefined : uf };

  const count = useQuery({
    queryKey: ["admin-prospeccao-count", fase, filtros],
    queryFn: () => countFn({ data: { fase, ...filtros } }),
  });

  const ciclo = useQuery({
    queryKey: ["admin-prospeccao-ciclo", fase, filtros],
    queryFn: () => cicloFn({ data: { fase, ...filtros } }),
  });

  const queue = useProspectQueue(FASE_INTERVALO_MS[fase]);

  async function iniciarLote() {
    queue.setLoadingIds(true);
    setResolvidos(new Set());
    setLote(null);
    try {
      const { items } = await listIdsFn({
        data: { ...filtros, fase, modo, limit: Math.max(1, loteSize) },
      });
      if (items.length === 0) return;
      const primeiro = items[0];
      const ultimo = items[items.length - 1];
      setLote({
        inicio: `${primeiro.nome}/${primeiro.uf}`,
        fim: `${ultimo.nome}/${ultimo.uf}`,
      });
      await queue.iniciar(items, fase, provider, () => {
        qc.invalidateQueries({ queryKey: ["admin-prospeccao-count"] });
        qc.invalidateQueries({ queryKey: ["admin-prospeccao-ciclo"] });
        qc.invalidateQueries({ queryKey: ["admin-municipios"] });
      });
    } finally {
      queue.setLoadingIds(false);
    }
  }

  async function reiniciarCiclo() {
    if (!window.confirm("Reiniciar o ciclo desta fase? Todos os municípios voltam a ser tentados desde o início.")) return;
    setResetando(true);
    try {
      await resetFn({ data: { fase, ...filtros } });
      qc.invalidateQueries({ queryKey: ["admin-prospeccao-ciclo"] });
    } finally {
      setResetando(false);
    }
  }

  function marcarResolvido(ibgeId: number) {
    setResolvidos((prev) => new Set(prev).add(ibgeId));
    qc.invalidateQueries({ queryKey: ["admin-prospeccao-count"] });
    qc.invalidateQueries({ queryKey: ["admin-municipios"] });
  }


  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Prospecção em lotes</h2>
        <p className="text-sm text-muted-foreground">
          Cada fase roda separadamente sobre um lote de municípios — domínio primeiro, depois
          secretário e contato (que já usam o domínio confirmado, sem buscar no Google/Apify de
          novo). Resultados fracos aparecem abaixo pra revisão na hora.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-4">
        <div className="flex gap-1 rounded-md border border-border p-1">
          {(["dominio", "secretario", "contato"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={fase === f ? "default" : "ghost"}
              onClick={() => setFase(f)}
              disabled={queue.running}
            >
              {FASE_LABEL[f]}
            </Button>
          ))}
        </div>
        <Select value={uf} onValueChange={setUf}>
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="UF" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos UFs</SelectItem>
            {UFS.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Provedor de busca</label>
          <Select
            value={provider}
            onValueChange={(v) => setProvider(v as "apify" | "firecrawl")}
            disabled={queue.running}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="apify">Apify</SelectItem>
              <SelectItem value="firecrawl">Firecrawl</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Tamanho do lote</label>
          <Input
            type="number"
            min={1}
            className="w-24"
            value={loteSize}
            onChange={(e) => setLoteSize(+e.target.value || 1)}
            disabled={queue.running}
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {count.isLoading
            ? "..."
            : `${(count.data?.count ?? 0).toLocaleString("pt-BR")} elegível(is)`}
        </div>
        {queue.running ? (
          <Button size="sm" variant="destructive" onClick={queue.cancelar}>
            <StopCircle className="mr-1.5 h-4 w-4" /> Cancelar
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={iniciarLote}
            disabled={queue.loadingIds || (count.data?.count ?? 0) === 0}
          >
            {queue.loadingIds ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="mr-1.5 h-4 w-4" />
            )}
            Iniciar lote
          </Button>
        )}
      </div>

      {(queue.running || queue.log.length > 0) && (
        <div className="rounded-lg border border-border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">
              {FASE_LABEL[fase]} {queue.running ? "— em andamento" : "— finalizado"}
            </span>
            <span className="text-muted-foreground">
              {queue.done}/{queue.total} processado(s)
            </span>
          </div>
          <Progress value={queue.total > 0 ? (queue.done / queue.total) * 100 : 0} />
          {queue.running && (
            <p className="text-xs text-muted-foreground">
              {queue.waiting
                ? "Aguardando antes do próximo município..."
                : queue.current
                  ? `Processando: ${queue.current.nome}/${queue.current.uf}...`
                  : "Iniciando..."}
            </p>
          )}
          <div className="max-h-[32rem] space-y-2 overflow-y-auto">
            {queue.log.map((e, i) => (
              <LogRow
                key={`${e.ibge_id}-${i}`}
                entry={e}
                fase={fase}
                resolvido={resolvidos.has(e.ibge_id)}
                onResolvido={() => marcarResolvido(e.ibge_id)}
                onDetalhes={() => setDetalheId(e.ibge_id)}
              />
            ))}
          </div>
        </div>
      )}

      <MunicipioDetalheModal
        ibgeId={detalheId}
        open={detalheId != null}
        onOpenChange={(o) => !o && setDetalheId(null)}
      />
    </div>
  );
}

function LogRow({
  entry,
  fase,
  resolvido,
  onResolvido,
  onDetalhes,
}: {
  entry: QueueLogEntry;
  fase: FaseIsolada;
  resolvido: boolean;
  onResolvido: () => void;
  onDetalhes: () => void;
}) {
  const resolveFn = useServerFn(adminResolveRevisao);
  const r = entry.result;
  const precisaRevisao = !!r?.revisar && !resolvido;
  const [saving, setSaving] = useState(false);
  const [dominio, setDominio] = useState(r?.dominioOficialConfirmado ?? "");
  const [secretario, setSecretario] = useState(r?.secretario ?? "");
  const [cargo, setCargo] = useState(r?.cargo ?? "");
  const [emailsText, setEmailsText] = useState((r?.emails ?? []).join("\n"));
  const [telefonesText, setTelefonesText] = useState((r?.telefones ?? []).join("\n"));

  async function salvar() {
    setSaving(true);
    try {
      const patch =
        fase === "dominio"
          ? { dominio_oficial: dominio || null }
          : fase === "secretario"
            ? { secretario: secretario || null, cargo: cargo || null }
            : {
                emails: emailsText
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
                telefones: telefonesText
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              };
      await resolveFn({ data: { ibge_id: entry.ibge_id, fase, patch } });
      onResolvido();
    } finally {
      setSaving(false);
    }
  }

  async function marcarComoRevisado() {
    setSaving(true);
    try {
      await resolveFn({ data: { ibge_id: entry.ibge_id, fase } });
      onResolvido();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`rounded border px-3 py-2 text-xs ${precisaRevisao ? "border-amber-300 bg-amber-50" : "border-border"}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {entry.nome}/{entry.uf}
        </span>
        <span className="flex items-center gap-2">
          {entry.detalhe && <span className="text-muted-foreground">{entry.detalhe}</span>}
          <Badge
            variant={
              entry.status === "found"
                ? "default"
                : entry.status === "partial"
                  ? "secondary"
                  : entry.status === "error"
                    ? "destructive"
                    : "outline"
            }
          >
            {STATUS_LABEL[entry.status]}
          </Badge>
          <button
            type="button"
            onClick={onDetalhes}
            className="inline-flex items-center gap-1 rounded border border-input px-1.5 py-0.5 text-[11px] hover:bg-accent"
          >
            <Eye className="h-3 w-3" /> Detalhes
          </button>
          {resolvido && (
            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
              <Check className="mr-1 h-3 w-3" /> revisado
            </Badge>
          )}
        </span>
      </div>
      {entry.status !== "found" && entry.motivo && (
        <p className="mt-1 text-[11px] leading-snug text-amber-700" title={entry.motivo}>
          Motivo: {entry.motivo}
        </p>
      )}
      {precisaRevisao && (
        <div className="mt-2 space-y-2 rounded border border-amber-200 bg-white p-2">
          <div className="flex items-center gap-1.5 text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {r?.motivoRevisao ?? "Confiança baixa — revise antes de confiar neste dado."}
          </div>
          {fase === "dominio" && (
            <Input
              value={dominio}
              onChange={(e) => setDominio(e.target.value)}
              placeholder="domínio oficial (ex.: abadiadegoias.go.gov.br)"
            />
          )}
          {fase === "secretario" && (
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={secretario}
                onChange={(e) => setSecretario(e.target.value)}
                placeholder="Secretário(a)"
              />
              <Input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Cargo" />
            </div>
          )}
          {fase === "contato" && (
            <div className="grid grid-cols-2 gap-2">
              <Textarea
                rows={2}
                value={emailsText}
                onChange={(e) => setEmailsText(e.target.value)}
                placeholder="e-mails (um por linha)"
              />
              <Textarea
                rows={2}
                value={telefonesText}
                onChange={(e) => setTelefonesText(e.target.value)}
                placeholder="telefones (um por linha)"
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={saving} onClick={salvar}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar alterações"}
            </Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={marcarComoRevisado}>
              Marcar como revisado
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
