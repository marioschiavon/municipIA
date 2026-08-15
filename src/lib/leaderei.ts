import type { ProspectResult } from "./prospect.types";

/** Origens que podem envolver a aplicação MunicipIA dentro do Leaderei. */
export function isLeadereiOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    // Aceita preview e publicação do Leaderei (todos os subdomínios .lovable.app).
    return url.hostname.endsWith(".lovable.app");
  } catch {
    return false;
  }
}

export type LeadereiSession = {
  token: string;
  company_id: string;
  ingest_url: string;
};

export type LeadereiEquipeMember = {
  nome?: string;
  cargo?: string | null;
  email?: string | null;
  telefone?: string | null;
};

export type LeadereiRow = {
  municipio: string;
  uf: string;
  buscadoEm: string;
  result: {
    secretario: string | null;
    cargo: string | null;
    emails: string[];
    telefones: string[];
    horarioAtendimento: string | null;
    equipe: LeadereiEquipeMember[];
    fonte: string | null;
    hierarquia: string;
  };
};

/** Constrói uma linha no formato esperado pelo edge function municipia-ingest do Leaderei. */
export function buildLeadereiRow(
  nome: string,
  uf: string,
  buscadoEm: string | null | undefined,
  result: Partial<ProspectResult> & {
    fonteUrl?: string | null;
  },
): LeadereiRow {
  const data = buscadoEm ?? result.dataReferencia ?? new Date().toISOString();
  return {
    municipio: nome.trim(),
    uf: uf.trim().toUpperCase(),
    buscadoEm: data,
    result: {
      secretario: result.secretario ?? null,
      cargo: result.cargo ?? null,
      emails: result.emails ?? [],
      telefones: result.telefones ?? [],
      horarioAtendimento: result.horarioAtendimento ?? null,
      equipe: (result.equipe ?? []).map((m) => ({
        nome: m.nome,
        cargo: m.cargo ?? null,
        email: m.email ?? null,
        telefone: m.telefone ?? null,
      })),
      fonte: result.fonteUrl ?? result.fonte ?? null,
      hierarquia: result.hierarquia ?? "educacao",
    },
  };
}

/** Verifica se a linha tem algum contato útil para enviar ao Leaderei. */
export function rowTemContato(row: LeadereiRow): boolean {
  const r = row.result;
  if (r.emails.length > 0 || r.telefones.length > 0) return true;
  if (r.secretario || r.equipe.some((m) => m.email || m.telefone)) return true;
  return false;
}
