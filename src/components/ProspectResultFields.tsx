import { User, Mail, Phone, Users } from "lucide-react";
import type { ProspectResult } from "@/lib/prospect.types";

/** Mostra os campos encontrados logo após a prospecção, sem precisar recarregar. */
export function ProspectResultFields({ result }: { result: ProspectResult | null | undefined }) {
  if (!result) return null;
  const emails = result.emails ?? [];
  const telefones = result.telefones ?? [];
  const equipe = result.equipe ?? [];
  const nada = !result.secretario && emails.length === 0 && telefones.length === 0;
  if (nada) return null;

  return (
    <div className="mt-5 w-full space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-left">
      <Linha icon={<User className="h-4 w-4" />} label="Secretário(a)" value={result.secretario} />
      <Linha icon={<Mail className="h-4 w-4" />} label="E-mail" value={emails.length ? emails.join(", ") : null} mono />
      <Linha icon={<Phone className="h-4 w-4" />} label="Telefone" value={telefones.length ? telefones.join(", ") : null} />
      {equipe.length > 0 && (
        <Linha icon={<Users className="h-4 w-4" />} label="Equipe" value={`${equipe.length} contato(s)`} />
      )}
    </div>
  );
}

function Linha({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="flex items-center gap-1.5 text-muted-foreground">{icon}{label}</span>
      <span className={`text-right ${mono ? "font-mono text-xs" : "font-medium"}`}>{value || "—"}</span>
    </div>
  );
}
