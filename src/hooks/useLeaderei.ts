import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { isLeadereiOrigin, buildLeadereiRow, type LeadereiSession, type LeadereiRow } from "@/lib/leaderei";

export function useLeaderei() {
  const [session, setSession] = useState<LeadereiSession | null>(null);
  const sentRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.parent === window.self) return;

    const handler = (event: MessageEvent) => {
      if (!isLeadereiOrigin(event.origin)) return;
      if (event.data?.type !== "leaderei:session") return;
      const payload = event.data as LeadereiSession & { type: string };
      if (!payload.token || !payload.ingest_url || !payload.company_id) return;
      setSession(payload);
    };

    window.addEventListener("message", handler);

    if (!sentRef.current) {
      sentRef.current = true;
      // O parent (Leaderei) responde com o token de ingestão.
      window.parent.postMessage({ type: "municipia:ready" }, "*");
    }

    return () => window.removeEventListener("message", handler);
  }, []);

  const sendRows = useCallback(async (rows: LeadereiRow[]) => {
    if (!session) {
      toast.error("Integração Leaderei", { description: "Aplicativo não está dentro do Leaderei." });
      return { success: false, error: "Sem sessão Leaderei" };
    }
    if (rows.length === 0) {
      toast.error("Integração Leaderei", { description: "Nenhum município para enviar." });
      return { success: false, error: "Nenhuma linha para enviar" };
    }
    try {
      const res = await fetch(session.ingest_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-municipia-token": session.token,
        },
        body: JSON.stringify({ rows, include_team: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; created?: number; updated?: number; skipped?: number };
      if (!res.ok) {
        const msg = data.error || `HTTP ${res.status}`;
        toast.error("Erro ao enviar para Leaderei", { description: msg });
        return { success: false, error: msg };
      }
      const total = (data.created ?? 0) + (data.updated ?? 0);
      toast.success("Enviado para Leaderei", {
        description: `${total} lead(s) importado(s).${data.skipped ? ` ${data.skipped} pulado(s).` : ""}`,
      });
      return { success: true, data };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro de rede";
      toast.error("Erro ao enviar para Leaderei", { description: msg });
      return { success: false, error: msg };
    }
  }, [session]);

  return { connected: !!session, session, sendRows, buildLeadereiRow };
}
