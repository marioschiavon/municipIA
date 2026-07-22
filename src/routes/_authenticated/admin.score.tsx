import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { adminGetScoreConfig, adminSaveScoreConfig } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";

const MACRO = [
  { key: "porte", label: "Porte", hint: "População + matrículas totais" },
  { key: "financeiro", label: "Financeiro", hint: "FNDE anual" },
  { key: "completude", label: "Completude", hint: "Nome, email, telefone, equipe, etc." },
  { key: "recencia", label: "Recência", hint: "Quão atualizado está o dado" },
] as const;

const ETAPAS = [
  { key: "creche", label: "Creche (0-3)" },
  { key: "pre_escola", label: "Pré-escola (4-5)" },
  { key: "fundamental_ai", label: "Fundamental AI (6-10)" },
  { key: "fundamental_af", label: "Fundamental AF (11-14)" },
  { key: "medio", label: "Médio (15-17)" },
  { key: "eja", label: "EJA" },
  { key: "especial", label: "Especial" },
  { key: "profissionalizante", label: "Profissionalizante" },
];

export const Route = createFileRoute("/_authenticated/admin/score")({
  component: ScoreConfig,
});

function ScoreConfig() {
  const qc = useQueryClient();
  const getFn = useServerFn(adminGetScoreConfig);
  const saveFn = useServerFn(adminSaveScoreConfig);
  const cfg = useQuery({ queryKey: ["score-config"], queryFn: () => getFn() });

  const [macro, setMacro] = useState({ porte: 35, financeiro: 30, completude: 20, recencia: 15 });
  const [etapa, setEtapa] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!cfg.data) return;
    setMacro(cfg.data.pesos_macro as any);
    setEtapa(cfg.data.pesos_etapa as any);
  }, [cfg.data]);

  const totalMacro = Object.values(macro).reduce((a, b) => a + Number(b || 0), 0);

  const save = useMutation({
    mutationFn: () => saveFn({ data: { pesos_macro: macro, pesos_etapa: etapa } }),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (cfg.isLoading) return <div className="py-8 text-center"><Loader2 className="inline h-5 w-5 animate-spin" /></div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Pesos do score</h2>
        <p className="text-sm text-muted-foreground">Ajuste como cada dimensão contribui para o score de prospecção (0–100).</p>
      </div>

      <section className="rounded-lg border border-border bg-white p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h3 className="text-lg font-semibold">Pesos macro</h3>
          <span className={`text-sm ${totalMacro === 100 ? "text-emerald-700" : "text-amber-700"}`}>
            Soma: <strong>{totalMacro}</strong> {totalMacro !== 100 && "(recomendado: 100)"}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {MACRO.map((m) => (
            <div key={m.key} className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</Label>
              <Input type="number" min={0} max={100} value={macro[m.key]}
                onChange={(e) => setMacro({ ...macro, [m.key]: +e.target.value || 0 })} />
              <p className="text-xs text-muted-foreground">{m.hint}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-white p-6">
        <h3 className="mb-1 text-lg font-semibold">Pesos por etapa de ensino</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Multiplicador aplicado a cada etapa ao calcular o "porte" (peso 1.0 = neutro; 1.5 = dá 50% mais valor àquela etapa).
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ETAPAS.map((e) => (
            <div key={e.key} className="flex items-center gap-3">
              <span className="flex-1 text-sm">{e.label}</span>
              <Input className="w-24" type="number" min={0} max={5} step="0.1"
                value={etapa[e.key] ?? 1}
                onChange={(ev) => setEtapa({ ...etapa, [e.key]: +ev.target.value || 0 })} />
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar configuração
        </Button>
        {save.data && <span className="text-sm text-emerald-700">✓ Salvo</span>}
      </div>
    </div>
  );
}
