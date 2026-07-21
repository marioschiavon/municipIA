// Gerador determinístico de dados mocados para o catálogo. Server-only.
// Usa o ibge_id como seed do PRNG (mulberry32) para gerar números
// plausíveis por porte da cidade.

import { calcularScore, contarCampos } from "./catalog-score";

function mulberry32(a: number) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// População aleatória com curva log realista (maioria pequena, poucas grandes).
function mockPopulacao(rnd: () => number): number {
  // 90% entre 2k e 60k, 8% entre 60k e 500k, 2% >500k
  const r = rnd();
  if (r < 0.9) return Math.floor(2_000 + rnd() * 58_000);
  if (r < 0.98) return Math.floor(60_000 + rnd() * 440_000);
  return Math.floor(500_000 + rnd() * 3_500_000);
}

export type MockRow = {
  ibge_id: number;
  populacao: number;
  matriculas_total: number;
  escolas: number;
  fnde_anual: number;
  pib_percapita: number;
  educacao: {
    secretario: string | null;
    cargo: string | null;
    email: string | null;
    telefone: string | null;
    horario: string | null;
    equipe: Array<{ nome: string; cargo: string; email?: string | null; telefone?: string | null }>;
    fonte: string | null;
    fonte_url: string | null;
    status: "validado" | "pendente" | "sem_dados";
    atualizado_em: string | null;
    score: number;
    faixa: "alto" | "medio" | "baixo";
    breakdown: Record<string, number>;
  };
};

const NOMES = [
  "Maria Silva", "João Pereira", "Ana Costa", "Carlos Oliveira", "Fernanda Souza",
  "Roberto Almeida", "Juliana Rocha", "Paulo Santos", "Adriana Lima", "Rafael Martins",
  "Patrícia Nunes", "Bruno Carvalho", "Camila Ribeiro", "Diego Ferreira", "Luciana Mendes",
];
const CARGOS_EQUIPE = [
  "Coordenador(a) Pedagógico(a)",
  "Diretor(a) de Ensino",
  "Assessor(a) Técnico(a)",
  "Supervisor(a) de Educação Infantil",
  "Chefe de Gabinete",
  "Analista de Programas Educacionais",
];

export function gerarMock(ibgeId: number, nome: string, uf: string, slug: string): MockRow {
  const rnd = mulberry32(ibgeId);
  const populacao = mockPopulacao(rnd);
  // matrículas ~ 18% da pop; escolas ~ 1 a cada 400 hab
  const matriculas_total = Math.floor(populacao * (0.14 + rnd() * 0.08));
  const escolas = Math.max(1, Math.floor(populacao / (300 + rnd() * 300)));
  // FNDE anual: aproximação de R$ 4.500 por matrícula
  const fnde_anual = Math.floor(matriculas_total * (3_800 + rnd() * 2_000));
  const pib_percapita = Math.floor(12_000 + rnd() * 45_000);

  // Distribuição de status
  const bucket = Math.floor(rnd() * 100);
  const status: MockRow["educacao"]["status"] =
    bucket < 60 ? "validado" : bucket < 85 ? "pendente" : "sem_dados";

  const dom = `${slug}.${uf.toLowerCase()}.gov.br`;
  let secretario: string | null = null;
  let cargo: string | null = null;
  let email: string | null = null;
  let telefone: string | null = null;
  let horario: string | null = null;
  let equipe: MockRow["educacao"]["equipe"] = [];
  let fonte: string | null = null;
  let fonte_url: string | null = null;
  let atualizado_em: string | null = null;

  if (status !== "sem_dados") {
    secretario = NOMES[Math.floor(rnd() * NOMES.length)];
    cargo = "Secretário(a) Municipal de Educação";
    if (status === "validado") {
      email = `seduc@${dom}`;
      const ddd = 11 + Math.floor(rnd() * 88);
      const num = 30000000 + Math.floor(rnd() * 69999999);
      telefone = `(${ddd}) ${String(num).slice(0, 4)}-${String(num).slice(4, 8)}`;
      horario = "Segunda a sexta, 8h às 17h";
      const nEquipe = 2 + Math.floor(rnd() * 3);
      for (let i = 0; i < nEquipe; i++) {
        equipe.push({
          nome: NOMES[Math.floor(rnd() * NOMES.length)],
          cargo: CARGOS_EQUIPE[Math.floor(rnd() * CARGOS_EQUIPE.length)],
        });
      }
      fonte = "seed:mock";
      fonte_url = `https://www.${dom}/secretarias/educacao`;
      // Data entre 1 e 180 dias atrás
      const diasAtras = 1 + Math.floor(rnd() * 179);
      atualizado_em = new Date(Date.now() - diasAtras * 86400000).toISOString();
    } else {
      // pendente: só nome, sem contato
      fonte = "seed:mock-pendente";
    }
  }

  const campos = contarCampos({ secretario, cargo, email, telefone, horario, equipe });
  const { score, faixa, breakdown } = calcularScore({
    populacao,
    matriculas_total,
    fnde_anual,
    campos_preenchidos: campos,
    atualizado_em,
  });

  return {
    ibge_id: ibgeId,
    populacao,
    matriculas_total,
    escolas,
    fnde_anual,
    pib_percapita,
    educacao: {
      secretario, cargo, email, telefone, horario, equipe, fonte, fonte_url,
      status, atualizado_em, score, faixa, breakdown,
    },
  };
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
