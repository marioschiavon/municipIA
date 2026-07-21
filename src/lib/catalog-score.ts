// Cálculo do score de prospecção. Puro (client-safe).
// Fórmula documentada em .lovable/plan.md (Alpha v0.28).

export type ScoreBreakdown = {
  porte: number;        // 0..35
  financeiro: number;   // 0..30
  completude: number;   // 0..20
  recencia: number;     // 0..15
  total: number;        // 0..100
};

export type Faixa = "alto" | "medio" | "baixo";

export type ScoreInputs = {
  populacao: number;
  matriculas_total: number;
  fnde_anual: number;
  campos_preenchidos: number; // 0..6 (nome, cargo, email, telefone, horario, equipe>=1)
  atualizado_em: string | null; // ISO
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export function calcularScore(i: ScoreInputs): { score: number; faixa: Faixa; breakdown: ScoreBreakdown } {
  const pop = Math.max(0, i.populacao);
  const mat = Math.max(0, i.matriculas_total);
  const fnde = Math.max(0, i.fnde_anual);

  // Porte: mistura log(pop) e log(matriculas), normalizados
  const popNorm = clamp01((Math.log10(pop + 1) - 3) / 4); // 10³→0, 10⁷→1
  const matNorm = clamp01((Math.log10(mat + 1) - 2) / 4.5); // 10²→0, ~10⁶.5→1
  const porte = Math.round((popNorm * 0.55 + matNorm * 0.45) * 35);

  // Financeiro
  const fndeNorm = clamp01((Math.log10(fnde + 1) - 5) / 4); // 10⁵→0, 10⁹→1
  const financeiro = Math.round(fndeNorm * 30);

  // Completude
  const completude = Math.round((Math.min(6, i.campos_preenchidos) / 6) * 20);

  // Recência
  let recencia = 0;
  if (i.atualizado_em) {
    const dias = Math.max(0, (Date.now() - new Date(i.atualizado_em).getTime()) / 86400000);
    recencia = Math.round(clamp01(1 - dias / 180) * 15);
  }

  const total = porte + financeiro + completude + recencia;
  const faixa: Faixa = total >= 70 ? "alto" : total >= 40 ? "medio" : "baixo";
  return { score: total, faixa, breakdown: { porte, financeiro, completude, recencia, total } };
}

export function contarCampos(row: {
  secretario?: string | null;
  cargo?: string | null;
  email?: string | null;
  telefone?: string | null;
  horario?: string | null;
  equipe?: unknown[] | null;
}): number {
  let n = 0;
  if (row.secretario) n++;
  if (row.cargo) n++;
  if (row.email) n++;
  if (row.telefone) n++;
  if (row.horario) n++;
  if (row.equipe && row.equipe.length > 0) n++;
  return n;
}

export const FAIXA_LABEL: Record<Faixa, string> = {
  alto: "Alto potencial",
  medio: "Potencial médio",
  baixo: "Baixo potencial",
};
