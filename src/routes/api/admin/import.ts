import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { fetchAllByKeyset, fetchAllByRange, PG_PAGE } from "@/lib/pg-paginate.server";

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

              const type = request.headers.get("x-import-type") as "inep_escolas" | "inep_matriculas" | "fundeb_matriculas" | "fnde" | null;
              const rawFilename = request.headers.get("x-import-filename");
              const filename = rawFilename ? decodeURIComponent(rawFilename) : "upload";
              if (!type || !request.body) {
                await send({ type: "error", message: "Tipo ou arquivo inválido" });
                controller.close();
                return;
              }
              // Suporte a upload em lotes (arquivos do Censo Escolar têm 200k+ linhas —
              // um único request longo pode bater em limite da plataforma, ex.: contagem
              // de subrequests do Cloudflare Workers). Sem esses headers, comporta-se
              // como antes (um request só = "lote único, é o último").
              const chunkIndex = Number(request.headers.get("x-chunk-index") ?? "0");
              const chunkTotal = Number(request.headers.get("x-chunk-total") ?? "1");
              const isLastChunk = chunkIndex >= chunkTotal - 1;
              const contentLength = Number(request.headers.get("content-length") ?? "0");
              await send({ type: "start", message: "Iniciando importação", data: { type } });
              await send({
                type: "progress",
                message: chunkTotal > 1
                  ? `Recebendo lote ${chunkIndex + 1}/${chunkTotal} (~${(contentLength / 1024 / 1024).toFixed(2)} MB).`
                  : contentLength
                    ? `Recebendo arquivo em streaming (~${(contentLength / 1024 / 1024).toFixed(2)} MB, sem carregar tudo em memória).`
                    : "Recebendo arquivo em streaming (sem carregar tudo em memória).",
                data: { name: filename, sizeBytes: contentLength || null, selectedType: type, chunkIndex, chunkTotal },
              });

              if (type === "inep_escolas") {
                await processInepEscolas(request.body, supabaseAdmin, send, isLastChunk);
              } else if (type === "inep_matriculas") {
                await processInepMatriculas(request.body, supabaseAdmin, send);
              } else if (type === "fundeb_matriculas") {
                let body = request.body;
                if (/\.gz$/i.test(filename) && typeof DecompressionStream !== "undefined") {
                  await send({ type: "progress", message: "Arquivo .gz detectado — descompactando em streaming." });
                  body = body.pipeThrough(new DecompressionStream("gzip"));
                }
                await processFundebMatriculas(body, supabaseAdmin, send);
              } else {
                const buffer = await new Response(request.body).arrayBuffer();
                await processFnde(new Uint8Array(buffer), supabaseAdmin, send, filename);
              }
              if (isLastChunk) {
                await send({ type: "recalc", message: "Recalculando scores em massa..." });
                const recalc = await recalcScores(supabaseAdmin);
                await send({ type: "done", message: "Importação finalizada", data: recalc });
              } else {
                await send({ type: "done", message: `Lote ${chunkIndex + 1}/${chunkTotal} concluído`, data: { chunkIndex, chunkTotal, partial: true } });
              }
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

// ============ Leitor de linhas em streaming ============
// Nunca materializa o arquivo inteiro em memória: lê o ReadableStream do corpo
// da requisição em chunks, decodifica incrementalmente (detectando UTF-8 vs
// Latin1 a partir do primeiro chunk) e entrega uma linha completa por vez.
// Memória usada é limitada ao tamanho do chunk + a linha em processamento,
// independente do arquivo ter 10 MB ou 1 GB.
type LineSource = { next(): Promise<string | null> };

function createLineSource(body: ReadableStream<Uint8Array>): LineSource {
  const reader = body.getReader();
  let decoder: TextDecoder | null = null;
  let carry = "";
  let ended = false;
  const queue: string[] = [];

  function splitCarryIntoLines() {
    let idx: number;
    while ((idx = carry.indexOf("\n")) >= 0) {
      let line = carry.slice(0, idx);
      carry = carry.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      queue.push(line);
    }
  }

  async function fill() {
    while (queue.length === 0 && !ended) {
      const { value, done } = await reader.read();
      if (done) {
        ended = true;
        if (decoder) carry += decoder.decode();
        let last = carry;
        carry = "";
        if (last.endsWith("\r")) last = last.slice(0, -1);
        if (last.length > 0) queue.push(last);
        return;
      }
      if (!decoder) {
        // INEP publica em UTF-8; alguns arquivos vêm em Latin1. Detecta pelos
        // caracteres inválidos no primeiro chunk (a linha de header basta).
        const probe = new TextDecoder("utf-8", { fatal: false }).decode(value);
        decoder = new TextDecoder(probe.includes("�") ? "latin1" : "utf-8", { fatal: false });
      }
      carry += decoder.decode(value, { stream: true });
      splitCarryIntoLines();
    }
  }

  return {
    async next() {
      if (queue.length === 0) await fill();
      return queue.length > 0 ? queue.shift()! : null;
    },
  };
}

