import { useRef, useState, useCallback } from "react";
import type { ProspectResult } from "./prospect.types";
import { mensagemEtapaAmigavel } from "./prospect-completeness";

export type StreamStep = {
  kind: "progress" | "final";
  message?: string;
  level?: "info" | "success" | "warn" | "error";
  result?: ProspectResult;
};

export type ProspectStreamState = {
  running: boolean;
  step: StreamStep | null;
  error: string | null;
  result: ProspectResult | null;
};

/** Consome o stream NDJSON de um único município, sem fila. */
export function useProspectStream() {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<StreamStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProspectResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (
    municipio: string,
    uf: string,
    ibgeId: number,
    options: { endpoint?: string; token?: string | null } = {},
  ): Promise<ProspectResult | null> => {
    let finalResult: ProspectResult | null = null;
    const endpoint = options.endpoint ?? "/api/public/prospect";
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setStep(null);
    setError(null);
    setResult(null);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.token) headers["Authorization"] = `Bearer ${options.token}`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ municipio, uf, ibgeId, fase: "completo" }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let lastProgress: { etapa?: string; message?: string } | null = null;
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
              finalResult = evt.result ?? null;
              setResult(evt.result);
              setStep({ kind: "final", result: evt.result });
            } else if (evt.kind === "progress") {
              lastProgress = { etapa: evt.etapa, message: evt.message };
              setStep({
                kind: "progress",
                message: mensagemEtapaAmigavel(evt.etapa, evt.message),
                level: evt.level,
              });
            }
          } catch { /* noop */ }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Busca cancelada.");
      } else {
        setError(e instanceof Error ? e.message : "Falha na busca");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { running, step, error, result, run, cancel };
}
