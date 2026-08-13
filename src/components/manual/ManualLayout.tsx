import type { ReactNode } from "react";
import { Lightbulb, AlertTriangle, Info } from "lucide-react";

export type ManualSecao = { id: string; titulo: string };

export function ManualShell({
  titulo,
  subtitulo,
  secoes,
  children,
}: {
  titulo: string;
  subtitulo: string;
  secoes: ManualSecao[];
  children: ReactNode;
}) {
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-6 py-8 lg:grid-cols-[240px_1fr]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Neste manual
          </p>
          <nav className="space-y-1 text-sm">
            {secoes.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {s.titulo}
              </a>
            ))}
          </nav>
        </div>
      </aside>

      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{titulo}</h1>
          <p className="mt-2 text-muted-foreground">{subtitulo}</p>
        </div>
        <div className="space-y-8">{children}</div>
      </div>
    </div>
  );
}

export function Secao({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border border-border bg-white p-6">
      <h2 className="mb-4 text-xl font-bold tracking-tight">{titulo}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground">{children}</div>
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

export function Passos({ itens }: { itens: ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {itens.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {i + 1}
          </span>
          <span className="pt-0.5 text-sm leading-relaxed">{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function Lista({ itens }: { itens: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {itens.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Definicoes({ itens }: { itens: Array<{ termo: string; texto: ReactNode }> }) {
  return (
    <dl className="divide-y divide-border rounded-lg border border-border">
      {itens.map((d, i) => (
        <div key={i} className="grid gap-1 p-3 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt className="text-sm font-semibold">{d.termo}</dt>
          <dd className="text-sm text-muted-foreground">{d.texto}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Caixa({
  tipo = "dica",
  titulo,
  children,
}: {
  tipo?: "dica" | "aviso" | "info";
  titulo?: string;
  children: ReactNode;
}) {
  const estilos = {
    dica: { c: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: <Lightbulb className="h-4 w-4" /> },
    aviso: { c: "border-amber-200 bg-amber-50 text-amber-900", icon: <AlertTriangle className="h-4 w-4" /> },
    info: { c: "border-sky-200 bg-sky-50 text-sky-900", icon: <Info className="h-4 w-4" /> },
  }[tipo];
  return (
    <div className={`rounded-lg border p-3 text-sm ${estilos.c}`}>
      <div className="flex gap-2">
        <span className="mt-0.5 shrink-0">{estilos.icon}</span>
        <div>
          {titulo && <p className="font-semibold">{titulo}</p>}
          <div className="leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}