async function* allLines(src: LineSource, prepend?: string | null) {
  if (prepend !== undefined && prepend !== null) yield prepend;
  for (;;) {
    const line = await src.next();
    if (line === null) return;
    yield line;
  }
}

function detectDelimiterFromHeader(headerLine: string): string {
  const candidates = [";", ",", "\t", "|"];
  return candidates.reduce((best, current) => (headerLine.split(current).length > headerLine.split(best).length ? current : best), candidates[0]);
}

function cleanHeader(value: string): string {
  return value.replace(/^﻿/, "").trim();
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

async function readHeader(src: LineSource): Promise<{ delimiter: string; headers: string[] }> {
  const headerLine = await src.next();
  if (headerLine === null) throw new Error("Arquivo vazio ou formato inválido");
  const delimiter = detectDelimiterFromHeader(headerLine);
  const headers = headerLine.split(delimiter).map(cleanHeader);
  return { delimiter, headers };
}

type InepEscolaMapRow = {
  co_entidade: number;
  ibge_id: number;
  tp_dependencia: number;
  tp_situacao: number;
};

async function loadInepEscolaMap(supabaseAdmin: any, send: any): Promise<Map<number, InepEscolaMapRow>> {
  const map = new Map<number, InepEscolaMapRow>();

  await send({
    type: "progress",
    message: "Carregando mapa Escola → Município importado anteriormente (tabela INEP — Escolas)...",
  });

  const rows = await fetchAllByKeyset<InepEscolaMapRow>(
    (after) => {
      let q = supabaseAdmin
        .from("inep_escolas")
        .select("co_entidade, ibge_id, tp_dependencia, tp_situacao")
        .order("co_entidade", { ascending: true })
        .limit(PG_PAGE);
      if (after !== null) q = q.gt("co_entidade", after);
      return q;
    },
    (r) => Number(r.co_entidade),
    "inep_escolas/mapa",
  );
  for (const row of rows) {
    if (row.co_entidade && row.ibge_id) map.set(Number(row.co_entidade), row);
  }

  await send({
    type: "progress",
    message: `Mapa carregado: ${map.size.toLocaleString("pt-BR")} escolas disponíveis para cruzamento.`,
  });

  return map;
}

// Reconta escolas municipais ativas por município direto do banco (não do que
// esta requisição viu) — necessário porque, com upload em lotes, um único
// request só enxerga uma fatia do arquivo; a contagem definitiva só pode vir
// de uma varredura completa do que já foi gravado em `inep_escolas`.
export async function recontarEscolasMunicipais(supabaseAdmin: any, ano: number, send: any): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  const rows = await fetchAllByKeyset<{ co_entidade: number; ibge_id: number }>(
    (after) => {
      let q = supabaseAdmin
        .from("inep_escolas")
        .select("co_entidade, ibge_id")
        .eq("ano", ano)
        .eq("tp_dependencia", 3)
        .eq("tp_situacao", 1)
        .order("co_entidade", { ascending: true })
        .limit(PG_PAGE);
      if (after !== null) q = q.gt("co_entidade", after);
      return q;
    },
    (r) => Number(r.co_entidade),
    "inep_escolas/recontagem",
    async (loaded) => {
      if (loaded % 50000 === 0) {
        await send({ type: "progress", message: `↳ recontagem: ${loaded.toLocaleString("pt-BR")} escolas municipais ativas lidas...` });
      }
    },
  );
  for (const r of rows) counts.set(Number(r.ibge_id), (counts.get(Number(r.ibge_id)) ?? 0) + 1);
  await send({ type: "progress", message: `Recontagem completa: ${rows.length.toLocaleString("pt-BR")} escolas · ${counts.size.toLocaleString("pt-BR")} municípios com rede municipal ativa.` });
  return counts;
}

