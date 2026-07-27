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
              await send({ type: "progress", message: `Arquivo lido: ${(file.size / 1024 / 1024).toFixed(2)} MB` });

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

  for (const r of rows) {
    const co = Number(r[coEntidadeKey]);
    const ibge = Number(r[coMunicipioKey]);
    const dep = Number(r[tpDepKey]);
    const sit = tpSitKey ? Number(r[tpSitKey] ?? 1) : 1;
    if (!co || !ibge || !dep) { ignored++; continue; }
    escolasRows.push({ co_entidade: co, ibge_id: ibge, tp_dependencia: dep, tp_situacao: sit, ano });
    if (dep === 3) countDep3++;
    if (sit === 1) countSit1++;
    if (dep === 3 && sit === 1) municipais.set(ibge, (municipais.get(ibge) ?? 0) + 1);
  }
  await send({
    type: "progress",
    message: `${escolasRows.length.toLocaleString("pt-BR")} escolas válidas · dep=3: ${countDep3.toLocaleString("pt-BR")} · sit=1: ${countSit1.toLocaleString("pt-BR")} · municipais ativas: ${Array.from(municipais.values()).reduce((a,b)=>a+b,0).toLocaleString("pt-BR")} em ${municipais.size.toLocaleString("pt-BR")} municípios.`,
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
  async function worker() {
    while (idx < entries.length) {
      const i = idx++;
      const [ibge, count] = entries[i];
      const { error } = await supabaseAdmin.from("municipios").update({ escolas: count }).eq("ibge_id", ibge);
      if (error) throw new Error(`municipios ${ibge}: ${error.message}`);
      updated++;
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  const amostra = entries.slice(0, 3).map(([ibge, c]) => `${ibge}=${c}`).join(", ");
  await send({
    type: "progress",
    message: `Contagem de escolas municipais atualizada em ${updated.toLocaleString("pt-BR")} municípios (amostra: ${amostra}). Ignoradas: ${ignored.toLocaleString("pt-BR")}.`,
  });
}

async function processInepMatriculas(content: Uint8Array, supabaseAdmin: any, send: any) {
  const text = decodeCsv(content);
  const rows = parseCsvSemicolon(text);
  await send({ type: "progress", message: `${rows.length.toLocaleString("pt-BR")} linhas detectadas no arquivo.` });
  if (!rows.length) throw new Error("Arquivo vazio ou formato inválido");
  const sample = rows[0];
  if (!("CO_ENTIDADE" in sample)) {
    throw new Error("Coluna CO_ENTIDADE ausente. Faça upload do arquivo Tabela_Matricula do Censo Escolar.");
  }

  // Carrega mapa CO_ENTIDADE → IBGE (apenas escolas municipais ativas).
  await send({ type: "progress", message: "Carregando mapa de escolas municipais ativas do banco..." });
  const escolasMap = new Map<number, number>();
  const PAGE = 5000;
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("inep_escolas")
      .select("co_entidade, ibge_id")
      .eq("tp_dependencia", 3)
      .eq("tp_situacao", 1)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`inep_escolas: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const e of data) escolasMap.set(Number(e.co_entidade), Number(e.ibge_id));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  if (escolasMap.size === 0) {
    throw new Error("Nenhuma escola municipal ativa cadastrada. Importe primeiro 'INEP - Escolas'.");
  }
  await send({ type: "progress", message: `${escolasMap.size.toLocaleString("pt-BR")} escolas municipais ativas no mapa.` });

  // Agrega matrículas por município e etapa (apenas escolas municipais ativas).
  const agregado = new Map<number, Record<string, number>>();
  let matched = 0;
  let skipped = 0;
  for (const r of rows) {
    const co = Number(r.CO_ENTIDADE);
    if (!co) { skipped++; continue; }
    const ibge = escolasMap.get(co);
    if (!ibge) { skipped++; continue; }
    matched++;
    let entry = agregado.get(ibge);
    if (!entry) { entry = {}; agregado.set(ibge, entry); }
    for (const [etapa, cols] of Object.entries(ETAPA_COLS)) {
      let sum = 0;
      for (const col of cols) sum += Number(r[col]) || 0;
      if (sum > 0) entry[etapa] = (entry[etapa] ?? 0) + sum;
    }
  }
  await send({ type: "progress", message: `${matched.toLocaleString("pt-BR")} escolas municipais reconciliadas · ${skipped.toLocaleString("pt-BR")} ignoradas (privadas/estaduais/federais). ${agregado.size.toLocaleString("pt-BR")} municípios com matrículas.` });

  // Persiste matrículas por etapa e total por município.
  const ano = new Date().getFullYear();
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
    if (total > 0) totais.push({ ibge_id: ibge, matriculas_total: total });
  }

  // Apaga matrículas do ano corrente para todos os municípios afetados, depois insere.
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

  // Atualiza total por município em paralelo.
  const CONC = 20;
  let idx = 0;
  async function worker() {
    while (idx < totais.length) {
      const i = idx++;
      const t = totais[i];
      const { error } = await supabaseAdmin.from("municipios").update({ matriculas_total: t.matriculas_total }).eq("ibge_id", t.ibge_id);
      if (error) throw new Error(`municipios ${t.ibge_id}: ${error.message}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  const totalGeral = totais.reduce((a, b) => a + b.matriculas_total, 0);
  await send({ type: "progress", message: `Concluído: ${totalGeral.toLocaleString("pt-BR")} matrículas municipais em ${totais.length.toLocaleString("pt-BR")} municípios.` });
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
