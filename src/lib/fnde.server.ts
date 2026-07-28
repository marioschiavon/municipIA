// Busca o valor do FUNDEB (últimos 12 meses) direto da API de dados abertos
// do Tesouro Nacional (SICONFI/RREO) — dado oficial, autodeclarado pela própria
// prefeitura, sem scraping de HTML nem IA. Server-only.

const BASE_URL = "https://apidatalake.tesouro.gov.br/ords/cdwhprd/siconfi/tt/rreo";
const ANEXO = "RREO-Anexo 03";
const CONTA_FUNDEB = "RREO3TransferenciasDoFUNDEB";
const COLUNA_TOTAL_12M = "TOTAL (ÚLTIMOS 12 MESES)";

type RreoItem = {
  cod_conta?: string;
  coluna?: string;
  valor?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRreo(ibgeId: number, ano: number, periodo: number): Promise<RreoItem[] | null> {
  const url = `${BASE_URL}?an_exercicio=${ano}&nr_periodo=${periodo}&co_tipo_demonstrativo=RREO&id_ente=${ibgeId}&co_esfera=M&no_anexo=${encodeURIComponent(ANEXO)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: RreoItem[] };
    return json.items ?? [];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFundebAtual(
  ibgeId: number,
): Promise<{ ano: number; periodo: number; valor: number } | null> {
  const anoAtual = new Date().getFullYear();
  let first = true;
  for (const ano of [anoAtual, anoAtual - 1]) {
    for (let periodo = 6; periodo >= 1; periodo--) {
      if (!first) await sleep(1100); // respeita limite de 1 req/s da API
      first = false;
      const items = await fetchRreo(ibgeId, ano, periodo);
      if (!items || items.length === 0) continue;
      const linha = items.find((i) => i.cod_conta === CONTA_FUNDEB && i.coluna === COLUNA_TOTAL_12M);
      if (linha && typeof linha.valor === "number") {
        return { ano, periodo, valor: linha.valor };
      }
    }
  }
  return null;
}
