// Aba dedicada à prospecção em lotes, por fase separada (domínio → secretário
// → contato) — cada fase evita rebuscar o que a anterior já achou, e resultados
// fracos/incertos vão para uma fila lateral de revisão manual, que só esvazia
// quando o admin trata cada município.
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

import { useProspeccaoLote, type FaseIsolada, type RevisaoItem } from "@/lib/prospeccao-lote-context";
import type { QueueLogEntry } from "@/lib/use-prospect-queue";
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
import { Loader2, PlayCircle, StopCircle, AlertTriangle, Check, Eye, RotateCcw } from "lucide-react";

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
  completo: "Lote completo (3 em 1)",
};
const FASE_CURTA: Record<FaseIsolada, string> = {
  dominio: "Domínio",
  secretario: "Secretário",
  contato: "Contato",
  completo: "Completo",
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

  // Estado do lote (fase/uf/loteSize/modo/queue/revisões) vive no contexto
  // montado em admin.tsx, acima do <Outlet/> — sobrevive a navegar para outra
  // aba do admin e voltar, ao contrário de useState local nesta página.
  const { fase, setFase, uf, setUf, loteSize, setLoteSize, modo, setModo, revisoes, marcarResolvido: marcarResolvidoCtx, lote, setLote, queue } = useProspeccaoLote();
  const [destaque, setDestaque] = useState<number | null>(null);
  const [detalheId, setDetalheId] = useState<number | null>(null);
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

  async function iniciarLote() {
    queue.setLoadingIds(true);
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
      await queue.iniciar(items, fase, () => {
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

  function marcarResolvido(ibgeId: number, faseItem: FaseIsolada) {
    marcarResolvidoCtx(ibgeId, faseItem);
    qc.invalidateQueries({ queryKey: ["admin-prospeccao-count"] });
    qc.invalidateQueries({ queryKey: ["admin-municipios"] });
  }

  function irParaRevisao(ibgeId: number) {
    setDestaque(ibgeId);
    document
      .getElementById(`revisao-${ibgeId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setDestaque((d) => (d === ibgeId ? null : d)), 2000);
  }

  const pendentesIds = new Set(revisoes.map((r) => r.ibge_id));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Prospecção em lotes</h2>
        <p className="text-sm text-muted-foreground">
          Cada fase roda separadamente sobre um lote de municípios — domínio primeiro, depois
          secretário e contato (que já usam o domínio confirmado, sem buscar no Google/Apify de
          novo). No <strong>Lote completo</strong> as três etapas rodam de uma vez por município,
          começando pela Visão Geral por IA do Google (navegador real na SERP, com as fontes) e só
          depois pelos snippets e pelo site oficial. Resultados fracos vão para a fila de revisão ao
          lado e só saem de lá quando você atualizar o município.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-4">
        <div className="flex gap-1 rounded-md border border-border p-1">
          {(["dominio", "secretario", "contato", "completo"] as const).map((f) => (
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
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Modo</label>
          <Select
            value={modo}
            onValueChange={(v) => setModo(v as "continuar" | "repescagem")}
            disabled={queue.running}
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="continuar">Continuar de onde parou</SelectItem>
              <SelectItem value="repescagem">Repescagem (já tentados)</SelectItem>
            </SelectContent>
          </Select>
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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-white px-4 py-3 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RotateCcw className="h-4 w-4 shrink-0" />
          {ciclo.isLoading || !ciclo.data ? (
            "Carregando progresso do ciclo..."
          ) : (
            <span>
              Ciclo atual:{" "}
              <strong className="text-foreground">
                {ciclo.data.jaTentados.toLocaleString("pt-BR")}
              </strong>{" "}
              de {ciclo.data.elegiveis.toLocaleString("pt-BR")} já tentados nesta fase
              {ciclo.data.proximo
                ? ` — próximo lote começa em ${ciclo.data.proximo.nome}/${ciclo.data.proximo.uf}`
                : " — nada elegível no filtro atual"}
              {ciclo.data.naoTentados === 0 && ciclo.data.elegiveis > 0
                ? " (ciclo completo: reinicia pelos mais antigos)"
                : ""}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={queue.running || resetando}
          onClick={reiniciarCiclo}
        >
          {resetando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          Reiniciar ciclo
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="order-2 min-w-0 lg:order-1">
          {(queue.running || queue.log.length > 0) && (
            <div className="space-y-3 rounded-lg border border-border bg-white p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">
                  {FASE_LABEL[fase]} {queue.running ? "— em andamento" : "— finalizado"}
                </span>
                <span className="text-muted-foreground">
                  {queue.done}/{queue.total} processado(s)
                </span>
              </div>
              <Progress value={queue.total > 0 ? (queue.done / queue.total) * 100 : 0} />
              {lote && (
                <p className="text-xs text-muted-foreground">
                  Lote de {lote.inicio} até {lote.fim}
                </p>
              )}

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
                    pendente={pendentesIds.has(e.ibge_id)}
                    onRevisar={() => irParaRevisao(e.ibge_id)}
                    onDetalhes={() => setDetalheId(e.ibge_id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="order-1 min-w-0 lg:order-2">
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-4 lg:sticky lg:top-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> Precisa de revisão
              </span>
              <Badge variant="outline" className="border-amber-300 bg-white text-amber-700">
                {revisoes.length}
              </Badge>
            </div>
            {revisoes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma revisão pendente. Resultados fracos aparecem aqui e só saem depois que você
                salvar ou marcar como revisado.
              </p>
            ) : (
              <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
                {revisoes.map((r) => (
                  <RevisaoCard
                    key={`${r.ibge_id}-${r.fase}`}
                    item={r}
                    destacado={destaque === r.ibge_id}
                    onResolvido={() => marcarResolvido(r.ibge_id, r.fase)}
                    onDetalhes={() => setDetalheId(r.ibge_id)}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

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
  pendente,
  onRevisar,
  onDetalhes,
}: {
  entry: QueueLogEntry;
  pendente: boolean;
  onRevisar: () => void;
  onDetalhes: () => void;
}) {
  return (
    <div
      className={`rounded border px-3 py-2 text-xs ${pendente ? "border-amber-300 bg-amber-50" : "border-border"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">
          {entry.nome}/{entry.uf}
        </span>
        <span className="flex shrink-0 items-center gap-2">
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
        </span>
      </div>
      {entry.status !== "found" && entry.motivo && (
        <p className="mt-1 text-[11px] leading-snug text-amber-700" title={entry.motivo}>
          Motivo: {entry.motivo}
        </p>
      )}
      {pendente && (
        <button
          type="button"
          onClick={onRevisar}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 underline underline-offset-2"
        >
          <AlertTriangle className="h-3 w-3" /> Na fila de revisão — abrir
        </button>
      )}
    </div>
  );
}

function RevisaoCard({
  item,
  destacado,
  onResolvido,
  onDetalhes,
}: {
  item: RevisaoItem;
  destacado: boolean;
  onResolvido: () => void;
  onDetalhes: () => void;
}) {
  const resolveFn = useServerFn(adminResolveRevisao);
  const r = item.result;
  const fase = item.fase;
  const [saving, setSaving] = useState(false);
  const [dominio, setDominio] = useState(r?.dominioOficialConfirmado ?? "");
  const [secretario, setSecretario] = useState(r?.secretario ?? "");
  const [cargo, setCargo] = useState(r?.cargo ?? "");
  const [emailsText, setEmailsText] = useState((r?.emails ?? []).join("\n"));
  const [telefonesText, setTelefonesText] = useState((r?.telefones ?? []).join("\n"));

  async function salvar() {
    setSaving(true);
    try {
      const listas = {
        emails: emailsText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        telefones: telefonesText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const patch =
        fase === "dominio"
          ? { dominio_oficial: dominio || null }
          : fase === "secretario"
            ? { secretario: secretario || null, cargo: cargo || null }
            : fase === "contato"
              ? listas
              : {
                  dominio_oficial: dominio || null,
                  secretario: secretario || null,
                  cargo: cargo || null,
                  ...listas,
                };
      await resolveFn({ data: { ibge_id: item.ibge_id, fase, patch } });
      onResolvido();
    } finally {
      setSaving(false);
    }
  }

  async function marcarComoRevisado() {
    setSaving(true);
    try {
      await resolveFn({ data: { ibge_id: item.ibge_id, fase } });
      onResolvido();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      id={`revisao-${item.ibge_id}`}
      className={`space-y-2 rounded border bg-white p-2 text-xs transition-shadow ${
        destacado ? "border-amber-500 shadow-md ring-2 ring-amber-300" : "border-amber-200"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">
          {item.nome}/{item.uf}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            {FASE_CURTA[fase]}
          </Badge>
          <button
            type="button"
            onClick={onDetalhes}
            className="inline-flex items-center gap-1 rounded border border-input px-1.5 py-0.5 text-[11px] hover:bg-accent"
          >
            <Eye className="h-3 w-3" /> Detalhes
          </button>
        </span>
      </div>
      <p className="flex items-start gap-1.5 leading-snug text-amber-700">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {r?.motivoRevisao ?? item.motivo ?? "Confiança baixa — revise antes de confiar neste dado."}
      </p>
      {(fase === "dominio" || fase === "completo") && (
        <Input
          value={dominio}
          onChange={(e) => setDominio(e.target.value)}
          placeholder="domínio oficial (ex.: abadiadegoias.go.gov.br)"
        />
      )}
      {(fase === "secretario" || fase === "completo") && (
        <div className="space-y-2">
          <Input
            value={secretario}
            onChange={(e) => setSecretario(e.target.value)}
            placeholder="Secretário(a)"
          />
          <Input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Cargo" />
        </div>
      )}
      {(fase === "contato" || fase === "completo") && (
        <div className="space-y-2">
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
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={saving} onClick={salvar}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar alterações"}
        </Button>
        <Button size="sm" variant="outline" disabled={saving} onClick={marcarComoRevisado}>
          <Check className="mr-1 h-3.5 w-3.5" /> Marcar como revisado
        </Button>
      </div>
    </div>
  );
}
