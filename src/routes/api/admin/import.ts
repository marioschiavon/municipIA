import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import Papa from "papaparse";
import * as XLSX from "xlsx";

const ETAPA_INEP: Record<number, string> = {
  1: "creche", 2: "creche",
  3: "pre_escola", 4: "pre_escola",
  5: "fundamental_ai", 6: "fundamental_ai", 7: "fundamental_ai", 8: "fundamental_ai", 14: "fundamental_ai", 15: "fundamental_ai",
  9: "fundamental_af", 10: "fundamental_af", 11: "fundamental_af", 12: "fundamental_af", 13: "fundamental_af", 41: "fundamental_af",
  25: "medio", 26: "medio", 27: "medio", 28: "medio", 29: "medio", 30: "medio", 31: "medio", 32: "medio", 33: "medio", 34: "medio", 35: "medio", 36: "medio", 37: "medio", 38: "medio",
  65: "eja", 66: "eja", 67: "eja", 68: "eja", 69: "eja", 70: "eja", 71: "eja", 72: "eja", 73: "eja", 74: "eja",
  56: "especial", 57: "especial", 58: "especial", 59: "especial", 60: "especial", 61: "especial", 62: "especial", 63: "especial", 64: "especial",
  39: "profissionalizante", 40: "profissionalizante", 46: "profissionalizante", 47: "profissionalizante", 48: "profissionalizante", 49: "profissionalizante", 50: "profissionalizante", 51: "profissionalizante", 52: "profissionalizante", 53: "profissionalizante", 54: "profissionalizante", 55: "profissionalizante",
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
              const type = form.get("type") as "inep_matriculas" | "inep_escolas" | "fnde";
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

              if (type === "fnde") {
                await processFnde(content, supabaseAdmin, send, file.name);
              } else {
                await processInep(content, type, supabaseAdmin, send, file.name);
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

async function processInep(content: Uint8Array, type: "inep_matriculas" | "inep_escolas", supabaseAdmin: any, send: any, filename: string) {
  const text = new TextDecoder("utf-8").decode(content);
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, preview: 0 });
  const rows = parsed.data as Record<string, string>[];
  await send({ type: "progress", message: `${rows.length.toLocaleString("pt-BR")} linhas detectadas. Analisando formato...`, data: { headers: parsed.meta.fields } });

  const isResumido = parsed.meta.fields?.includes("ibge_id") && parsed.meta.fields?.includes("etapa");

  if (isResumido) {
    await processInepResumido(rows, type, supabaseAdmin, send);
  } else {
    await processInepBruto(rows, type, supabaseAdmin, send, filename);
  }
}

async function processInepResumido(rows: Record<string, string>[], type: "inep_matriculas" | "inep_escolas", supabaseAdmin: any, send: any) {
  const agregado = new Map<number, { matriculas: Record<string, number>; escolas: number }>();
  for (const row of rows) {
    const ibgeId = Number(row.ibge_id);
    if (!ibgeId) continue;
    let etapa = (row.etapa || "").toLowerCase().trim();
    if (!etapa) continue;
    if (!agregado.has(ibgeId)) agregado.set(ibgeId, { matriculas: {}, escolas: 0 });
    const entry = agregado.get(ibgeId)!;
    if (type === "inep_matriculas") {
      const q = Number(row.matriculas) || 0;
      entry.matriculas[etapa] = (entry.matriculas[etapa] || 0) + q;
    } else {
      entry.escolas = Number(row.escolas) || 0;
    }
  }
  await persistInep(agregado, type, supabaseAdmin, send);
}

async function processInepBruto(rows: Record<string, string>[], type: "inep_matriculas" | "inep_escolas", supabaseAdmin: any, send: any, filename: string) {
  const agregado = new Map<number, { matriculas: Record<string, number>; escolas: Set<string> }>();
  let coMunicipioField = "CO_MUNICIPIO";
  if (!rows[0] || !(coMunicipioField in rows[0])) {
    for (const key of Object.keys(rows[0] || {})) {
      if (key.toUpperCase().includes("MUNICIPIO")) { coMunicipioField = key; break; }
    }
  }
  let etapaField = "TP_ETAPA_ENSINO";
  if (!rows[0] || !(etapaField in rows[0])) {
    for (const key of Object.keys(rows[0] || {})) {
      if (key.toUpperCase().includes("ETAPA") || key.toUpperCase().includes("ENSINO")) { etapaField = key; break; }
    }
  }
  let escolaField = "CO_ENTIDADE";
  if (!rows[0] || !(escolaField in rows[0])) {
    for (const key of Object.keys(rows[0] || {})) {
      if (key.toUpperCase().includes("ENTIDADE") || key.toUpperCase().includes("ESCOLA") || key.toUpperCase().includes("CO_MEC")) { escolaField = key; break; }
    }
  }
  let matriculaField = "NU_MATRICULAS";
  if (!rows[0] || !(matriculaField in rows[0])) {
    for (const key of Object.keys(rows[0] || {})) {
      if (key.toUpperCase().includes("MATRICULA")) { matriculaField = key; break; }
    }
  }

  await send({ type: "progress", message: `Mapeamento de colunas: ${coMunicipioField}, ${type === "inep_matriculas" ? etapaField + ", " + matriculaField : escolaField}` });

  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    for (const row of slice) {
      const ibgeId = Number(row[coMunicipioField]);
      if (!ibgeId) continue;
      if (!agregado.has(ibgeId)) agregado.set(ibgeId, { matriculas: {}, escolas: new Set() });
      const entry = agregado.get(ibgeId)!;
      if (type === "inep_matriculas") {
        const code = Number(row[etapaField]);
        const etapa = ETAPA_INEP[code];
        if (!etapa) continue;
        const q = Number(row[matriculaField]) || 1;
        entry.matriculas[etapa] = (entry.matriculas[etapa] || 0) + q;
      } else {
        const schoolId = row[escolaField];
        if (schoolId) entry.escolas.add(schoolId);
      }
    }
    if (i % 20000 === 0) {
      await send({ type: "progress", message: `Processadas ${Math.min(i + CHUNK, rows.length).toLocaleString("pt-BR")} de ${rows.length.toLocaleString("pt-BR")} linhas...` });
    }
  }
  const converted = new Map<number, { matriculas: Record<string, number>; escolas: number }>();
  for (const [ibgeId, v] of agregado) {
    converted.set(ibgeId, { matriculas: v.matriculas, escolas: v.escolas.size });
  }
  await persistInep(converted, type, supabaseAdmin, send);
}

