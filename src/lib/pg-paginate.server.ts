// A Data API (PostgREST) devolve no MÁXIMO 1.000 linhas por requisição,
// independente do .range() pedido. Qualquer laço que pagine com páginas
// maiores que isso para na primeira volta ("veio menos que o pedido, acabou")
// e trunca silenciosamente o resultado. Estes helpers centralizam a paginação
// correta. Server-only.

export const PG_PAGE = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null };

/** Paginação por offset (.range). Use para tabelas de poucos milhares de linhas. */
export async function fetchAllByRange<T>(
  build: (from: number, to: number) => PromiseLike<Page<T>>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PG_PAGE) {
    const { data, error } = await build(from, from + PG_PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PG_PAGE) break;
  }
  return out;
}

/**
 * Paginação por chave (keyset). Use em tabelas grandes (centenas de milhares
 * de linhas) — offset profundo fica lento, keyset não.
 */
export async function fetchAllByKeyset<T>(
  build: (afterKey: number | null) => PromiseLike<Page<T>>,
  getKey: (row: T) => number,
  label: string,
  onPage?: (loaded: number) => void | Promise<void>,
): Promise<T[]> {
  const out: T[] = [];
  let afterKey: number | null = null;
  for (;;) {
    const { data, error } = await build(afterKey);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) break;
    out.push(...rows);
    afterKey = getKey(rows[rows.length - 1]);
    if (onPage) await onPage(out.length);
    if (rows.length < PG_PAGE) break;
  }
  return out;
}
