// Fila sequencial (com pausa entre municípios) para rodar /api/prospect em lote —
// compartilhada entre a lista de municípios (modo "completo") e a aba de
// prospecção em fases (/admin/prospeccao). Extraída de admin.municipios.index.tsx.
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ProspectResult } from "./prospect.types";

export type ProspectFase = "completo" | "dominio" | "secretario" | "contato";
export type QueueMunicipio = { ibge_id: number; nome: string; uf: string };
export type QueueLogEntry = {
  ibge_id: number;
  nome: string;
  uf: string;
  status: "found" | "partial" | "not_found" | "error";
  detalhe?: string;
  /** Motivo legível quando o status não é "found" (contexto do resultado + último aviso da fase). */
  motivo?: string | null;
  result?: ProspectResult;
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Cancelado", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Cancelado", "AbortError"));
    }, { once: true });
  });
}

async function processarUm(
  m: QueueMunicipio,
  fase: ProspectFase,
  provider: "firecrawl" | "apify",
  signal: AbortSignal,
): Promise<QueueLogEntry> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("Sessão não encontrada. Faça login novamente.");
    const res = await fetch("/api/prospect", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ municipio: m.nome, uf: m.uf, ibgeId: m.ibge_id, fase, provider }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finalStatus: QueueLogEntry["status"] = "not_found";
    let result: ProspectResult | undefined;
    let erroProvedor: string | null = null;
    let ultimoAviso: string | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try {
          const evt = JSON.parse(s);
          if (evt.kind === "final") {
            finalStatus = evt.result?.status ?? "not_found";
            result = evt.result;
          } else if (evt.kind === "progress" && evt.level === "error") {
            // Falha real (provedor sem crédito, auth, rede) — não é "não encontrei".
            erroProvedor = [evt.message, typeof evt.data === "string" ? evt.data : null].filter(Boolean).join(" — ");
          } else if (evt.kind === "progress" && evt.level === "warn") {
            // Último aviso serve de motivo quando a fase termina sem encontrar nada.
            ultimoAviso = String(evt.message ?? "").slice(0, 200) || ultimoAviso;
          }
        } catch { /* noop */ }
      }
    }
    if (erroProvedor) {
      return { ibge_id: m.ibge_id, nome: m.nome, uf: m.uf, status: "error", detalhe: erroProvedor.slice(0, 200), result, motivo: erroProvedor.slice(0, 300) };
    }
    const contatos = (result?.emails?.length ?? 0) + (result?.telefones?.length ?? 0);
    const motivo =
      finalStatus === "found"
        ? null
        : [result?.contexto ?? null, ultimoAviso].filter(Boolean).join(" · ").slice(0, 300) || null;
    const detalhe =
      fase === "dominio"
        ? (result?.dominioOficialConfirmado ?? (finalStatus === "found" ? "domínio confirmado" : ""))
        : fase === "secretario"
          ? (result?.secretario ?? "")
          : `${contatos} contato(s)`;
    return { ibge_id: m.ibge_id, nome: m.nome, uf: m.uf, status: finalStatus, detalhe: detalhe || undefined, result, motivo };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { ibge_id: m.ibge_id, nome: m.nome, uf: m.uf, status: "error", detalhe: e instanceof Error ? e.message : "Falha" };
  }
}

/** Fila sequencial de prospecção com pausa `intervalMs` entre municípios. */
export function useProspectQueue(intervalMs: number) {
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [current, setCurrent] = useState<QueueMunicipio | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [log, setLog] = useState<QueueLogEntry[]>([]);
  const [loadingIds, setLoadingIds] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function iniciar(
    items: QueueMunicipio[],
    fase: ProspectFase,
    provider: "firecrawl" | "apify" = "apify",
    onDone?: () => void,
  ) {
    if (items.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setTotal(items.length);
    setDone(0);
    setLog([]);
    setRunning(true);
    try {
      for (let i = 0; i < items.length; i++) {
        if (controller.signal.aborted) break;
        const m = items[i];
        setCurrent(m);
        const entry = await processarUm(m, fase, provider, controller.signal);
        setLog((prev) => [entry, ...prev].slice(0, 300));
        setDone((d) => d + 1);
        if (i < items.length - 1) {
          setWaiting(true);
          await sleep(intervalMs, controller.signal);
          setWaiting(false);
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) throw e;
    } finally {
      setRunning(false);
      setWaiting(false);
      setCurrent(null);
      abortRef.current = null;
      onDone?.();
    }
  }

  function cancelar() {
    abortRef.current?.abort();
  }

  return { running, total, done, current, waiting, log, setLog, loadingIds, setLoadingIds, iniciar, cancelar };
}
