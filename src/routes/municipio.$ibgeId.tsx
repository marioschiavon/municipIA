import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  ArrowLeft, RefreshCw, Loader2, User, Mail, Phone, Clock, Users, ExternalLink,
  Building2, TrendingUp, GraduationCap, Wallet, MapPin, Search, CheckCircle2,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { getMunicipio } from "@/lib/catalog.functions";
import { FAIXA_LABEL } from "@/lib/catalog-score";
import { useProspectStream } from "@/lib/use-prospect-stream";
import { isDadosCompletos, camposFaltando, resumirResultado } from "@/lib/prospect-completeness";
import { ProspectResultFields } from "@/components/ProspectResultFields";
import { useLeaderei } from "@/hooks/useLeaderei";
import { buildLeadereiRow, rowTemContato } from "@/lib/leaderei";

export const Route = createFileRoute("/municipio/$ibgeId")({
  head: ({ params }) => ({
    meta: [
      { title: `Município ${params.ibgeId} — MunicipIA` },
      { name: "description", content: "Ficha de prospecção educacional municipal." },
      { property: "og:title", content: `Município ${params.ibgeId} — MunicipIA` },
      { property: "og:description", content: "Ficha de prospecção educacional municipal." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MunicipioPage,
});

function MunicipioPage() {
  const { ibgeId } = useParams({ from: "/municipio/$ibgeId" });
  const id = parseInt(ibgeId, 10);
  const getFn = useServerFn(getMunicipio);
  const stream = useProspectStream();

  const q = useQuery({
    queryKey: ["municipio", id],
    queryFn: () => getFn({ data: { ibge_id: id } }),
  });

  const [verifying, setVerifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function verificarDados() {
    setVerifying(true);
    setStatusMessage(null);
    try {
      await q.refetch();
      const educacao = q.data?.educacao;
      if (isDadosCompletos(educacao)) {
        setStatusMessage("Dados estão atualizados no catálogo.");
        return;
      }
      setDialogOpen(true);
      const faltando = camposFaltando(educacao);
      const nome = q.data?.nome ?? "";
      const uf = q.data?.uf ?? "";
      await stream.run(nome, uf, id);
      await q.refetch();
      if (stream.result) {
        const resumo = resumirResultado(stream.result);
        setStatusMessage(resumo.mensagem);
      } else if (faltando.length > 0) {
        setStatusMessage(`Buscamos, mas ainda faltou: ${faltando.join(", ")}.`);
      }
    } finally {
      setVerifying(false);
    }
  }

  if (q.isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!q.data) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <p>Município não encontrado.</p>
        <Link to="/" className="mt-4 inline-block text-primary underline">Voltar ao catálogo</Link>
      </div>
    );
  }

  const m = q.data;
  const edu = m.educacao;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Catálogo
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/manual" className="text-sm text-muted-foreground hover:text-foreground">Manual</Link>
            {statusMessage && (
              <span className="hidden text-sm text-emerald-700 sm:inline-flex">
                <CheckCircle2 className="mr-1 h-4 w-4" /> {statusMessage}
              </span>
            )}
            <Button variant="outline" onClick={verificarDados} disabled={verifying || stream.running}>
              {verifying || stream.running ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Prospectando…</> : <><Search className="mr-2 h-4 w-4" /> Verificar dados</>}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {statusMessage && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4" /> {statusMessage}
          </div>
        )}

        <div className="mb-8 rounded-xl border border-border bg-white p-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" /> {m.uf} · Código IBGE {m.ibge_id}
              </div>
              <h1 className="mt-1 text-3xl font-bold tracking-tight">{m.nome}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={edu.status} />
                {edu.atualizado_em && (
                  <span className="text-xs text-muted-foreground">
                    Atualizado em {new Date(edu.atualizado_em).toLocaleDateString("pt-BR")}
                  </span>
                )}
              </div>
            </div>
            <ScoreBig score={edu.score} faixa={edu.faixa} breakdown={edu.breakdown} />
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card icon={<Building2 className="h-5 w-5" />} title="Secretaria de Educação">
            {edu.status === "sem_dados" ? (
              <p className="text-sm text-muted-foreground">Sem dados coletados ainda — estamos atualizando o catálogo.</p>
            ) : (
              <div className="space-y-3">
                <Field icon={<User className="h-4 w-4" />} label="Secretário(a)" value={edu.secretario} />
                <Field icon={<Building2 className="h-4 w-4" />} label="Cargo" value={edu.cargo} />
                <Field icon={<Mail className="h-4 w-4" />} label="E-mail" value={edu.emails.length ? edu.emails.join(", ") : null} mono />
                <Field icon={<Phone className="h-4 w-4" />} label="Telefone" value={edu.telefones.length ? edu.telefones.join(", ") : null} />
                <Field icon={<Clock className="h-4 w-4" />} label="Atendimento" value={edu.horario} />
                {edu.fonte_url && (
                  <a href={edu.fonte_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" /> Fonte
                  </a>
                )}
              </div>
            )}
          </Card>

          <Card icon={<Users className="h-5 w-5" />} title={`Equipe (${edu.equipe?.length ?? 0})`}>
            {(!edu.equipe || edu.equipe.length === 0) ? (
              <p className="text-sm text-muted-foreground">Nenhum membro cadastrado ainda.</p>
            ) : (
              <ul className="space-y-2">
                {edu.equipe.map((p, i) => (
                  <li key={i} className="rounded-md border border-border bg-slate-50 p-2.5 text-sm">
                    <div className="font-medium">{p.nome}</div>
                    <div className="text-xs text-muted-foreground">{p.cargo}</div>
                    {(p.email || p.telefone) && (
                      <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                        {p.email && <span className="font-mono">{p.email}</span>}
                        {p.telefone && <span>{p.telefone}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card icon={<TrendingUp className="h-5 w-5" />} title="Indicadores IBGE">
            <Field label="População" value={m.populacao.toLocaleString("pt-BR")} />
            <Field label="PIB per capita" value={m.pib_percapita.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} />
          </Card>

          <Card icon={<GraduationCap className="h-5 w-5" />} title="Indicadores INEP">
            <Field label="Matrículas totais" value={m.matriculas_total.toLocaleString("pt-BR")} />
            <Field label="Escolas" value={m.escolas.toLocaleString("pt-BR")} />
          </Card>

          <Card icon={<Wallet className="h-5 w-5" />} title="Indicadores FNDE" className="md:col-span-2">
            <Field label="Repasse anual estimado"
              value={m.fnde_anual.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} />
            <p className="mt-2 text-[11px] text-muted-foreground">
              * Valores INEP/FNDE são estimativas mocadas para demonstração. Integração com APIs oficiais será feita na v0.29+.
            </p>
          </Card>
        </div>
      </main>

      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!open) stream.cancel();
        setDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Prospectando {m.nome}</DialogTitle>
            <DialogDescription>
              Estamos buscando as informações de contato da Secretaria de Educação. Isso pode levar até 2 minutos.
            </DialogDescription>
          </DialogHeader>
          <div className="py-8">
            <div className="flex flex-col items-center justify-center text-center">
              {stream.result || stream.step?.kind === "final" ? (
                <div className="mb-4 rounded-full bg-emerald-100 p-3">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </div>
              ) : (
                <div className="relative mb-4">
                  <div className="h-16 w-16 rounded-full border-4 border-primary/20" />
                  <Loader2 className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 animate-spin text-primary" />
                </div>
              )}
              <p className="text-lg font-medium text-foreground">
                {stream.result || stream.step?.kind === "final"
                  ? resumirResultado(stream.result ?? stream.step?.result).mensagem
                  : (stream.step?.message ?? "Buscando informações…")}
              </p>
              {stream.error && !stream.result && stream.step?.kind !== "final" && (
                <p className="mt-2 text-sm text-red-600">{stream.error}</p>
              )}
              <ProspectResultFields result={stream.result ?? stream.step?.result} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => { stream.cancel(); setDialogOpen(false); }}>
              {stream.running ? "Cancelar" : "Fechar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Card({ icon, title, children, className }: { icon: React.ReactNode; title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-white p-5 ${className ?? ""}`}>
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-primary">{icon}</span>{title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ icon, label, value, mono }: { icon?: React.ReactNode; label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {icon}{label}
      </span>
      <span className={`text-right ${mono ? "font-mono text-xs" : "font-medium"}`}>{value || "—"}</span>
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

function ScoreBig({ score, faixa, breakdown }: { score: number; faixa: string; breakdown: Record<string, number> }) {
  const c = faixa === "alto" ? "bg-emerald-500" : faixa === "medio" ? "bg-amber-500" : "bg-slate-400";
  return (
    <div className="text-right">
      <div className={`inline-flex h-20 w-20 items-center justify-center rounded-2xl ${c} text-3xl font-bold text-white shadow-lg`}>
        {score}
      </div>
      <div className="mt-2 text-xs font-medium">{FAIXA_LABEL[faixa as "alto" | "medio" | "baixo"] ?? faixa}</div>
      <div className="mt-1 text-[10px] leading-tight text-muted-foreground">
        Porte {breakdown.porte ?? 0} · Financ {breakdown.financeiro ?? 0}<br/>
        Contato {breakdown.completude ?? 0} · Recência {breakdown.recencia ?? 0}
      </div>
    </div>
  );
}
