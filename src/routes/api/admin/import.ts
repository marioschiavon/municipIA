import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import Papa from "papaparse";
import * as XLSX from "xlsx";

// Mapeamento das colunas agregadas do Censo Escolar (Tabela_Matricula) para etapas internas.
// Fonte: dicionário oficial INEP - Censo Escolar (arquivo Matricula por escola).
const ETAPA_COLS: Record<string, string[]> = {
  creche: ["QT_MAT_INF_CRE"],
  pre_escola: ["QT_MAT_INF_PRE"],
  fundamental_ai: ["QT_MAT_FUND_AI"],
  fundamental_af: ["QT_MAT_FUND_AF"],
  medio: ["QT_MAT_MED"],
  eja: ["QT_MAT_EJA"],
  especial: ["QT_MAT_ESP"],
  profissionalizante: ["QT_MAT_PROF"],
};

export const Route = createFileRoute("/api/admin/import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            async function send(event: { type: string; message: string; data?: unknown }) {
              controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
            }
            try {
              const auth = request.headers.get("authorization") ?? "";
              const token = auth.replace(/^Bearer\s+/i, "");
              if (!token) {
                await send({ type: "error", message: "Token de autenticação ausente" });
                controller.close();
                return;
              }
              const supabaseUser = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
                auth: { persistSession: false, autoRefreshToken: false },
              });
              const { data: userData, error: userError } = await supabaseUser.auth.getUser(token);
              if (userError || !userData.user) {
                await send({ type: "error", message: "Sessão inválida" });
                controller.close();
                return;
              }
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
              if (!isAdmin) {
                await send({ type: "error", message: "Acesso restrito a administradores" });
                controller.close();
                return;
              }
              const form = await request.formData();
              const type = form.get("type") as "inep_escolas" | "inep_matriculas" | "fnde";
              const file = form.get("file");
              if (!type || !(file instanceof File)) {
                await send({ type: "error", message: "Tipo ou arquivo inválido" });
                controller.close();
                return;
              }
              await send({ type: "start", message: "Iniciando importação", data: { type } });
              const buffer = await file.arrayBuffer();
              const content = new Uint8Array(buffer);
              await send({
                type: "progress",
                message: `Arquivo lido: ${(file.size / 1024 / 1024).toFixed(2)} MB`,
                data: { name: file.name, sizeBytes: file.size, selectedType: type },
              });

              if (type === "inep_escolas") {
                await processInepEscolas(content, supabaseAdmin, send);
              } else if (type === "inep_matriculas") {
                await processInepMatriculas(content, supabaseAdmin, send);
              } else {
                await processFnde(content, supabaseAdmin, send, file.name);
              }
              await send({ type: "recalc", message: "Recalculando scores em massa..." });
              const recalc = await recalcScores(supabaseAdmin);
              await send({ type: "done", message: "Importação finalizada", data: recalc });
              controller.close();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              await send({ type: "error", message: msg });
              controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
        });
      },
    },
  },
});

function decodeCsv(content: Uint8Array): string {
  // INEP publica em UTF-8; alguns arquivos vêm em Latin1. Detecta pelo BOM ou por caracteres inválidos.
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(content);
    if (!utf8.includes("\uFFFD")) return utf8;
  } catch {}
  return new TextDecoder("latin1").decode(content);
}

function parseCsvAuto(text: string): { rows: Record<string, string>[]; delimiter: string; headers: string[] } {
  // Remove BOM.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const candidates = [";", ",", "\t", "|"];
  let best: { rows: Record<string, string>[]; delimiter: string; headers: string[] } | null = null;
  for (const d of candidates) {
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, delimiter: d });
    const rows = parsed.data as Record<string, string>[];
    const headers = parsed.meta.fields ?? Object.keys(rows[0] ?? {});
    const cleanHeaders = headers.map((h) => h.replace(/^\uFEFF/, "").trim());
    // Renomeia chaves das linhas com headers limpos (BOM strip).
    const cleanRows = rows.map((r) => {
      const o: Record<string, string> = {};
      for (const k of headers) o[k.replace(/^\uFEFF/, "").trim()] = r[k];
      return o;
    });
    if (!best || cleanHeaders.length > best.headers.length) {
      best = { rows: cleanRows, delimiter: d, headers: cleanHeaders };
    }
  }
  return best!;
}