async function processInepEscolas(body: ReadableStream<Uint8Array>, supabaseAdmin: any, send: any, isLastChunk: boolean) {
  const src = createLineSource(body);
  const { delimiter, headers } = await readHeader(src);
  await send({
    type: "progress",
    message: `Headers detectados (delimitador="${delimiter === "\t" ? "\\t" : delimiter}", ${headers.length} colunas).`,
    data: { delimiter, headers: headers.slice(0, 20) },
  });

  const detected = detectInepType(headers);
  if (detected === "inep_matriculas") {
    throw new Error("Arquivo parece ser Tabela_Matricula (contém colunas QT_MAT_*). Selecione 'INEP — Matrículas' no seletor.");
  }

  const coEntidadeKey = pickHeader(headers, ["CO_ENTIDADE"]);
  const coMunicipioKey = pickHeader(headers, ["CO_MUNICIPIO", "CO_MUNICIPIO_IBGE"]);
  const tpDepKey = pickHeader(headers, ["TP_DEPENDENCIA"]);
  const tpSitKey = pickHeader(headers, ["TP_SITUACAO_FUNCIONAMENTO", "TP_SITUACAO"]);
  const anoKey = pickHeader(headers, ["NU_ANO_CENSO"]);
  if (!coEntidadeKey || !coMunicipioKey || !tpDepKey) {
    throw new Error(`Colunas obrigatórias ausentes. Necessárias: CO_ENTIDADE, CO_MUNICIPIO(_IBGE), TP_DEPENDENCIA. Encontradas: ${headers.slice(0, 10).join(", ")}...`);
  }
  const coEntidadeIdx = headerIndex(headers, coEntidadeKey);
  const coMunicipioIdx = headerIndex(headers, coMunicipioKey);
  const tpDepIdx = headerIndex(headers, tpDepKey);
  const tpSitIdx = headerIndex(headers, tpSitKey);
  const anoIdx = headerIndex(headers, anoKey);

  const firstDataLine = await src.next();
  if (firstDataLine === null) throw new Error("Arquivo vazio ou formato inválido");
  const firstValues = firstDataLine.split(delimiter);
  const ano = anoKey ? numberAt(firstValues, anoIdx, new Date().getFullYear()) : new Date().getFullYear();

  // ---- Estado prévio no banco (checkpoint): quantas escolas já existem ----
  const { count: preCount } = await supabaseAdmin
    .from("inep_escolas")
    .select("co_entidade", { count: "exact", head: true })
    .eq("ano", ano);
  const jaImportadas = preCount ?? 0;
  await send({
    type: "progress",
    message: jaImportadas
      ? `Checkpoint: já existem ${jaImportadas.toLocaleString("pt-BR")} escolas gravadas para o ano ${ano}. Linhas repetidas serão atualizadas (idempotente) e a contagem por município será aplicada em lotes progressivos.`
      : `Checkpoint: nenhuma escola gravada ainda para o ano ${ano}. Import começando do zero.`,
    data: { ano, jaImportadas },
  });

  const municipaisLote = new Map<number, number>();
  let totalLinhas = 0;
  let ignored = 0;
  let countDep3 = 0;
  let countSit1 = 0;
  const sampleIgnored: Record<string, string>[] = [];
  let batch: { co_entidade: number; ibge_id: number; tp_dependencia: number; tp_situacao: number; ano: number }[] = [];
  const BATCH = 1000;
  let processedLogMark = 0;
  let gravadas = 0;
  let lastMuniFlush = 0;
  let updatedTotal = 0;
  let notFound = 0;
  const sampleNotFound: number[] = [];
  const t0 = Date.now();

  async function flush() {
    if (batch.length === 0) return;
    const size = batch.length;
    const { error } = await supabaseAdmin.from("inep_escolas").upsert(batch, { onConflict: "co_entidade" });
    if (error) throw new Error(`inep_escolas: ${error.message}`);
    gravadas += size;
    batch = [];
  }

  // Aplica a contagem de escolas municipais no catálogo. Chamado em lotes
  // progressivos durante a leitura, para que uma queda de conexão não perca
  // todo o trabalho já feito.
  async function aplicarContagens(entries: [number, number][]) {
    const CONC = 20;
    let idx = 0;
    let updated = 0;
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
    updatedTotal = updated;
    return updated;
  }

  for await (const line of allLines(src, firstDataLine)) {
    if (!line.trim()) continue;
    const values = line.split(delimiter);
    totalLinhas++;

    const co = numberAt(values, coEntidadeIdx);
    const ibge = numberAt(values, coMunicipioIdx);
    const dep = numberAt(values, tpDepIdx);
    const sit = tpSitKey ? numberAt(values, tpSitIdx, 1) : 1;
    if (!co || !ibge || !dep) {
      ignored++;
      if (sampleIgnored.length < 3) {
        sampleIgnored.push({
          CO_ENTIDADE: valueAt(values, coEntidadeIdx),
          CO_MUNICIPIO: valueAt(values, coMunicipioIdx),
          TP_DEPENDENCIA: valueAt(values, tpDepIdx),
          TP_SITUACAO: tpSitKey ? valueAt(values, tpSitIdx) : "sem_coluna",
        });
      }
      continue;
    }
    batch.push({ co_entidade: co, ibge_id: ibge, tp_dependencia: dep, tp_situacao: sit, ano });
    if (dep === 3) countDep3++;
    if (sit === 1) countSit1++;
    if (dep === 3 && sit === 1) municipaisLote.set(ibge, (municipaisLote.get(ibge) ?? 0) + 1);

    if (batch.length >= BATCH) await flush();

    // ---- Log verbose a cada 20 mil linhas ----
    if (totalLinhas - processedLogMark >= 20000) {
      processedLogMark = totalLinhas;
      const elapsed = (Date.now() - t0) / 1000;
      const taxa = Math.round(totalLinhas / Math.max(elapsed, 1));
      await send({
        type: "progress",
        message: `↳ ${totalLinhas.toLocaleString("pt-BR")} linhas lidas · ${gravadas.toLocaleString("pt-BR")} gravadas no banco · ${ignored.toLocaleString("pt-BR")} ignoradas · ${municipaisLote.size.toLocaleString("pt-BR")} municípios com rede municipal ativa neste lote · ${Math.round(elapsed)}s (${taxa.toLocaleString("pt-BR")} linhas/s)`,
        data: {
          lidas: totalLinhas,
          gravadas,
          ignoradas: ignored,
          municipios: municipaisLote.size,
          dep3: countDep3,
          sit1: countSit1,
          segundos: Math.round(elapsed),
          linhasPorSegundo: taxa,
        },
      });
    }

    // ---- Flush progressivo das contagens por município (a cada 100 mil linhas dentro deste lote) ----
    if (totalLinhas - lastMuniFlush >= 100000 && municipaisLote.size > 0) {
      lastMuniFlush = totalLinhas;
      const parciais = Array.from(municipaisLote.entries());
      const upd = await aplicarContagens(parciais);
      await send({
        type: "progress",
        message: `💾 Checkpoint parcial: contagem de escolas aplicada em ${upd.toLocaleString("pt-BR")} municípios (parcial, será refinada até o fim do arquivo).`,
        data: { parcial: true, municipiosAtualizados: upd, linhas: totalLinhas },
      });
    }
  }
  await flush();

  const elapsedTotal = Math.round((Date.now() - t0) / 1000);
  await send({
    type: "progress",
    message: `${totalLinhas.toLocaleString("pt-BR")} escolas lidas neste lote · ${gravadas.toLocaleString("pt-BR")} gravadas · dep=3: ${countDep3.toLocaleString("pt-BR")} · sit=1: ${countSit1.toLocaleString("pt-BR")} · ${elapsedTotal}s.`,
    data: { ignored, sampleIgnored, gravadas, segundos: elapsedTotal },
  });

  if (!isLastChunk) {
    await send({
      type: "progress",
      message: "Lote gravado — contagem final de escolas por município e checagem de sanidade só rodam no último lote.",
    });
    return;
  }

  // Contagem definitiva por município — varre o banco (não o que este lote
  // viu), pois com upload em lotes cada request só enxerga uma fatia do arquivo.
  const municipais = await recontarEscolasMunicipais(supabaseAdmin, ano, send);
  const entries = Array.from(municipais.entries());
  const updated = await aplicarContagens(entries);
  const amostra = entries.slice(0, 3).map(([ibge, c]) => `${ibge}=${c}`).join(", ");
  await send({
    type: "progress",
    message: `Contagem de escolas municipais atualizada em ${updated.toLocaleString("pt-BR")} municípios (amostra: ${amostra}). Não encontrados no catálogo: ${notFound.toLocaleString("pt-BR")}.`,
    data: { sampleNotFound, updatedTotal },
  });

  // ---- Sanidade: o Censo tem ~215 mil escolas em ~5.570 municípios ----
  const { count: posCount } = await supabaseAdmin
    .from("inep_escolas")
    .select("co_entidade", { count: "exact", head: true })
    .eq("ano", ano);
  const totalBanco = posCount ?? 0;
  if (totalBanco < 150000 || municipais.size < 5000) {
    await send({
      type: "progress",
      message: `⚠️ ATENÇÃO: o banco terminou com apenas ${totalBanco.toLocaleString("pt-BR")} escolas em ${municipais.size.toLocaleString("pt-BR")} municípios — abaixo do esperado (~215.000 escolas / ~5.570 municípios). Confira se todos os lotes foram enviados com sucesso; reenviar os lotes que faltaram é seguro (import idempotente).`,
      data: { totalBanco, municipios: municipais.size, incompleto: true },
    });
  } else {
    await send({
      type: "progress",
      message: `✅ Sanidade OK: ${totalBanco.toLocaleString("pt-BR")} escolas no banco para o ano ${ano} (${(totalBanco - jaImportadas).toLocaleString("pt-BR")} novas nesta importação).`,
      data: { totalBanco, novas: totalBanco - jaImportadas },
    });
  }
}


