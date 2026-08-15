// Handshake postMessage com o Leaderei quando o MunicipIA roda dentro do iframe.

const LEADEREI_ORIGINS = [
  "https://app.leaderei.com.br",
  "https://leaderei-app.lovable.app",
  "https://id-preview--b5896184-51c5-4d86-ac16-a70f7aac80fb.lovable.app",
];

type Session = { token: string; company_id: string; ingest_url: string };

let session: Session | null = null;
let parentOrigin: string | null = null;
const listeners = new Set<(s: Session | null) => void>();

export function isEmbeddedInLeaderei() {
  return typeof window !== "undefined" && window.parent !== window;
}

export function getLeadereiSession() {
  return session;
}

export function onLeadereiSession(cb: (s: Session | null) => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function initLeadereiBridge() {
  if (typeof window === "undefined" || !isEmbeddedInLeaderei()) return;

  const handler = (event: MessageEvent) => {
    if (!LEADEREI_ORIGINS.includes(event.origin)) return;
    if (event.data?.type !== "leaderei:session") return;
    parentOrigin = event.origin;
    session = {
      token: event.data.token,
      company_id: event.data.company_id,
      ingest_url: event.data.ingest_url,
    };
    listeners.forEach((cb) => cb(session));
  };
  window.addEventListener("message", handler);

  // avisa o Leaderei que estamos prontos (repete algumas vezes caso o pai ainda não escute)
  let tries = 0;
  const ping = () => {
    LEADEREI_ORIGINS.forEach((o) => window.parent.postMessage({ type: "municipia:ready" }, o));
    if (++tries < 5 && !session) setTimeout(ping, 800);
  };
  ping();

  return () => window.removeEventListener("message", handler);
}

export async function sendToLeaderei(rows: unknown[], includeTeam = true) {
  if (!session) throw new Error("Sessão do Leaderei indisponível");
  const res = await fetch(session.ingest_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-municipia-token": session.token,
    },
    body: JSON.stringify({ rows, include_team: includeTeam }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Falha ao enviar para o Leaderei");
  return data as { created: number; updated: number; skipped: number };
}

export function leadereiParentOrigin() {
  return parentOrigin;
}
