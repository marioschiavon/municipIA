import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { adminGetMunicipio, adminSaveMunicipio } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Plus, Trash2, Save } from "lucide-react";

const ETAPAS: Array<{ id: string; label: string; hint: string }> = [
  { id: "creche", label: "Creche", hint: "0 a 3 anos" },
  { id: "pre_escola", label: "Pré-escola", hint: "4 a 5 anos" },
  { id: "fundamental_ai", label: "Fundamental — Anos Iniciais", hint: "6 a 10 anos (1º ao 5º)" },
  { id: "fundamental_af", label: "Fundamental — Anos Finais", hint: "11 a 14 anos (6º ao 9º)" },
  { id: "medio", label: "Ensino Médio", hint: "15 a 17 anos" },
  { id: "eja", label: "EJA", hint: "Jovens e adultos" },
  { id: "especial", label: "Educação Especial", hint: "AEE" },
  { id: "profissionalizante", label: "Profissionalizante", hint: "Técnico/EPT" },
];

export const Route = createFileRoute("/_authenticated/admin/municipios/$ibgeId")({
  component: AdminEditMunicipio,
});

function AdminEditMunicipio() {
  const { ibgeId } = Route.useParams();
  const id = Number(ibgeId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const getFn = useServerFn(adminGetMunicipio);
  const saveFn = useServerFn(adminSaveMunicipio);
  const data = useQuery({ queryKey: ["admin-muni", id], queryFn: () => getFn({ data: { ibge_id: id } }) });

  // form state
  const [populacao, setPopulacao] = useState(0);
  const [escolas, setEscolas] = useState(0);
  const [fnde, setFnde] = useState(0);
  const [pib, setPib] = useState(0);
  const [matriculas, setMatriculas] = useState<Record<string, number>>({});
  const [edu, setEdu] = useState({
    secretario: "", cargo: "", email: "", telefone: "", horario: "", fonte: "", fonte_url: "",
    status: "pendente" as "validado" | "pendente" | "sem_dados",
  });
  const [equipe, setEquipe] = useState<Array<{ nome: string; cargo: string; email?: string | null; telefone?: string | null }>>([]);

  useEffect(() => {
    if (!data.data) return;
    const m = data.data.municipio; const e = data.data.educacao; const et = data.data.etapas;
    if (m) {
      setPopulacao(m.populacao ?? 0); setEscolas(m.escolas ?? 0);
      setFnde(Number(m.fnde_anual ?? 0)); setPib(Number(m.pib_percapita ?? 0));
    }
    if (e) {
      setEdu({
        secretario: e.secretario ?? "", cargo: e.cargo ?? "", email: e.email ?? "",
        telefone: e.telefone ?? "", horario: e.horario ?? "", fonte: e.fonte ?? "", fonte_url: e.fonte_url ?? "",
        status: (e.status as any) ?? "pendente",
      });
      setEquipe(Array.isArray(e.equipe) ? (e.equipe as any) : []);
    }
    const map: Record<string, number> = {};
    for (const row of et) map[row.etapa] = row.matriculas;
    setMatriculas(map);
  }, [data.data]);

  const saveMut = useMutation({
    mutationFn: async () => saveFn({
      data: {
        ibge_id: id,
        municipio: {
          populacao, matriculas_total: Object.values(matriculas).reduce((a, b) => a + (b || 0), 0),
          escolas, fnde_anual: fnde, pib_percapita: pib,
        },
        educacao: {
          secretario: edu.secretario || null, cargo: edu.cargo || null,
          email: edu.email || null, telefone: edu.telefone || null,
          horario: edu.horario || null, fonte: edu.fonte || null,
          fonte_url: edu.fonte_url || null, status: edu.status, equipe,
        },
        etapas: ETAPAS.map((e) => ({ etapa: e.id as any, matriculas: matriculas[e.id] || 0 })),
      },
    }),
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });

  if (data.isLoading) return <div className="py-8 text-center"><Loader2 className="inline h-5 w-5 animate-spin" /></div>;
  if (!data.data?.municipio) return <div>Município não encontrado.</div>;

  const m = data.data.municipio;
  const totalMat = Object.values(matriculas).reduce((a, b) => a + (b || 0), 0);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link to="/admin/municipios" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar para lista
        </Link>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">{m.nome} <span className="text-muted-foreground font-normal">/ {m.uf}</span></h2>
        <p className="text-xs text-muted-foreground">IBGE {m.ibge_id}</p>
      </div>

      {/* Indicadores */}
      <section className="rounded-lg border border-border bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold">Indicadores gerais</h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="População (IBGE)"><Input type="number" min={0} value={populacao} onChange={(e) => setPopulacao(+e.target.value || 0)} /></Field>
          <Field label="Escolas (INEP)"><Input type="number" min={0} value={escolas} onChange={(e) => setEscolas(+e.target.value || 0)} /></Field>
          <Field label="FNDE anual (R$)"><Input type="number" min={0} step="0.01" value={fnde} onChange={(e) => setFnde(+e.target.value || 0)} /></Field>
          <Field label="PIB per capita (R$)"><Input type="number" min={0} step="0.01" value={pib} onChange={(e) => setPib(+e.target.value || 0)} /></Field>
        </div>
      </section>

      {/* Matriculas por etapa */}
      <section className="rounded-lg border border-border bg-white p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h3 className="text-lg font-semibold">Matrículas por etapa (INEP)</h3>
          <span className="text-sm text-muted-foreground">Total: <strong className="tabular-nums text-foreground">{totalMat.toLocaleString("pt-BR")}</strong></span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ETAPAS.map((e) => (
            <div key={e.id} className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-sm font-medium">{e.label}</div>
                <div className="text-xs text-muted-foreground">{e.hint}</div>
              </div>
              <Input className="w-32" type="number" min={0}
                value={matriculas[e.id] ?? 0}
                onChange={(ev) => setMatriculas((prev) => ({ ...prev, [e.id]: +ev.target.value || 0 }))} />
            </div>
          ))}
        </div>
      </section>

      {/* Secretaria */}
      <section className="rounded-lg border border-border bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold">Secretaria de Educação</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Secretário(a)"><Input value={edu.secretario} onChange={(e) => setEdu({ ...edu, secretario: e.target.value })} /></Field>
          <Field label="Cargo"><Input value={edu.cargo} onChange={(e) => setEdu({ ...edu, cargo: e.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={edu.email} onChange={(e) => setEdu({ ...edu, email: e.target.value })} /></Field>
          <Field label="Telefone"><Input value={edu.telefone} onChange={(e) => setEdu({ ...edu, telefone: e.target.value })} /></Field>
          <Field label="Horário de atendimento"><Input value={edu.horario} onChange={(e) => setEdu({ ...edu, horario: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={edu.status} onValueChange={(v: any) => setEdu({ ...edu, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sem_dados">Sem dados</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="validado">Validado</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Fonte"><Input value={edu.fonte} onChange={(e) => setEdu({ ...edu, fonte: e.target.value })} /></Field>
          <Field label="URL da fonte"><Input value={edu.fonte_url} onChange={(e) => setEdu({ ...edu, fonte_url: e.target.value })} /></Field>
        </div>
      </section>

      {/* Equipe */}
      <section className="rounded-lg border border-border bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Equipe (coordenadores, assistentes, etc.)</h3>
          <Button size="sm" variant="outline" onClick={() => setEquipe([...equipe, { nome: "", cargo: "", email: "", telefone: "" }])}>
            <Plus className="mr-1 h-4 w-4" /> Adicionar
          </Button>
        </div>
        {equipe.length === 0 && <p className="text-sm text-muted-foreground">Nenhum membro cadastrado.</p>}
        <div className="space-y-3">
          {equipe.map((m, idx) => (
            <div key={idx} className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr,1fr,1fr,1fr,auto]">
              <Input placeholder="Nome" value={m.nome} onChange={(e) => updateMember(idx, "nome", e.target.value)} />
              <Input placeholder="Cargo" value={m.cargo} onChange={(e) => updateMember(idx, "cargo", e.target.value)} />
              <Input placeholder="Email" value={m.email ?? ""} onChange={(e) => updateMember(idx, "email", e.target.value)} />
              <Input placeholder="Telefone" value={m.telefone ?? ""} onChange={(e) => updateMember(idx, "telefone", e.target.value)} />
              <Button size="icon" variant="ghost" onClick={() => setEquipe(equipe.filter((_, i) => i !== idx))}>
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3 pb-8">
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} size="lg">
          {saveMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar alterações
        </Button>
        {saveMut.data && <span className="text-sm text-emerald-700">✓ Salvo. Score recalculado: <strong>{saveMut.data.score}</strong> ({saveMut.data.faixa})</span>}
        {saveMut.error && <span className="text-sm text-red-600">{(saveMut.error as Error).message}</span>}
      </div>
    </div>
  );

  function updateMember(idx: number, field: string, value: string) {
    setEquipe(equipe.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