async function processInepMatriculas(body: ReadableStream<Uint8Array>, supabaseAdmin: any, send: any) {
  const src = createLineSource(body);
  const { delimiter, headers } = await readHeader(src);
  await send({
    type: "progress",
    message: `Headers detectados (delimitador="${delimiter === "\t" ? "\\t" : delimiter}", ${headers.length} colunas).`,
    data: { delimiter, headers: headers.slice(0, 40) },
  });

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

  if (!useEscolaMap && (!coMunicipioKey || !tpDepKey)) {
    throw new Error(
      `Colunas obrigatórias ausentes. Necessárias: CO_MUNICIPIO(_IBGE), TP_DEPENDENCIA ou CO_ENTIDADE para cruzar com o arquivo de Escolas. Encontradas (parcial): ${headers.slice(0, 15).join(", ")}...`,
    );
  }

  const firstDataLine = await src.next();
  if (firstDataLine === null) throw new Error("Arquivo vazio ou formato inválido");
  const firstValues = firstDataLine.split(delimiter);

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
        CO_ENTIDADE: valueAt(firstValues, coEntidadeIdx) || null,
        CO_MUNICIPIO: valueAt(firstValues, coMunicipioIdx) || null,
        TP_DEPENDENCIA: valueAt(firstValues, tpDepIdx) || null,
        TP_SITUACAO: valueAt(firstValues, tpSitIdx) || null,
        NU_ANO_CENSO: valueAt(firstValues, anoIdx) || null,
        QT_MAT_BAS: valueAt(firstValues, matBasIdx) || null,
        QT_MAT_INF_CRE: valueAt(firstValues, headerIndex(headers, "QT_MAT_INF_CRE")) || null,
        QT_MAT_INF_PRE: valueAt(firstValues, headerIndex(headers, "QT_MAT_INF_PRE")) || null,
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

  for await (const line of allLines(src, firstDataLine)) {
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

    for (const etapa of Object.keys(ETAPA_COLS)) {
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

  const ano = anoKey ? numberAt(firstValues, anoIdx, new Date().getFullYear()) : new Date().getFullYear();
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

// ============ FUNDEB — Matrículas por município (SIOPE/FNDE) ============
// Formato: nu_ano_censo;sg_uf;no_municipio_ge;esfera_administrativa;ds_tipo_rede_educacao;
//          ds_tipo_educacao;ds_tipo_ensino;ds_tipo_turma;ds_tipo_carga_horaria;ds_tipo_localizacao;qtd_matricula
// Não traz código IBGE: o cruzamento é feito por UF + nome normalizado do município.
function normalizeMunName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function mapFundebEtapa(tipoEducacao: string, tipoEnsino: string, tipoTurma: string): string | null {
  const edu = normalizeMunName(tipoEducacao);
  const ensino = normalizeMunName(tipoEnsino);
  const turma = normalizeMunName(tipoTurma);
  if (edu.includes("ESPECIAL")) return "especial";
  if (edu.includes("EJA") || ensino === "EJA") return "eja";
  if (ensino.includes("PROFISSIONAL")) return "profissionalizante";
  if (ensino.includes("MEDIO")) return "medio";
  if (ensino.includes("INFANTIL")) return turma.includes("CRECHE") ? "creche" : "pre_escola";
  if (ensino.includes("FUNDAMENTAL")) {
    if (turma.includes("FINAIS")) return "fundamental_af";
    return "fundamental_ai";
  }
  return null;
}

async function loadMunicipioNameMap(supabaseAdmin: any, send: any): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const pageSize = 2000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from("municipios")
      .select("ibge_id, nome, uf")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`municipios: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) map.set(`${row.uf.toUpperCase()}|${normalizeMunName(row.nome)}`, row.ibge_id);
    if (data.length < pageSize) break;
  }
  await send({ type: "progress", message: `Catálogo carregado: ${map.size.toLocaleString("pt-BR")} municípios para cruzamento por UF + nome.` });
  return map;
}

async function processFundebMatriculas(body: ReadableStream<Uint8Array>, supabaseAdmin: any, send: any) {
  const src = createLineSource(body);
  const { delimiter, headers } = await readHeader(src);
  await send({
    type: "progress",
    message: `Headers detectados (delimitador="${delimiter === "\t" ? "\\t" : delimiter}", ${headers.length} colunas).`,
    data: { delimiter, headers },
  });

  const idxAno = headerIndex(headers, pickHeader(headers, ["nu_ano_censo", "ano"]));
  const idxUf = headerIndex(headers, pickHeader(headers, ["sg_uf", "uf"]));
  const idxNome = headerIndex(headers, pickHeader(headers, ["no_municipio_ge", "no_municipio", "municipio"]));
  const idxEsfera = headerIndex(headers, pickHeader(headers, ["esfera_administrativa"]));
  const idxEducacao = headerIndex(headers, pickHeader(headers, ["ds_tipo_educacao"]));
  const idxEnsino = headerIndex(headers, pickHeader(headers, ["ds_tipo_ensino"]));
  const idxTurma = headerIndex(headers, pickHeader(headers, ["ds_tipo_turma"]));
  const idxQtd = headerIndex(headers, pickHeader(headers, ["qtd_matricula", "qt_matricula"]));

  if (idxUf < 0 || idxNome < 0 || idxQtd < 0 || idxEsfera < 0) {
    throw new Error(
      "Arquivo não parece ser o FUNDEB — Matrículas. Esperado colunas sg_uf, no_municipio_ge, esfera_administrativa e qtd_matricula.",
    );
  }

  const nameMap = await loadMunicipioNameMap(supabaseAdmin, send);

  const agregado = new Map<number, Record<string, number>>();
  let totalLinhas = 0;
  let municipais = 0;
  let semEtapa = 0;
  let semMatch = 0;
  let ano = new Date().getFullYear();
  const sampleSemMatch: string[] = [];
  const sampleSemEtapa: string[] = [];

  for await (const line of allLines(src)) {
    if (!line.trim()) continue;
    totalLinhas++;
    const v = line.split(delimiter);
    const esfera = normalizeMunName(valueAt(v, idxEsfera));
    if (!esfera.includes("MUNICIPAL")) continue;
    municipais++;

    if (idxAno >= 0 && totalLinhas === 1) ano = numberAt(v, idxAno, ano);
    if (idxAno >= 0 && municipais === 1) ano = numberAt(v, idxAno, ano);

    const key = `${valueAt(v, idxUf).trim().toUpperCase()}|${normalizeMunName(valueAt(v, idxNome))}`;
    const ibge = nameMap.get(key);
    if (!ibge) {
      semMatch++;
      if (sampleSemMatch.length < 10 && !sampleSemMatch.includes(key)) sampleSemMatch.push(key);
      continue;
    }

    const etapa = mapFundebEtapa(valueAt(v, idxEducacao), valueAt(v, idxEnsino), valueAt(v, idxTurma));
    if (!etapa) {
      semEtapa++;
      if (sampleSemEtapa.length < 5) sampleSemEtapa.push(`${valueAt(v, idxEnsino)} | ${valueAt(v, idxTurma)}`);
      continue;
    }

    const qtd = Math.round(Number(valueAt(v, idxQtd).replace(",", ".")) || 0);
    if (qtd <= 0) continue;
    let entry = agregado.get(ibge);
    if (!entry) {
      entry = {};
      agregado.set(ibge, entry);
    }
    entry[etapa] = (entry[etapa] ?? 0) + qtd;

    if (totalLinhas % 50000 === 0) {
      await send({
        type: "progress",
        message: `${totalLinhas.toLocaleString("pt-BR")} linhas lidas · ${agregado.size.toLocaleString("pt-BR")} municípios agregados...`,
      });
    }
  }

  await send({
    type: "progress",
    message: `${totalLinhas.toLocaleString("pt-BR")} linhas · ${municipais.toLocaleString("pt-BR")} de rede municipal · ${agregado.size.toLocaleString("pt-BR")} municípios agregados · ${semMatch.toLocaleString("pt-BR")} linhas sem correspondência no catálogo · ${semEtapa.toLocaleString("pt-BR")} sem etapa mapeada.`,
    data: { ano, sampleSemMatch, sampleSemEtapa },
  });

  if (agregado.size === 0) throw new Error("Nenhuma matrícula municipal foi agregada. Verifique o arquivo.");

  const matRows: any[] = [];
  const totais: { ibge_id: number; matriculas_total: number }[] = [];
  for (const [ibge, etapas] of agregado) {
    let total = 0;
    for (const [etapa, mat] of Object.entries(etapas)) {
      if (mat > 0) {
        matRows.push({ ibge_id: ibge, etapa, matriculas: mat, ano });
        total += mat;
      }
    }
    totais.push({ ibge_id: ibge, matriculas_total: total });
  }

  await send({ type: "progress", message: `Limpando matrículas do ano ${ano} para reprocessar...` });
  const ibgeList = Array.from(agregado.keys());
  for (let i = 0; i < ibgeList.length; i += 500) {
    const { error } = await supabaseAdmin
      .from("municipios_matriculas_etapa")
      .delete()
      .in("ibge_id", ibgeList.slice(i, i + 500))
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

  const CONC = 20;
  let idx = 0;
  let updated = 0;
  let notFound = 0;
  async function worker() {
    while (idx < totais.length) {
      const t = totais[idx++];
      const { data, error } = await supabaseAdmin
        .from("municipios")
        .update({ matriculas_total: t.matriculas_total })
        .eq("ibge_id", t.ibge_id)
        .select("ibge_id")
        .maybeSingle();
      if (error) throw new Error(`municipios ${t.ibge_id}: ${error.message}`);
      if (data) updated++;
      else notFound++;
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  const totalGeral = totais.reduce((a, b) => a + b.matriculas_total, 0);
  await send({
    type: "progress",
    message: `Concluído: ${totalGeral.toLocaleString("pt-BR")} matrículas municipais em ${updated.toLocaleString("pt-BR")} municípios atualizados (ano ${ano}). Não encontrados: ${notFound.toLocaleString("pt-BR")}. Obs.: este arquivo não traz contagem de escolas — use o INEP para isso.`,
  });
}

function decodeSmallFile(content: Uint8Array): string {
  // INEP/FNDE publicam em UTF-8; alguns arquivos vêm em Latin1. Usado só para
  // FNDE (arquivos pequenos, uma linha por município) — pode decodificar tudo de uma vez.
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(content);
    if (!utf8.includes("�")) return utf8;
  } catch {}
  return new TextDecoder("latin1").decode(content);
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
    const text = decodeSmallFile(content);
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
    .select("ibge_id, secretario, cargo, emails, telefones, horario, equipe, atualizado_em");
  if (eErr) throw new Error(eErr.message);

  const eduMap = new Map<number, any>((edus ?? []).map((e: any) => [e.ibge_id, e]));
  const faixas = { alto: 0, medio: 0, baixo: 0 };
  const BATCH = 500;
  let processed = 0;
  const updates: any[] = [];

  for (const m of munis ?? []) {
    const e = eduMap.get(m.ibge_id);
    const campos = contarCampos({
      secretario: e?.secretario, cargo: e?.cargo, emails: e?.emails,
      telefones: e?.telefones, horario: e?.horario, equipe: e?.equipe,
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
