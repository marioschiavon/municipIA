import type { ProspectResult } from "./prospect.types";

export const DIAS_ATUALIZACAO = 180;

/** Verifica se o município tem o trio completo (secretário + e-mail + telefone) e dados recentes. */
export function isDadosCompletos(
  educacao: {
    secretario?: string | null;
    emails?: string[];
    telefones?: string[];
    atualizado_em?: string | null;
  } | null | undefined,
): boolean {
  if (!educacao) return false;
  const temSecretario = !!educacao.secretario && educacao.secretario.trim().length > 0;
  const temEmail = (educacao.emails?.length ?? 0) > 0;
  const temTelefone = (educacao.telefones?.length ?? 0) > 0;
  if (!temSecretario || !temEmail || !temTelefone) return false;

  if (!educacao.atualizado_em) return false;
  const atualizado = new Date(educacao.atualizado_em).getTime();
  const limite = Date.now() - DIAS_ATUALIZACAO * 24 * 60 * 60 * 1000;
  return atualizado >= limite;
}

/** Lista o que está faltando para completar o trio. */
export function camposFaltando(
  educacao: {
    secretario?: string | null;
    emails?: string[];
    telefones?: string[];
  } | null | undefined,
): string[] {
  const faltando: string[] = [];
  if (!educacao?.secretario || educacao.secretario.trim().length === 0) faltando.push("secretário");
  if ((educacao?.emails?.length ?? 0) === 0) faltando.push("e-mail");
  if ((educacao?.telefones?.length ?? 0) === 0) faltando.push("telefone");
  return faltando;
}

/** Traduz as etapas técnicas do pipeline para frases simples e amigáveis. */
export function mensagemEtapaAmigavel(etapa?: string, ultimaMensagem?: string): string {
  switch (etapa) {
    case "init":
      return "Preparando busca…";
    case "educacao":
    case "nome":
      return "Buscando site oficial…";
    case "contato-secretario":
      return "Procurando secretário…";
    case "diario":
      return "Procurando nome no Diário Oficial…";
    case "fallback":
      return "Expandindo busca…";
    case "final":
      return ultimaMensagem?.toLowerCase().includes("salvo")
        ? "Salvando no catálogo…"
        : "Finalizando…";
    default:
      return "Buscando informações…";
  }
}

/** Resume um ProspectResult para a ficha pública. */
export function resumirResultado(result: ProspectResult | null | undefined): {
  status: "found" | "partial" | "not_found";
  faltando: string[];
  mensagem: string;
} {
  if (!result) {
    return { status: "not_found", faltando: [], mensagem: "Não foi possível encontrar informações." };
  }
  const faltando: string[] = [];
  if (!result.secretario || result.secretario.trim().length === 0) faltando.push("secretário");
  if ((result.emails?.length ?? 0) === 0) faltando.push("e-mail");
  if ((result.telefones?.length ?? 0) === 0) faltando.push("telefone");

  let mensagem: string;
  if (faltando.length === 0) {
    mensagem = "Encontramos os dados de contato da Secretaria de Educação.";
  } else if (faltando.length === 3) {
    mensagem = "Não encontramos informações de contato desta Secretaria de Educação.";
  } else {
    mensagem = `Faltou: ${faltando.join(", ")}.`;
  }
  return { status: result.status, faltando, mensagem };
}
