const KEY = "municipia:leaderei-enviados";

type Registro = Record<string, string>; // ibge_id -> ISO date

function ler(): Registro {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Registro;
  } catch {
    return {};
  }
}

export function getEnviados(): Registro {
  return ler();
}

export function marcarEnviados(ibgeIds: number[]): Registro {
  const atual = ler();
  const agora = new Date().toISOString();
  for (const id of ibgeIds) atual[String(id)] = agora;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(atual));
  } catch {
    /* noop */
  }
  return atual;
}

export function foiEnviado(reg: Registro, ibgeId: number): string | null {
  return reg[String(ibgeId)] ?? null;
}
