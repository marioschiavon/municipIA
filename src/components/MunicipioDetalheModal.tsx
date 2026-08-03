// Modal "todas as informações do município" — visão completa (indicadores)
// + edição focada em Secretaria/Contato/Domínio, aberto tanto na fila de lote
// (admin/prospeccao) quanto na lista geral (admin/municipios). Indicadores
// gerais (população, matrículas, FNDE, PIB) permanecem só na tela de edição
// completa — aqui é só leitura.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ExternalLink,
  Loader2,
  Save,
  User,
  Building2,
  Mail,
  Phone,
  Clock,
  Users,
  MapPin,
} from "lucide-react";
import { adminGetMunicipio, adminSaveEducacaoModal } from "@/lib/admin.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function MunicipioDetalheModal({
  ibgeId,
  open,
  onOpenChange,
}: {
  ibgeId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(adminGetMunicipio);
  const saveFn = useServerFn(adminSaveEducacaoModal);

  const data = useQuery({
    queryKey: ["admin-muni", ibgeId],
    queryFn: () => getFn({ data: { ibge_id: ibgeId! } }),
    enabled: open && ibgeId != null,
  });

  const [secretario, setSecretario] = useState("");
  const [cargo, setCargo] = useState("");
  const [emailsText, setEmailsText] = useState("");
  const [telefonesText, setTelefonesText] = useState("");
  const [horario, setHorario] = useState("");
  const [dominioOficial, setDominioOficial] = useState("");
  const [paginaEducacaoUrl, setPaginaEducacaoUrl] = useState("");
  const [status, setStatus] = useState<"validado" | "pendente" | "sem_dados">("pendente");

  useEffect(() => {
    const e = data.data?.educacao as any;
    if (!e) return;
    setSecretario(e.secretario ?? "");
    setCargo(e.cargo ?? "");
    setEmailsText(Array.isArray(e.emails) ? e.emails.join("\n") : "");
    setTelefonesText(Array.isArray(e.telefones) ? e.telefones.join("\n") : "");
    setHorario(e.horario ?? "");
    setDominioOficial(e.dominio_oficial ?? "");
    setPaginaEducacaoUrl(e.pagina_educacao_url ?? "");
    setStatus(e.status ?? "pendente");
  }, [data.data]);

  const saveMut = useMutation({
    mutationFn: async () =>
      saveFn({
        data: {
          ibge_id: ibgeId!,
          secretario: secretario || null,
          cargo: cargo || null,
          emails: emailsText
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          telefones: telefonesText
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          horario: horario || null,
          dominio_oficial: dominioOficial || null,
          pagina_educacao_url: paginaEducacaoUrl || null,
          status,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-muni", ibgeId] });
      qc.invalidateQueries({ queryKey: ["admin-municipios"] });
      qc.invalidateQueries({ queryKey: ["admin-prospeccao-count"] });
    },
  });

  const m = data.data?.municipio as any;
  const e = data.data?.educacao as any;
  const linkSecretaria = paginaEducacaoUrl || e?.fonte_url;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        {data.isLoading || !m ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {m.nome} <span className="text-sm font-normal text-muted-foreground">/ {m.uf}</span>
              </DialogTitle>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> IBGE {m.ibge_id}
                </span>
                <Badge
                  variant={
                    status === "validado"
                      ? "default"
                      : status === "pendente"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {status}
                </Badge>
                {e?.score != null && (
                  <span>
                    Score: <strong>{e.score}</strong> ({e.faixa})
                  </span>
                )}
              </div>
            </DialogHeader>

            <section className="rounded-lg border border-border bg-slate-50 p-4">
              <h4 className="mb-3 text-sm font-semibold text-foreground">Indicadores</h4>
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                <IndicadorField label="População" value={m.populacao?.toLocaleString("pt-BR")} />
                <IndicadorField label="Escolas" value={m.escolas?.toLocaleString("pt-BR")} />
                <IndicadorField
                  label="Matrículas"
                  value={m.matriculas_total?.toLocaleString("pt-BR")}
                />
                <IndicadorField
                  label="FNDE anual"
                  value={Number(m.fnde_anual ?? 0).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                    maximumFractionDigits: 0,
                  })}
                />
                <IndicadorField
                  label="PIB per capita"
                  value={Number(m.pib_percapita ?? 0).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                    maximumFractionDigits: 0,
                  })}
                />
              </div>
              {Array.isArray(e?.equipe) && e.equipe.length > 0 && (
                <div className="mt-3 border-t border-border pt-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> Equipe ({e.equipe.length})
                  </div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {e.equipe.map((p: any, i: number) => (
                      <li key={i}>
                        {p.nome} — {p.cargo}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="space-y-4 rounded-lg border border-border bg-white p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">
                  Secretaria de Educação / Portal
                </h4>
                {linkSecretaria && (
                  <a
                    href={linkSecretaria}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> Abrir página da Secretaria
                  </a>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Secretário(a)" icon={<User className="h-3.5 w-3.5" />}>
                  <Input value={secretario} onChange={(ev) => setSecretario(ev.target.value)} />
                  <ConfirmadoHint
                    em={e?.secretario_confirmado_em}
                    por={e?.secretario_confirmado_por}
                  />
                </Field>
                <Field label="Cargo" icon={<Building2 className="h-3.5 w-3.5" />}>
                  <Input value={cargo} onChange={(ev) => setCargo(ev.target.value)} />
                </Field>
                <Field label="E-mail(s) — um por linha" icon={<Mail className="h-3.5 w-3.5" />}>
                  <Textarea
                    rows={2}
                    value={emailsText}
                    onChange={(ev) => setEmailsText(ev.target.value)}
                  />
                  <ConfirmadoHint em={e?.contato_confirmado_em} por={e?.contato_confirmado_por} />
                </Field>
                <Field label="Telefone(s) — um por linha" icon={<Phone className="h-3.5 w-3.5" />}>
                  <Textarea
                    rows={2}
                    value={telefonesText}
                    onChange={(ev) => setTelefonesText(ev.target.value)}
                  />
                </Field>
                <Field label="Horário de atendimento" icon={<Clock className="h-3.5 w-3.5" />}>
                  <Input value={horario} onChange={(ev) => setHorario(ev.target.value)} />
                </Field>
                <Field label="Status">
                  <Select value={status} onValueChange={(v: any) => setStatus(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sem_dados">Sem dados</SelectItem>
                      <SelectItem value="pendente">Pendente</SelectItem>
                      <SelectItem value="validado">Validado</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 rounded-md border border-amber-200 bg-amber-50 p-4 md:grid-cols-2">
                <Field label="Domínio oficial confirmado (portal da prefeitura)">
                  <Input
                    placeholder="ex.: abadiadegoias.go.gov.br"
                    value={dominioOficial}
                    onChange={(ev) => setDominioOficial(ev.target.value)}
                  />
                  <ConfirmadoHint em={e?.dominio_confirmado_em} por={e?.dominio_confirmado_por} />
                </Field>
                <Field label="URL da página de Educação">
                  <Input
                    placeholder="https://..."
                    value={paginaEducacaoUrl}
                    onChange={(ev) => setPaginaEducacaoUrl(ev.target.value)}
                  />
                </Field>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                  {saveMut.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Salvar alterações
                </Button>
                {saveMut.isSuccess && (
                  <span className="text-sm text-emerald-700">
                    ✓ Salvo. Score: <strong>{saveMut.data.score}</strong> ({saveMut.data.faixa})
                  </span>
                )}
                {saveMut.error && (
                  <span className="text-sm text-red-600">{(saveMut.error as Error).message}</span>
                )}
              </div>
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function IndicadorField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value ?? "—"}</div>
    </div>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </Label>
      {children}
    </div>
  );
}

function ConfirmadoHint({ em, por }: { em?: string | null; por?: string | null }) {
  if (!em) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      Confirmado{por ? ` por ${por}` : ""} em {new Date(em).toLocaleDateString("pt-BR")}
    </p>
  );
}