async function persistInep(agregado: Map<number, { matriculas: Record<string, number>; escolas: number }>, type: "inep_matriculas" | "inep_escolas", supabaseAdmin: any, send: any) {
  const ano = new Date().getFullYear();
  const ibgeIds = Array.from(agregado.keys());
  await send({ type: "progress", message: `${ibgeIds.length.toLocaleString("pt-BR")} municípios encontrados. Atualizando banco...` });

  let totalMatriculas = 0;
  const matRows: any[] = [];
  for (const ibgeId of ibgeIds) {
    const entry = agregado.get(ibgeId)!;
    if (type === "inep_matriculas") {
      await supabaseAdmin.from("municipios_matriculas_etapa").delete().eq("ibge_id", ibgeId).eq("ano", ano);
      for (const [etapa, mat] of Object.entries(entry.matriculas)) {
        if (mat > 0) {
          matRows.push({ ibge_id: ibgeId, etapa, matriculas: mat, ano });
          totalMatriculas += mat;
        }
      }
    }
  }
  for (let i = 0; i < matRows.length; i += 500) {
    const { error } = await supabaseAdmin.from("municipios_matriculas_etapa").insert(matRows.slice(i, i + 500));
    if (error) throw new Error(`matriculas_etapa: ${error.message}`);
  }

  for (let i = 0; i < ibgeIds.length; i += 100) {
    const slice = ibgeIds.slice(i, i + 100);
    for (const ibgeId of slice) {
      const entry = agregado.get(ibgeId)!;
      const update: any = {};
      if (type === "inep_matriculas") {
        const sum = Object.values(entry.matriculas).reduce((a, b) => a + b, 0);
        if (sum > 0) update.matriculas_total = sum;
      } else {
        if (entry.escolas > 0) update.escolas = entry.escolas;
      }
      if (Object.keys(update).length) {
        const { error } = await supabaseAdmin.from("municipios").update(update).eq("ibge_id", ibgeId);
        if (error) throw new Error(`municipios ${ibgeId}: ${error.message}`);
      }
    }
    await send({ type: "progress", message: `Atualizados ${Math.min(i + 100, ibgeIds.length).toLocaleString("pt-BR")} de ${ibgeIds.length.toLocaleString("pt-BR")} municípios...` });
  }
  await send({ type: "progress", message: `INEP ${type === "inep_matriculas" ? "matrículas" : "escolas"} importado. ${type === "inep_matriculas" ? totalMatriculas.toLocaleString("pt-BR") + " matrículas inseridas." : ""}` });
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
    const text = new TextDecoder("utf-8").decode(content);
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    rows = parsed.data as Record<string, string>[];
  }
  await send({ type: "progress", message: `${rows.length.toLocaleString("pt-BR")} linhas detectadas. Analisando formato...`, data: { headers: Object.keys(rows[0] || {}) } });

  let ibgeField: string | undefined;
  for (const key of Object.keys(rows[0] || {})) {
    if (key.toUpperCase().includes("IBGE") || key.toUpperCase().includes("CODIGO") || key.toUpperCase().includes("CÓDIGO")) {
      ibgeField = key; break;
    }
  }
  if (!ibgeField) throw new Error("Coluna de código IBGE não encontrada");

  const monthlyRe = /^(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)$/i;
  const monthCols = Object.keys(rows[0] || {}).filter((k) => monthlyRe.test(k.trim()));
  let totalField: string | undefined;
  for (const key of Object.keys(rows[0] || {})) {
    if (key.toUpperCase().includes("TOTAL") || key.toUpperCase().includes("VALOR") || key.toUpperCase().includes("REPASSE") || key.toUpperCase().includes("LIBERADO")) {
      totalField = key; break;
    }
  }

  const updates: { ibge_id: number; valor: number }[] = [];
  for (const row of rows) {
    const raw = row[ibgeField!].replace(/\D/g, "");
    const ibgeId = Number(raw.slice(0, 7));
    if (!ibgeId) continue;
    let valor = 0;
    if (monthCols.length) {
      valor = monthCols.reduce((acc, key) => acc + parseMoney(row[key]), 0);
    } else if (totalField) {
      valor = parseMoney(row[totalField]);
    }
    if (valor > 0) updates.push({ ibge_id: ibgeId, valor });
  }
  await send({ type: "progress", message: `${updates.length.toLocaleString("pt-BR")} municípios com valores válidos. Atualizando FNDE...` });
  for (const u of updates) {
    const { error } = await supabaseAdmin.from("municipios").update({ fnde_anual: u.valor }).eq("ibge_id", u.ibge_id);
    if (error) throw new Error(`fnde ${u.ibge_id}: ${error.message}`);
  }
  await send({ type: "progress", message: `FNDE atualizado: ${updates.length.toLocaleString("pt-BR")} municípios.` });
}

function parseMoney(value: string): number {
  if (!value) return 0;
  const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
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
