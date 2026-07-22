import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminGetStats, adminResetDados, adminSyncIBGE } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Database, Users, Mail, GraduationCap, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const qc = useQueryClient();
  const statsFn = useServerFn(adminGetStats);
  const resetFn = useServerFn(adminResetDados);
  const syncFn = useServerFn(adminSyncIBGE);
  const [confirming, setConfirming] = useState(false);

  const stats = useQuery({ queryKey: ["admin-stats"], queryFn: () => statsFn() });

  const resetMut = useMutation({
    mutationFn: () => resetFn(),
    onSuccess: () => { qc.invalidateQueries(); setConfirming(false); },
  });
  const syncMut = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-sm text-muted-foreground">Visão geral do catálogo e ferramentas de manutenção.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={<Database />} label="Municípios cadastrados" value={stats.data?.total ?? 0} />
        <StatCard icon={<Users />} label="Com contatos" value={stats.data?.comContatos ?? 0} />
        <StatCard icon={<Mail />} label="Validados" value={stats.data?.validados ?? 0} accent="emerald" />
        <StatCard icon={<GraduationCap />} label="Com matrículas" value={stats.data?.comMatriculas ?? 0} accent="blue" />
      </div>

      <div className="rounded-lg border border-border bg-white p-6">
        <h3 className="text-lg font-semibold">Manutenção</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Sincronize a lista oficial do IBGE (adiciona apenas municípios faltantes) ou zere todos os dados quantitativos e de contato.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => syncMut.mutate()} disabled={syncMut.isPending} variant="outline">
            {syncMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Sincronizar IBGE
          </Button>
          {!confirming ? (
            <Button onClick={() => setConfirming(true)} variant="outline" className="border-red-200 text-red-700 hover:bg-red-50">
              <Trash2 className="mr-2 h-4 w-4" /> Zerar todos os dados
            </Button>
          ) : (
            <>
              <Button onClick={() => resetMut.mutate()} disabled={resetMut.isPending} variant="destructive">
                {resetMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar reset (irreversível)
              </Button>
              <Button onClick={() => setConfirming(false)} variant="ghost">Cancelar</Button>
            </>
          )}
          {syncMut.data && <span className="self-center text-sm text-emerald-700">✓ {syncMut.data.total} municípios sincronizados</span>}
          {resetMut.data && <span className="self-center text-sm text-emerald-700">✓ Dados zerados</span>}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-white p-6">
        <h3 className="text-lg font-semibold">Próximos passos</h3>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          <li>→ <Link to="/admin/municipios" className="text-primary hover:underline">Editar municípios</Link> — inserir dados reais de IBGE (população/PIB), INEP (matrículas por etapa, escolas) e FNDE (repasses).</li>
          <li>→ <Link to="/admin/score" className="text-primary hover:underline">Configurar pesos do score</Link> — ajustar como cada indicador impacta o ranking.</li>
        </ul>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: "emerald" | "blue" }) {
  const color = accent === "emerald" ? "text-emerald-700 bg-emerald-50" : accent === "blue" ? "text-blue-700 bg-blue-50" : "text-slate-700 bg-slate-100";
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className={`inline-flex rounded-md p-2 ${color}`}>{icon}</div>
      <div className="mt-3 text-2xl font-bold tabular-nums">{value.toLocaleString("pt-BR")}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