function detectDelimiterFromHeader(headerLine: string): string {
  const candidates = [";", ",", "\t", "|"];
  return candidates.reduce((best, current) => (headerLine.split(current).length > headerLine.split(best).length ? current : best), candidates[0]);
}

function cleanHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim();
}

function parseHeaderOnly(text: string): { delimiter: string; headers: string[]; firstDataValues: string[]; dataLineCount: number } {
  const firstBreak = text.indexOf("\n");
  const headerLine = (firstBreak >= 0 ? text.slice(0, firstBreak) : text).replace(/\r$/, "");
  const delimiter = detectDelimiterFromHeader(headerLine);
  const headers = headerLine.split(delimiter).map(cleanHeader);
  let firstDataValues: string[] = [];
  let dataLineCount = 0;
  let start = firstBreak >= 0 ? firstBreak + 1 : text.length;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end).replace(/\r$/, "");
    if (line.trim()) {
      dataLineCount++;
      if (firstDataValues.length === 0) firstDataValues = line.split(delimiter);
    }
    start = end + 1;
  }
  return { delimiter, headers, firstDataValues, dataLineCount };
}

function pickHeader(headers: string[], candidates: string[]): string | undefined {
  for (const c of candidates) {
    const found = headers.find((h) => h.toUpperCase() === c.toUpperCase());
    if (found) return found;
  }
  return undefined;
}

function headerIndex(headers: string[], key: string | undefined): number {
  if (!key) return -1;
  return headers.findIndex((h) => h.toUpperCase() === key.toUpperCase());
}

function valueAt(values: string[], index: number): string {
  return index >= 0 ? (values[index] ?? "") : "";
}

function numberAt(values: string[], index: number, fallback = 0): number {
  if (index < 0) return fallback;
  const value = Number(values[index]);
  return Number.isFinite(value) ? value : fallback;
}

function detectInepType(headers: string[]): "inep_escolas" | "inep_matriculas" | "unknown" {
  const set = new Set(headers.map((h) => h.toUpperCase()));
  const hasMatCols = ["QT_MAT_INF_CRE", "QT_MAT_FUND_AI", "QT_MAT_MED", "QT_MAT_INF_PRE"].some((c) => set.has(c));
  if (hasMatCols) return "inep_matriculas";
  if (set.has("TP_DEPENDENCIA") && (set.has("NO_ENTIDADE") || set.has("TP_SITUACAO_FUNCIONAMENTO") || set.has("TP_SITUACAO"))) {
    return "inep_escolas";
  }
  return "unknown";
}

function pickField(row: Record<string, string>, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const found = keys.find((k) => k.toUpperCase() === c.toUpperCase());
    if (found) return found;
  }
  return undefined;
}

type InepEscolaMapRow = {
  co_entidade: number;
  ibge_id: number;
  tp_dependencia: number;
  tp_situacao: number;
};

function numberFrom(row: Record<string, string>, key: string | undefined, fallback = 0): number {
  if (!key) return fallback;
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : fallback;
}

async function loadInepEscolaMap(supabaseAdmin: any, send: any): Promise<Map<number, InepEscolaMapRow>> {
  const map = new Map<number, InepEscolaMapRow>();
  const pageSize = 10000;
  let from = 0;

  await send({
    type: "progress",
    message: "Carregando mapa Escola → Município importado anteriormente (tabela INEP — Escolas)...",
  });

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("inep_escolas")
      .select("co_entidade, ibge_id, tp_dependencia, tp_situacao")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`inep_escolas/mapa: ${error.message}`);

    const rows = (data ?? []) as InepEscolaMapRow[];
    for (const row of rows) {
      if (row.co_entidade && row.ibge_id) map.set(Number(row.co_entidade), row);
    }

    if (from === 0 || rows.length < pageSize) {
      await send({
        type: "progress",
        message: `Mapa carregado: ${map.size.toLocaleString("pt-BR")} escolas disponíveis para cruzamento.`,
      });
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return map;
}

