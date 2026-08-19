import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Lock } from "lucide-react";
import { useLeaderei } from "@/hooks/useLeaderei";

const LEADEREI_URL = "https://app.leaderei.com.br";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md text-center">{children}</div>
    </div>
  );
}

export function LeadereiGate({ children }: { children: ReactNode }) {
  const leaderei = useLeaderei();
  const [status, setStatus] = useState<"aguardando" | "conectado" | "bloqueado">("aguardando");

  useEffect(() => {
    if (leaderei.connected) {
      setStatus("conectado");
      return;
    }
    // Fora de um iframe: não há como receber sessão do Leaderei.
    if (typeof window !== "undefined" && window.parent === window.self) {
      setStatus("bloqueado");
      return;
    }
    // Dentro de um iframe: espera mais tempo, mas continua ouvindo depois
    // (se a sessão chegar mais tarde, o efeito roda de novo e libera).
    const t = setTimeout(() => setStatus("bloqueado"), 12000);
    return () => clearTimeout(t);
  }, [leaderei.connected]);

  if (status === "conectado") return <>{children}</>;

  if (status === "bloqueado") {
    return (
      <Shell>
        <Lock className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-foreground">
          Este aplicativo só funciona dentro do Leaderei
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          O MunicipIA não pode ser acessado diretamente. Abra o Leaderei e use o
          MunicipIA por lá.
        </p>
        <a
          href={LEADEREI_URL}
          target="_top"
          rel="noreferrer"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Abrir o Leaderei
        </a>
      </Shell>
    );
  }

  return (
    <Shell>
      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      <p className="mt-4 text-sm text-muted-foreground">Conectando ao Leaderei…</p>
    </Shell>
  );
}
