// Contexto compartilhado do lote de prospecção (/admin/prospeccao). Antes esse
// estado vivia como useState local dentro da página — ao navegar para outra
// aba do admin, o componente desmontava e a tela "sumia" (reaparecia zerada
// ao voltar), dando a impressão de que o lote tinha parado. Montando esse
// provider em admin.tsx (acima do <Outlet/>), o estado sobrevive à navegação
// entre páginas do admin — só reseta em reload/logout.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useProspectQueue, type QueueLogEntry } from "./use-prospect-queue";

export type FaseIsolada = "dominio" | "secretario" | "contato" | "completo";

/** Item da fila lateral de revisão — guarda a fase de origem, já que a fila sobrevive a novos lotes. */
export type RevisaoItem = QueueLogEntry & { fase: FaseIsolada };

// Fase 1/3 são baratas (sem IA ou regex-primeiro) — pausa curta. Fase 2 usa IA por
// candidato — pausa maior, pra não estourar rate limit do provider.
// "completo" roda as três etapas numa passada (inclui o ator de navegador real
// da Visão Geral por IA, que sozinho pode levar ~2min) — pausa maior entre municípios.
const FASE_INTERVALO_MS: Record<FaseIsolada, number> = {
  dominio: 2_000,
  secretario: 30_000,
  contato: 15_000,
  completo: 40_000,
};

type ProspeccaoLoteState = ReturnType<typeof useProspeccaoLoteState>;

function useProspeccaoLoteState() {
  const [fase, setFase] = useState<FaseIsolada>("dominio");
  const [uf, setUf] = useState("all");
  const [loteSize, setLoteSize] = useState(500);
  const [modo, setModo] = useState<"continuar" | "repescagem">("continuar");
  const [revisoes, setRevisoes] = useState<RevisaoItem[]>([]);
  // Municípios já tratados manualmente (chave `ibge:fase`). Sem isso, o efeito
  // abaixo reinsere o item na fila assim que `queue.log` muda de referência.
  const resolvidosRef = useRef<Set<string>>(new Set());
  const [lote, setLote] = useState<{ inicio: string; fim: string } | null>(null);

  const queue = useProspectQueue(FASE_INTERVALO_MS[fase]);

  // Toda entrada do log marcada como "revisar" entra (uma vez) na fila lateral.
  // Ela permanece lá mesmo depois de novos lotes até o admin tratar o município.
  useEffect(() => {
    const pendentes = queue.log.filter((e) => e.result?.revisar);
    if (pendentes.length === 0) return;
    setRevisoes((prev) => {
      const vistos = new Set(prev.map((r) => `${r.ibge_id}:${r.fase}`));
      const novos = pendentes
        .filter((e) => {
          const chave = `${e.ibge_id}:${fase}`;
          return !vistos.has(chave) && !resolvidosRef.current.has(chave);
        })
        .map((e) => ({ ...e, fase }) as RevisaoItem);
      return novos.length > 0 ? [...novos, ...prev] : prev;
    });
  }, [queue.log, fase]);

  function marcarResolvido(ibgeId: number, faseItem: FaseIsolada) {
    resolvidosRef.current.add(`${ibgeId}:${faseItem}`);
    setRevisoes((prev) => prev.filter((r) => !(r.ibge_id === ibgeId && r.fase === faseItem)));
  }

  return {
    fase,
    setFase,
    uf,
    setUf,
    loteSize,
    setLoteSize,
    modo,
    setModo,
    revisoes,
    marcarResolvido,
    lote,
    setLote,
    queue,
  };
}

const ProspeccaoLoteContext = createContext<ProspeccaoLoteState | null>(null);

export function ProspeccaoLoteProvider({ children }: { children: ReactNode }) {
  const state = useProspeccaoLoteState();
  return <ProspeccaoLoteContext.Provider value={state}>{children}</ProspeccaoLoteContext.Provider>;
}

export function useProspeccaoLote(): ProspeccaoLoteState {
  const ctx = useContext(ProspeccaoLoteContext);
  if (!ctx) throw new Error("useProspeccaoLote precisa estar dentro de <ProspeccaoLoteProvider>");
  return ctx;
}