async function processInepEscolas(content: Uint8Array, supabaseAdmin: any, send: any) {
  const text = decodeCsv(content);
  const { rows, delimiter, headers } = parseCsvAuto(text);
  await send({
    type: "progress",
    message: `Headers detectados (delimitador="${delimiter === "\t" ? "\\t" : delimiter}", ${headers.length} colunas).`,
    data: { delimiter, headers: headers.slice(0, 20) },
  });
  await send({ type: "progress", message: `${rows.length.toLocaleString("pt-BR")} escolas detectadas no arquivo.` });
  if (!rows.length) throw new Error("Arquivo vazio ou formato inválido");

  const detected = detectInepType(headers);
  if (detected === "inep_matriculas") {
    throw new Error("Arquivo parece ser Tabela_Matricula (contém colunas QT_MAT_*). Selecione 'INEP — Matrículas' no seletor.");
  }

  const sample = rows[0];
  const coEntidadeKey = pickField(sample, ["CO_ENTIDADE"]);
  const coMunicipioKey = pickField(sample, ["CO_MUNICIPIO", "CO_MUNICIPIO_IBGE"]);
  const tpDepKey = pickField(sample, ["TP_DEPENDENCIA"]);
  const tpSitKey = pickField(sample, ["TP_SITUACAO_FUNCIONAMENTO", "TP_SITUACAO"]);
  if (!coEntidadeKey || !coMunicipioKey || !tpDepKey) {
    throw new Error(`Colunas obrigatórias ausentes. Necessárias: CO_ENTIDADE, CO_MUNICIPIO(_IBGE), TP_DEPENDENCIA. Encontradas: ${headers.slice(0, 10).join(", ")}...`);
  }
  const anoCol = pickField(sample, ["NU_ANO_CENSO"]);
  const ano = anoCol ? Number(sample[anoCol]) || new Date().getFullYear() : new Date().getFullYear();

  const escolasRows: { co_entidade: number; ibge_id: number; tp_dependencia: number; tp_situacao: number; ano: number }[] = [];
  const municipais = new Map<number, number>();
  let ignored = 0;
  let countDep3 = 0;
  let countSit1 = 0;
  const sampleIgnored: Record<string, string>[] = [];

  for (const r of rows) {
    const co = numberFrom(r, coEntidadeKey);
    const ibge = numberFrom(r, coMunicipioKey);
    const dep = numberFrom(r, tpDepKey);
    const sit = tpSitKey ? numberFrom(r, tpSitKey, 1) : 1;
    if (!co || !ibge || !dep) {
      ignored++;
      if (sampleIgnored.length < 3) {
        sampleIgnored.push({
          CO_ENTIDADE: r[coEntidadeKey] ?? "",
          CO_MUNICIPIO: r[coMunicipioKey] ?? "",
          TP_DEPENDENCIA: r[tpDepKey] ?? "",
          TP_SITUACAO: tpSitKey ? (r[tpSitKey] ?? "") : "sem_coluna",
        });
      }
      continue;
    }
    escolasRows.push({ co_entidade: co, ibge_id: ibge, tp_dependencia: dep, tp_situacao: sit, ano });
    if (dep === 3) countDep3++;
    if (sit === 1) countSit1++;
    if (dep === 3 && sit === 1) municipais.set(ibge, (municipais.get(ibge) ?? 0) + 1);
  }
  await send({
    type: "progress",
    message: `${escolasRows.length.toLocaleString("pt-BR")} escolas válidas · dep=3: ${countDep3.toLocaleString("pt-BR")} · sit=1: ${countSit1.toLocaleString("pt-BR")} · municipais ativas: ${Array.from(municipais.values()).reduce((a,b)=>a+b,0).toLocaleString("pt-BR")} em ${municipais.size.toLocaleString("pt-BR")} municípios.`,
    data: { ignored, sampleIgnored },
  });

  const BATCH = 1000;
  for (let i = 0; i < escolasRows.length; i += BATCH) {
    const slice = escolasRows.slice(i, i + BATCH);
    const { error } = await supabaseAdmin.from("inep_escolas").upsert(slice, { onConflict: "co_entidade" });
    if (error) throw new Error(`inep_escolas: ${error.message}`);
    if (i % (BATCH * 10) === 0) {
      await send({ type: "progress", message: `Mapeadas ${Math.min(i + BATCH, escolasRows.length).toLocaleString("pt-BR")} de ${escolasRows.length.toLocaleString("pt-BR")} escolas...` });
    }
  }

  const CONC = 20;
  const entries = Array.from(municipais.entries());
  let idx = 0;
  let updated = 0;
  let notFound = 0;
  const sampleNotFound: number[] = [];
  async function worker() {
    while (idx < entries.length) {
      const i = idx++;
      const [ibge, count] = entries[i];
      const { data, error } = await supabaseAdmin.from("municipios").update({ escolas: count }).eq("ibge_id", ibge).select("ibge_id").maybeSingle();
      if (error) throw new Error(`municipios ${ibge}: ${error.message}`);
      if (data) updated++;
      else {
        notFound++;
        if (sampleNotFound.length < 5) sampleNotFound.push(ibge);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  const amostra = entries.slice(0, 3).map(([ibge, c]) => `${ibge}=${c}`).join(", ");
  await send({
    type: "progress",
    message: `Contagem de escolas municipais atualizada em ${updated.toLocaleString("pt-BR")} municípios (amostra: ${amostra}). Ignoradas: ${ignored.toLocaleString("pt-BR")}. Não encontrados no catálogo: ${notFound.toLocaleString("pt-BR")}.`,
    data: { sampleNotFound },
  });
}

async function processInepMatriculas(content: Uint8Array, supabaseAdmin: any, send: any) {
  const text = decodeCsv(content);
  const { delimiter, headers, firstDataValues, dataLineCount } = parseHeaderOnly(text);
  await send({
    type: "progress",
    message: `Headers detectados (delimitador="${delimiter === "\t" ? "\\t" : delimiter}", ${headers.length} colunas).`,
    data: { delimiter, headers: headers.slice(0, 40) },
  });
  await send({ type: "progress", message: `${dataLineCount.toLocaleString("pt-BR")} linhas detectadas no arquivo (processamento por streaming interno, sem carregar tudo em memória).` });
  if (!dataLineCount || firstDataValues.length === 0) throw new Error("Arquivo vazio ou formato inválido");

  const detected = detectInepType(headers);
  if (detected === "inep_escolas") {
    throw new Error("Arquivo parece ser Tabela_Escola (sem colunas QT_MAT_*). Selecione 'INEP — Escolas' no seletor.");
  }

  const coEntidadeKey = pickHeader(headers, ["CO_ENTIDADE"]);
  const coMunicipioKey = pickHeader(headers, ["CO_MUNICIPIO", "CO_MUNICIPIO_IBGE"]);
  const tpDepKey = pickHeader(headers, ["TP_DEPENDENCIA"]);
  const tpSitKey = pickHeader(headers, ["TP_SITUACAO_FUNCIONAMENTO", "TP_SITUACAO"]);
  const anoKey = pickHeader(headers, ["NU_ANO_CENSO"]);
  const coEntidadeIdx = headerIndex(headers, coEntidadeKey);
  const coMunicipioIdx = headerIndex(headers, coMunicipioKey);
  const tpDepIdx = headerIndex(headers, tpDepKey);
  const tpSitIdx = headerIndex(headers, tpSitKey);
  const anoIdx = headerIndex(headers, anoKey);
  const matBasIdx = headerIndex(headers, "QT_MAT_BAS");
  const etapaIndexes = Object.fromEntries(
    Object.entries(ETAPA_COLS).map(([etapa, cols]) => [etapa, cols.map((col) => headerIndex(headers, col)).filter((idx) => idx >= 0)]),
  ) as Record<string, number[]>;
  const useEscolaMap = Boolean(coEntidadeKey && (!coMunicipioKey || !tpDepKey));
  await send({
    type: "progress",
    message: "Diagnóstico das colunas principais do arquivo de matrículas.",
    data: {
      detected,
      coEntidadeKey: coEntidadeKey ?? null,
      coMunicipioKey: coMunicipioKey ?? null,
      tpDepKey: tpDepKey ?? null,
      tpSitKey: tpSitKey ?? null,
      anoKey: anoKey ?? null,
      etapaColumnsFound: Object.fromEntries(Object.entries(etapaIndexes).map(([etapa, indexes]) => [etapa, indexes.length])),
      sample: {
        CO_ENTIDADE: valueAt(firstDataValues, coEntidadeIdx) || null,
        CO_MUNICIPIO: valueAt(firstDataValues, coMunicipioIdx) || null,
        TP_DEPENDENCIA: valueAt(firstDataValues, tpDepIdx) || null,
        TP_SITUACAO: valueAt(firstDataValues, tpSitIdx) || null,
        NU_ANO_CENSO: valueAt(firstDataValues, anoIdx) || null,
        QT_MAT_BAS: valueAt(firstDataValues, matBasIdx) || null,
        QT_MAT_INF_CRE: valueAt(firstDataValues, headerIndex(headers, "QT_MAT_INF_CRE")) || null,
        QT_MAT_INF_PRE: valueAt(firstDataValues, headerIndex(headers, "QT_MAT_INF_PRE")) || null,
      },
    },
  });

  let escolaMap: Map<number, InepEscolaMapRow> | null = null;
  if (useEscolaMap) {
    await send({
      type: "progress",
      message: "Este Tabela_Matricula não traz CO_MUNICIPIO/TP_DEPENDENCIA. Vou cruzar CO_ENTIDADE com o mapa importado pelo arquivo INEP — Escolas.",
    });
    escolaMap = await loadInepEscolaMap(supabaseAdmin, send);
    if (escolaMap.size === 0) {
      throw new Error("O arquivo de matrículas enviado só possui CO_ENTIDADE. Importe primeiro o arquivo Tabela_Escola_2025.csv em 'INEP — Escolas' para criar o mapa escola→município; depois rode Matrículas novamente.");
    }
  } else if (!coMunicipioKey || !tpDepKey) {
    throw new Error(
      `Colunas obrigatórias ausentes. Necessárias: CO_MUNICIPIO(_IBGE), TP_DEPENDENCIA ou CO_ENTIDADE para cruzar com o arquivo de Escolas. Encontradas (parcial): ${headers.slice(0, 15).join(", ")}...`,
    );
  }

  // Agrega direto quando o CSV traz município/dependência; caso contrário cruza por CO_ENTIDADE com Tabela_Escola.
  const agregado = new Map<number, { etapas: Record<string, number>; escolas: Set<number>; escolasCount: number }>();
  let totalLinhas = 0;
  let dep3 = 0;
  let sit1 = 0;
  let municipaisAtivas = 0;
  let semIbge = 0;
  let semEntidade = 0;
  let semMapa = 0;
  let cruzadasComMapa = 0;
  let totalMatBasArquivo = 0;
  const sampleSemMapa: number[] = [];
  const sampleAgregado: string[] = [];
  let processedLogMark = 0;

  let lineStart = text.indexOf("\n");
  lineStart = lineStart >= 0 ? lineStart + 1 : text.length;
  while (lineStart < text.length) {
    let lineEnd = text.indexOf("\n", lineStart);
    if (lineEnd < 0) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, "");
    lineStart = lineEnd + 1;
    if (!line.trim()) continue;

    const values = line.split(delimiter);
    totalLinhas++;
    totalMatBasArquivo += numberAt(values, matBasIdx);
    const co = numberAt(values, coEntidadeIdx);
    let ibge = numberAt(values, coMunicipioIdx);
    let dep = numberAt(values, tpDepIdx);
    let sit = tpSitKey ? numberAt(values, tpSitIdx, 1) : 1;

    if (escolaMap) {
      if (!co) { semEntidade++; continue; }
      const escola = escolaMap.get(co);
      if (!escola) {
        semMapa++;
        if (sampleSemMapa.length < 8) sampleSemMapa.push(co);
        continue;
      }
      ibge = Number(escola.ibge_id);
      dep = Number(escola.tp_dependencia);
      sit = Number(escola.tp_situacao ?? 1);
      cruzadasComMapa++;
    }

    if (!ibge) { semIbge++; continue; }
    if (dep === 3) dep3++;
    if (sit === 1) sit1++;
    if (dep !== 3 || sit !== 1) continue;
    municipaisAtivas++;

    let entry = agregado.get(ibge);
    if (!entry) {
      entry = { etapas: {}, escolas: new Set(), escolasCount: 0 };
      agregado.set(ibge, entry);
    }
    if (co) entry.escolas.add(co);
    entry.escolasCount++;

    for (const [etapa, cols] of Object.entries(ETAPA_COLS)) {
      let sum = 0;
      const indexes = etapaIndexes[etapa] ?? [];
      for (const idx of indexes) sum += numberAt(values, idx);
      if (sum > 0) entry.etapas[etapa] = (entry.etapas[etapa] ?? 0) + sum;
    }
    if (sampleAgregado.length < 5) sampleAgregado.push(`${ibge}/${co || "sem_entidade"}: ${numberAt(values, matBasIdx)} básicas`);

    if (totalLinhas - processedLogMark >= 50000) {
      processedLogMark = totalLinhas;
      await send({
        type: "progress",
        message: `Processadas ${totalLinhas.toLocaleString("pt-BR")} linhas até agora · agregando ${agregado.size.toLocaleString("pt-BR")} municípios.`,
      });
    }
  }

  await send({
    type: "progress",
    message: `${totalLinhas.toLocaleString("pt-BR")} linhas lidas · QT_MAT_BAS bruto: ${totalMatBasArquivo.toLocaleString("pt-BR")} · dep=3: ${dep3.toLocaleString("pt-BR")} · sit=1: ${sit1.toLocaleString("pt-BR")} · municipais ativas: ${municipaisAtivas.toLocaleString("pt-BR")} em ${agregado.size.toLocaleString("pt-BR")} municípios.`,
    data: {
      mode: escolaMap ? "cruzamento_co_entidade_com_tabela_escolas" : "direto_por_co_municipio",
      semIbge,
      semEntidade,
      semMapa,
      cruzadasComMapa,
      sampleSemMapa,
      sampleAgregado,
    },
  });

  if (agregado.size === 0) {
    if (escolaMap && semMapa > 0) {
      throw new Error(`Nenhuma matrícula municipal ativa foi agregada. O arquivo de Matrículas usa CO_ENTIDADE, mas ${semMapa.toLocaleString("pt-BR")} entidades não foram encontradas no mapa de Escolas. Reimporte o Tabela_Escola_2025.csv correto antes de rodar Matrículas.`);
    }
    throw new Error("Nenhuma linha municipal ativa (TP_DEPENDENCIA=3 e TP_SITUACAO_FUNCIONAMENTO=1) foi encontrada. Verifique se o arquivo é o Tabela_Matricula do Censo Escolar.");
  }

  const ano = anoKey ? numberAt(firstDataValues, anoIdx, new Date().getFullYear()) : new Date().getFullYear();
  const matRows: any[] = [];
  const totais: { ibge_id: number; matriculas_total: number; escolas: number }[] = [];
  for (const [ibge, agg] of agregado) {
    let total = 0;
    for (const [etapa, mat] of Object.entries(agg.etapas)) {
      if (mat > 0) {
        matRows.push({ ibge_id: ibge, etapa, matriculas: mat, ano });
        total += mat;
      }
    }
    const escolas = agg.escolas.size > 0 ? agg.escolas.size : agg.escolasCount;
    totais.push({ ibge_id: ibge, matriculas_total: total, escolas });
  }

  // Limpa matrículas do ano corrente para os municípios afetados.
  await send({ type: "progress", message: `Limpando matrículas do ano ${ano} para reprocessar...` });
  const ibgeList = Array.from(agregado.keys());
  for (let i = 0; i < ibgeList.length; i += 500) {
    const slice = ibgeList.slice(i, i + 500);
    const { error } = await supabaseAdmin
      .from("municipios_matriculas_etapa")
      .delete()
      .in("ibge_id", slice)
      .eq("ano", ano);
    if (error) throw new Error(`limpeza: ${error.message}`);
  }

  for (let i = 0; i < matRows.length; i += 500) {
    const { error } = await supabaseAdmin.from("municipios_matriculas_etapa").insert(matRows.slice(i, i + 500));
    if (error) throw new Error(`matriculas_etapa: ${error.message}`);
    if (i % 5000 === 0) {
      await send({ type: "progress", message: `Inseridas ${Math.min(i + 500, matRows.length).toLocaleString("pt-BR")} linhas de matrículas por etapa...` });
    }
  }

  // Atualiza totais + escolas por município em paralelo.
  const CONC = 20;
  let idx = 0;
  let updated = 0;
  let notFound = 0;
  const sampleNotFound: number[] = [];
  async function worker() {
    while (idx < totais.length) {
      const i = idx++;
      const t = totais[i];
      const { data, error } = await supabaseAdmin
        .from("municipios")
        .update({ matriculas_total: t.matriculas_total, escolas: t.escolas })
        .eq("ibge_id", t.ibge_id)
        .select("ibge_id")
        .maybeSingle();
      if (error) throw new Error(`municipios ${t.ibge_id}: ${error.message}`);
      if (data) updated++;
      else {
        notFound++;
        if (sampleNotFound.length < 8) sampleNotFound.push(t.ibge_id);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  const totalGeral = totais.reduce((a, b) => a + b.matriculas_total, 0);
  const totalEscolas = totais.reduce((a, b) => a + b.escolas, 0);
  const amostra = totais.slice(0, 3).map((t) => `${t.ibge_id}: ${t.matriculas_total} mat / ${t.escolas} esc`).join(" · ");
  await send({
    type: "progress",
    message: `Concluído: ${totalGeral.toLocaleString("pt-BR")} matrículas · ${totalEscolas.toLocaleString("pt-BR")} escolas municipais ativas · ${updated.toLocaleString("pt-BR")} municípios atualizados. Não encontrados no catálogo: ${notFound.toLocaleString("pt-BR")}. Amostra: ${amostra}`,
    data: { sampleNotFound },
  });
}


async function processFnde(content: Uint8Array, supabaseAdmin: any, send: any, filename: string) {
  let rows: Record<string, string>[] = [];
  if (filename.toLowerCase().endsWith(".xlsx") || filename.toLowerCase().endsWith(".xls")) {
    const workbook = XLSX.read(content, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(firstSheet, { header: "A", defval: "" }) as Record<string, string>[];
    const headerRow = rows[0];
    const headers: string[] = [];
    for (let i = 0; ; i++) {
      const key = String.fromCharCode(65 + i);
      if (!headerRow || !(key in headerRow)) break;
      headers.push(headerRow[key]);
    }
    rows = rows.slice(1).map((r) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        const key = String.fromCharCode(65 + i);
        obj[headers[i]] = String(r[key] ?? "");
      }
      return obj;
    });
  } else {
    const text = decodeCsv(content);
    // FNDE aceita ; ou ,
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    rows = parsed.data as Record<string, string>[];
  }
  await send({ type: "progress", message: `${rows.length.toLocaleString("pt-BR")} linhas detectadas.`, data: { headers: Object.keys(rows[0] || {}) } });

  let ibgeField: string | undefined;
  for (const key of Object.keys(rows[0] || {})) {
    const up = key.toUpperCase();
    if (up.includes("IBGE") || up.includes("CODIGO") || up.includes("CÓDIGO") || up.includes("MUNIC")) {
      ibgeField = key; break;
    }
  }
  if (!ibgeField) throw new Error("Coluna de código IBGE não encontrada");

  // Detecta se é planilha multi-programa (com coluna Programa) — filtra apenas FUNDEB.
  let programaField: string | undefined;
  for (const key of Object.keys(rows[0] || {})) {
    if (key.toUpperCase().includes("PROGRAMA")) { programaField = key; break; }
  }

  const monthlyRe = /^(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)$/i;
  const monthCols = Object.keys(rows[0] || {}).filter((k) => monthlyRe.test(k.trim()));
  let totalField: string | undefined;
  for (const key of Object.keys(rows[0] || {})) {
    const up = key.toUpperCase();
    if (up.includes("TOTAL") || up.includes("VALOR") || up.includes("REPASSE") || up.includes("LIBERADO")) {
      totalField = key; break;
    }
  }

  const acumulado = new Map<number, number>();
  let filtradasNaoFundeb = 0;
  for (const row of rows) {
    if (programaField) {
      const prog = String(row[programaField] ?? "").toUpperCase();
      if (!prog.includes("FUNDEB")) { filtradasNaoFundeb++; continue; }
    }
    const raw = String(row[ibgeField!] ?? "").replace(/\D/g, "");
    const ibgeId = Number(raw.slice(0, 7));
    if (!ibgeId) continue;
    let valor = 0;
    if (monthCols.length) {
      valor = monthCols.reduce((acc, key) => acc + parseMoney(row[key]), 0);
    } else if (totalField) {
      valor = parseMoney(row[totalField]);
    }
    if (valor > 0) acumulado.set(ibgeId, (acumulado.get(ibgeId) ?? 0) + valor);
  }
  if (filtradasNaoFundeb > 0) {
    await send({ type: "progress", message: `${filtradasNaoFundeb.toLocaleString("pt-BR")} linhas ignoradas (programa ≠ FUNDEB).` });
  }
  await send({ type: "progress", message: `${acumulado.size.toLocaleString("pt-BR")} municípios com valores FUNDEB válidos. Atualizando...` });

  const CONC = 20;
  const entries = Array.from(acumulado.entries());
  let idx = 0;
  async function worker() {
    while (idx < entries.length) {
      const i = idx++;
      const [ibge, valor] = entries[i];
      const { error } = await supabaseAdmin.from("municipios").update({ fnde_anual: valor }).eq("ibge_id", ibge);
      if (error) throw new Error(`fnde ${ibge}: ${error.message}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  await send({ type: "progress", message: `FNDE (FUNDEB) atualizado: ${acumulado.size.toLocaleString("pt-BR")} municípios.` });
}

function parseMoney(value: string): number {
  if (!value) return 0;
  const normalized = String(value).replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  const n = Number(normalized);
  return Number.isNaN(n) ? 0 : n;
}

async function recalcScores(supabaseAdmin: any) {
  const { calcularScore, contarCampos } = await import("@/lib/catalog-score");
  const { data: munis, error: mErr } = await supabaseAdmin
    .from("municipios")
    .select("ibge_id, populacao, matriculas_total, fnde_anual");
  if (mErr) throw new Error(mErr.message);
  const { data: edus, error: eErr } = await supabaseAdmin
    .from("municipios_educacao")
    .select("ibge_id, secretario, cargo, email, telefone, horario, equipe, atualizado_em");
  if (eErr) throw new Error(eErr.message);

  const eduMap = new Map<number, any>((edus ?? []).map((e: any) => [e.ibge_id, e]));
  const faixas = { alto: 0, medio: 0, baixo: 0 };
  const BATCH = 500;
  let processed = 0;
  const updates: any[] = [];

  for (const m of munis ?? []) {
    const e = eduMap.get(m.ibge_id);
    const campos = contarCampos({
      secretario: e?.secretario, cargo: e?.cargo, email: e?.email,
      telefone: e?.telefone, horario: e?.horario, equipe: e?.equipe,
    });
    const { score, faixa, breakdown } = calcularScore({
      populacao: m.populacao ?? 0,
      matriculas_total: m.matriculas_total ?? 0,
      fnde_anual: Number(m.fnde_anual ?? 0),
      campos_preenchidos: campos,
      atualizado_em: e?.atualizado_em ?? null,
    });
    faixas[faixa]++;
    updates.push({ ibge_id: m.ibge_id, score, faixa, breakdown });
    if (updates.length >= BATCH) {
      const { error } = await supabaseAdmin.from("municipios_educacao").upsert(updates, { onConflict: "ibge_id" });
      if (error) throw new Error(error.message);
      processed += updates.length;
      updates.length = 0;
    }
  }
  if (updates.length) {
    const { error } = await supabaseAdmin.from("municipios_educacao").upsert(updates, { onConflict: "ibge_id" });
    if (error) throw new Error(error.message);
    processed += updates.length;
  }
  return { total: processed, faixas };
}
