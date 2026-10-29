// Regras para identificar o(a) Secretário(a) titular da Educação dentro da equipe
// e evitar que ele(a) seja "rebaixado" para a equipe em novas buscas.

export type MembroEquipe = { nome: string; cargo: string | null; email?: string | null; telefone?: string | null };

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Cargo de titular: "Secretário(a) [Municipal] de/da Educação ...", sem adjunto/ex/suplente etc. */
export function isCargoTitularEducacao(cargo: string | null | undefined): boolean {
  if (!cargo) return false;
  const c = norm(cargo);
  if (!/\bsecretari[oa](\(a\))?\s+(municipal\s+)?(de\s+|da\s+)?educacao/.test(c)) return false;
  if (/(adjunt|executiv|subsecret|\bex[\s-]|suplente|representante|tecnic|tesoureir|estado|gabinete|citad|anterior)/.test(c)) return false;
  return true;
}

/** Mesma pessoa? Igualdade normalizada ou todos os tokens do nome menor contidos no maior. */
export function mesmaPessoa(a: string, b: string): boolean {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(" ").filter((t) => t.length >= 3);
  const tb = nb.split(" ").filter((t) => t.length >= 3);
  const [menor, maior] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return menor.length >= 2 && menor.every((t) => maior.includes(t));
}

/**
 * Normaliza titular x equipe:
 * - sem secretário nesta run → mantém o anterior;
 * - ainda sem secretário → promove o único titular de Educação achado na equipe;
 * - remove da equipe quem é o próprio titular (sem duplicar).
 */
export function normalizarTitular<M extends MembroEquipe>(input: {
  secretario: string | null | undefined;
  cargo: string | null | undefined;
  equipe: M[];
  secretarioAnterior?: string | null;
  cargoAnterior?: string | null;
}): { secretario: string | null; cargo: string | null; equipe: M[]; promovido: M | null } {
  let secretario = input.secretario?.trim() || null;
  let cargo = input.cargo?.trim() || null;
  if (!secretario && input.secretarioAnterior) {
    secretario = input.secretarioAnterior;
    cargo = cargo ?? input.cargoAnterior ?? null;
  }
  let promovido: M | null = null;
  const equipe = input.equipe ?? [];
  if (!secretario) {
    const titulares = equipe.filter((m) => m?.nome && isCargoTitularEducacao(m.cargo));
    // Só promove quando não há ambiguidade (todos os candidatos são a mesma pessoa).
    if (titulares.length > 0 && titulares.every((t) => mesmaPessoa(t.nome, titulares[0].nome))) {
      promovido = titulares.reduce((a, b) => (b.nome.length > a.nome.length ? b : a));
      secretario = promovido.nome;
      cargo = promovido.cargo ?? cargo;
    }
  }
  const novaEquipe = secretario ? equipe.filter((m) => !m?.nome || !mesmaPessoa(m.nome, secretario!)) : equipe;
  return { secretario, cargo, equipe: novaEquipe, promovido };
}
