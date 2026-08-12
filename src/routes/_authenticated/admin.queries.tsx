import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  adminGetQueryConfig,
  adminSaveQueryConfig,
  adminAmostraMunicipios,
} from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, Plus, Save, Trash2, Trophy, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/queries")({
  head: () => ({
    meta: [
      { title: "Teste de queries — MunicipIA Admin" },
      { name: "description", content: "Compare variações da busca por Visão Geral por IA e escolha a que mais acerta contatos." },
      { property: "og:title", content: "Teste de queries — MunicipIA Admin" },
      { property: "og:description", content: "Compare variações da busca e defina a query padrão de prospecção." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QueriesPage,
});

type Amostra = { ibgeId: number; nome: string; uf: string };

type ResultadoLinha = {
  variante: number;
  ibgeId: number;
  municipio: string;
  uf: string;
  temAiOverview: boolean;
  secretario: string | null;
  emails: string[];
  telefones: string[];
  fonteOficial: boolean;
  elapsedMs: number;
  erro: string | null;
};

function metricas(rows: ResultadoLinha[]) {
  const n = rows.length || 1;
  const nome = rows.filter((r) => !!r.secretario).length;
  const email = rows.filter((r) => r.emails.length > 0).length;
  const fone = rows.filter((r) => r.telefones.length > 0).length;
  const completo = rows.filter((r) => r.secretario && (r.emails.length > 0 || r.telefones.length > 0)).length;
  const falhas = rows.filter((r) => r.erro || !r.temAiOverview).length;
  const tempo = Math.round(rows.reduce((a, r) => a + r.elapsedMs, 0) / n);
  return {
    total: rows.length,
    nome: Math.round((nome / n) * 100),
    email: Math.round((email / n) * 100),
    fone: Math.round((fone / n) * 100),
    completo: Math.round((completo / n) * 100),
    falhas,
    tempo,
  };
}

function QueriesPage() {
  const qc = useQueryClient();
  const getCfg = useServerFn(adminGetQueryConfig);
  const saveCfg = useServerFn(adminSaveQueryConfig);
  const amostraFn = useServerFn(adminAmostraMunicipios);

  const cfg = useQuery({ queryKey: ["query-config"], queryFn: () => getCfg() });

  const [variantes, setVariantes] = useState<string[]>([]);
  const [queryPadrao, setQueryPadrao] = useState("");
  const [quantidade, setQuantidade] = useState(5);
  const [uf, setUf] = useState("");
  const [amostra, setAmostra] = useState<Amostra[]>([]);
  const [rodando, setRodando] = useState(false);
  const [atual, setAtual] = useState<string | null>(null);
  const [resultados, setResultados] = useState<ResultadoLinha[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (cfg.data) {
      setQueryPadrao(cfg.data.query);
      setVariantes(cfg.data.variantes.length > 0 ? cfg.data.variantes : [cfg.data.query]);
    }
  }, [cfg.data]);

  const save = useMutation({
    mutationFn: (patch: { query?: string; variantes?: string[] }) => saveCfg({ data: patch }),
    onSuccess: () => {
      toast.success("Configuração salva");
      qc.invalidateQueries({ queryKey: ["query-config"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao salvar"),
  });

  async function rodarTeste() {
    const vs = variantes.map((v) => v.trim()).filter((v) => v.length >= 5);
    if (vs.length === 0) return toast.error("Cadastre ao menos uma variação");
    setRodando(true);
    setResultados([]);
    setAtual("Selecionando amostra...");
    try {
      const { items } = await amostraFn({
        data: { quantidade, uf: uf.length === 2 ? uf.toUpperCase() : undefined, somenteSemDados: true },
      });
      if (items.length === 0) {
        toast.error("Nenhum município elegível para amostra");
        setRodando(false);
        setAtual(null);
        return;
      }
      setAmostra(items);

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const ac = new AbortController();
      abortRef.current = ac;

      const res = await fetch("/api/admin/query-test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          variantes: vs,
          municipios: items.map((m) => ({ ibgeId: m.ibgeId, nome: m.nome, uf: m.uf })),
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.kind === "start") {
            setAtual(`Variação ${evt.variante + 1} · ${evt.municipio}/${evt.uf}`);
          } else if (evt.kind === "log" && evt.evt?.message) {
            setAtual(evt.evt.message);
          } else if (evt.kind === "result") {
            setResultados((prev) => [
              ...prev,
              {
                variante: evt.variante,
                ibgeId: evt.ibgeId,
                municipio: evt.municipio,
                uf: evt.uf,
                temAiOverview: evt.res.temAiOverview,
                secretario: evt.res.secretario,
                emails: evt.res.emails ?? [],
                telefones: evt.res.telefones ?? [],
                fonteOficial: evt.res.fonteOficial,
                elapsedMs: evt.res.elapsedMs,
                erro: evt.res.erro,
              },
            ]);
          } else if (evt.kind === "error") {
            toast.error(evt.message);
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        toast.error(e instanceof Error ? e.message : "Falha no teste");
      }
    } finally {
      setRodando(false);
      setAtual(null);
      abortRef.current = null;
    }
  }

  const vs = variantes.map((v) => v.trim());
  const porVariante = vs.map((_, i) => metricas(resultados.filter((r) => r.variante === i)));
  const melhorIdx = (() => {
    let best = -1;
    let bestScore = -1;
    porVariante.forEach((m, i) => {
      if (m.total === 0) return;
      const s = m.completo * 100 + m.email * 10 + m.nome;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    return best;
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Teste de queries (Visão Geral por IA)</h1>
        <p className="text-sm text-muted-foreground">
          Compare formulações da busca e defina a que mais acerta contatos como padrão da prospecção. Use{" "}
          <code>{"{municipio}"}</code> e <code>{"{uf}"}</code> como marcadores.
        </p>
      </div>

      <section className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Query padrão em uso</h2>
          {cfg.data?.updatedAt && (
            <span className="text-xs text-muted-foreground">
              atualizada em {new Date(cfg.data.updatedAt).toLocaleString("pt-BR")}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Input value={queryPadrao} onChange={(e) => setQueryPadrao(e.target.value)} />
          <Button onClick={() => save.mutate({ query: queryPadrao })} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border p-4 space-y-3">
        <h2 className="font-medium">Variações a testar</h2>
        {variantes.map((v, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={v}
              onChange={(e) => setVariantes((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder="nome e contato do secretário(a) de educação de {municipio} {uf}"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setVariantes((prev) => prev.filter((_, j) => j !== i))}
              disabled={variantes.length <= 1}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setVariantes((p) => [...p, ""])} disabled={variantes.length >= 6}>
            <Plus className="mr-2 h-4 w-4" /> Adicionar variação
          </Button>
          <Button variant="outline" size="sm" onClick={() => save.mutate({ variantes: vs.filter((x) => x.length >= 5) })}>
            <Save className="mr-2 h-4 w-4" /> Salvar variações
          </Button>
        </div>
      </section>

      <section className="rounded-lg border p-4 space-y-3">
        <h2 className="font-medium">Amostra</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Municípios na amostra</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={quantidade}
              onChange={(e) => setQuantidade(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
              className="w-28"
            />
          </div>
          <div>
            <Label className="text-xs">UF (opcional)</Label>
            <Input value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} className="w-24" placeholder="Todas" />
          </div>
          {!rodando ? (
            <Button onClick={rodarTeste}>
              <Play className="mr-2 h-4 w-4" /> Rodar teste
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => abortRef.current?.abort()}>
              <X className="mr-2 h-4 w-4" /> Cancelar
            </Button>
          )}
          {rodando && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {atual}
            </span>
          )}
        </div>
        {amostra.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Amostra: {amostra.map((m) => `${m.nome}/${m.uf}`).join(", ")}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Os resultados do teste não são gravados no catálogo — servem só para comparar as queries.
        </p>
      </section>

      {resultados.length > 0 && (
        <section className="rounded-lg border p-4 space-y-4">
          <h2 className="font-medium">Resultados</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Variação</th>
                  <th className="p-2">Testados</th>
                  <th className="p-2">Nome</th>
                  <th className="p-2">E-mail</th>
                  <th className="p-2">Telefone</th>
                  <th className="p-2">Acerto completo</th>
                  <th className="p-2">Falhas</th>
                  <th className="p-2">Tempo médio</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {vs.map((v, i) => {
                  const m = porVariante[i]!;
                  const melhor = i === melhorIdx;
                  return (
                    <tr key={i} className={melhor ? "bg-primary/5" : undefined}>
                      <td className="p-2 max-w-[28rem]">
                        <div className="flex items-start gap-2">
                          {melhor && <Trophy className="mt-0.5 h-4 w-4 text-primary" />}
                          <span className="break-words">{v}</span>
                        </div>
                      </td>
                      <td className="p-2">{m.total}</td>
                      <td className="p-2">{m.nome}%</td>
                      <td className="p-2">{m.email}%</td>
                      <td className="p-2">{m.fone}%</td>
                      <td className="p-2 font-medium">{m.completo}%</td>
                      <td className="p-2">{m.falhas}</td>
                      <td className="p-2">{(m.tempo / 1000).toFixed(1)}s</td>
                      <td className="p-2">
                        <Button
                          size="sm"
                          variant={melhor ? "default" : "outline"}
                          disabled={m.total === 0 || save.isPending}
                          onClick={() => {
                            setQueryPadrao(v);
                            save.mutate({ query: v });
                          }}
                        >
                          Usar como padrão
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-medium">Detalhe por município</h3>
            {resultados.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 border-b py-1 text-xs">
                <Badge variant="outline">V{r.variante + 1}</Badge>
                <span className="font-medium">
                  {r.municipio}/{r.uf}
                </span>
                <span>{r.secretario ?? "sem nome"}</span>
                <span className="text-muted-foreground">
                  {r.emails.length} e-mail(s) · {r.telefones.length} telefone(s)
                </span>
                {r.fonteOficial && <Badge variant="secondary">fonte oficial</Badge>}
                {!r.temAiOverview && <Badge variant="destructive">sem Visão Geral por IA</Badge>}
                {r.erro && <span className="text-destructive">{r.erro}</span>}
                <span className="text-muted-foreground">{(r.elapsedMs / 1000).toFixed(1)}s</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
