import * as XLSX from "xlsx";
import type { ProspectResult } from "./prospect.types";
import type { ExportMunicipioRow } from "./catalog.functions";

export type ExportRow = {
  municipio: string;
  uf: string;
  result: ProspectResult;
  buscadoEm: string;
};

const headers = [
  "Município",
  "UF",
  "Secretário(a)",
  "Cargo",
  "E-mail",
  "Telefone",
  "Horário",
  "Equipe",
  "Fonte",
  "Hierarquia",
  "Data da Busca",
];

function equipeToStr(r: ExportRow): string {
  const eq = r.result.equipe ?? [];
  if (eq.length === 0) return "";
  return eq
    .map((m) => {
      const parts = [m.nome];
      if (m.cargo) parts.push(`(${m.cargo})`);
      const contatos = [m.email, m.telefone].filter(Boolean).join(" / ");
      if (contatos) parts.push(`— ${contatos}`);
      return parts.join(" ");
    })
    .join(" | ");
}

function rowFor(r: ExportRow) {
  const hierMap: Record<string, string> = {
    educacao: "Secretaria de Educação",
    camara: "Câmara Municipal",
    geral: "Secretaria Geral",
    gabinete: "Gabinete do Prefeito",
  };
  return [
    r.municipio,
    r.uf,
    r.result.secretario ?? "",
    r.result.cargo ?? "",
    r.result.emails.join("; "),
    r.result.telefones.join("; "),
    r.result.horarioAtendimento ?? "",
    equipeToStr(r),
    r.result.fonte ?? "",
    r.result.hierarquia ? hierMap[r.result.hierarquia] : "",
    r.buscadoEm,
  ];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(v: string) {
  if (/[";\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function exportCSV(rows: ExportRow[]) {
  const lines = [headers.map(csvEscape).join(";")];
  for (const r of rows) {
    lines.push(rowFor(r).map((v) => csvEscape(String(v))).join(";"));
  }
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  download(blob, `municipia_contatos_${today()}.csv`);
}

// ============ Export do catálogo de municípios (leads) ============
// Regra de negócio (decisão do cliente): cada CONTATO vira uma linha/lead
// própria — uma pessoa com um e-mail e um telefone por linha. Quando a
// pessoa tem vários e-mails/telefones, gera uma linha por combinação.

const municipioHeaders = [
  "Município",
  "UF",
  "Score",
  "Faixa",
  "Status",
  "Nome do contato",
  "Cargo",
  "Tipo de contato",
  "E-mail",
  "Telefone",
  "Horário",
  "População",
  "Matrículas",
  "FNDE anual",
  "Atualizado em",
];

const FAIXA_LABEL_PT: Record<string, string> = {
  alto: "Alto",
  medio: "Médio",
  baixo: "Baixo",
};

type ContatoLead = {
  nome: string;
  cargo: string;
  tipo: string;
  email: string;
  telefone: string;
};

function expandirContatos(r: ExportMunicipioRow): ContatoLead[] {
  const leads: ContatoLead[] = [];
  const usadosEmail = new Set<string>();
  const usadosFone = new Set<string>();

  const push = (nome: string, cargo: string, tipo: string, emails: string[], telefones: string[]) => {
    const es = emails.filter(Boolean);
    const ts = telefones.filter(Boolean);
    es.forEach((e) => usadosEmail.add(e.toLowerCase()));
    ts.forEach((t) => usadosFone.add(t));
    if (es.length === 0 && ts.length === 0) {
      if (nome) leads.push({ nome, cargo, tipo, email: "", telefone: "" });
      return;
    }
    const linhas = Math.max(es.length, ts.length);
    for (let i = 0; i < linhas; i++) {
      leads.push({ nome, cargo, tipo, email: es[i] ?? "", telefone: ts[i] ?? "" });
    }
  };

  // 1) Equipe — cada pessoa com seus próprios contatos.
  for (const m of r.equipe ?? []) {
    push(m.nome, m.cargo ?? "", "Equipe", m.email ? [m.email] : [], m.telefone ? [m.telefone] : []);
  }

  // 2) Secretário(a) — recebe os contatos gerais da secretaria.
  const emailsGerais = (r.emails ?? []).filter((e) => !usadosEmail.has(e.toLowerCase()));
  const fonesGerais = (r.telefones ?? []).filter((t) => !usadosFone.has(t));
  if (r.secretario) {
    push(r.secretario, r.cargo ?? "Secretário(a) de Educação", "Secretário(a)", emailsGerais, fonesGerais);
  } else if (emailsGerais.length > 0 || fonesGerais.length > 0) {
    // 3) Sem nome conhecido: contatos institucionais viram leads genéricos.
    push("", "Secretaria Municipal de Educação", "Contato geral", emailsGerais, fonesGerais);
  }

  if (leads.length === 0) {
    leads.push({ nome: r.secretario ?? "", cargo: r.cargo ?? "", tipo: "Sem contato", email: "", telefone: "" });
  }
  return leads;
}

function municipioLeadRows(r: ExportMunicipioRow): (string | number)[][] {
  return expandirContatos(r).map((c) => [
    r.nome,
    r.uf,
    r.score,
    FAIXA_LABEL_PT[r.faixa] ?? r.faixa,
    r.status,
    c.nome,
    c.cargo,
    c.tipo,
    c.email,
    c.telefone,
    r.horario ?? "",
    r.populacao,
    r.matriculas_total,
    r.fnde_anual,
    r.atualizado_em ?? "",
  ]);
}

function allLeadRows(rows: ExportMunicipioRow[]): (string | number)[][] {
  return rows.flatMap(municipioLeadRows);
}

export function exportMunicipiosCSV(rows: ExportMunicipioRow[]) {
  const lines = [municipioHeaders.map(csvEscape).join(";")];
  for (const row of allLeadRows(rows)) {
    lines.push(row.map((v) => csvEscape(String(v))).join(";"));
  }
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  download(blob, `municipia_leads_${today()}.csv`);
}

export function exportMunicipiosXLSX(rows: ExportMunicipioRow[]) {
  const body = allLeadRows(rows);
  const aoa = [municipioHeaders, ...body];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const colWidths = municipioHeaders.map((h, i) => {
    const maxLen = Math.max(h.length, ...body.map((r) => String(r[i] ?? "").length));
    return { wch: Math.min(Math.max(maxLen + 2, 12), 50) };
  });
  ws["!cols"] = colWidths;
  for (let c = 0; c < municipioHeaders.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[addr];
    if (cell) {
      cell.s = {
        font: { bold: true },
        fill: { fgColor: { rgb: "EEEEEE" } },
      };
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  download(blob, `municipia_leads_${today()}.xlsx`);
}


export function exportXLSX(rows: ExportRow[]) {
  const aoa = [headers, ...rows.map(rowFor)];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Larguras automáticas (aproximação)
  const colWidths = headers.map((h, i) => {
    const maxLen = Math.max(
      h.length,
      ...rows.map((r) => String(rowFor(r)[i] ?? "").length),
    );
    return { wch: Math.min(Math.max(maxLen + 2, 12), 50) };
  });
  ws["!cols"] = colWidths;
  // Estilo do cabeçalho (xlsx sem styles avançados — mantém em negrito via cellStyles quando suportado)
  for (let c = 0; c < headers.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[addr];
    if (cell) {
      cell.s = {
        font: { bold: true },
        fill: { fgColor: { rgb: "EEEEEE" } },
      };
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Contatos");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  download(blob, `municipia_contatos_${today()}.xlsx`);
}
