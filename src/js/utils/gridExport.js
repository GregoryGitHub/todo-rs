// Copiar/exportar dados do grid (TSV para o Excel, CSV, JSON, Markdown, SQL) e ler TSV colado.

import { plainText, displayText } from "./gridModel.js";
import { isMarker } from "./sqlDialect.js";

/** Campo TSV/CSV: aspas quando há separador, quebra de linha ou aspas. */
function field(s, sep) {
  return s.includes(sep) || s.includes("\n") || s.includes("\r") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

/** rows: arrays de valores; names: cabeçalho opcional. */
export function toDelimited(names, rows, { sep = "\t", header = true } = {}) {
  const lines = [];
  if (header && names) lines.push(names.map((n) => field(String(n), sep)).join(sep));
  for (const r of rows) lines.push(r.map((v) => field(plainText(v), sep)).join(sep));
  return lines.join(sep === "\t" ? "\n" : "\r\n");
}

export const toTSV = (names, rows, opts = {}) => toDelimited(names, rows, { ...opts, sep: "\t" });
export const toCSV = (names, rows, opts = {}) => toDelimited(names, rows, { ...opts, sep: opts.sep || "," });

function jsonValue(v, kind) {
  if (v === null || v === undefined || isMarker(v)) return null;
  if (typeof v === "string" && (kind === "int" || kind === "num" || kind === "dec") && /^-?\d+(\.\d+)?$/.test(v)) {
    // Vira número só se não perder precisão (bigint/decimal grandes continuam string).
    const n = Number(v);
    const canonical = v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v;
    return String(n) === canonical ? n : v;
  }
  return v;
}

export function toJSON(columns, rows) {
  return JSON.stringify(
    rows.map((r) => Object.fromEntries(columns.map((c, i) => [c.name, jsonValue(r[i], c.kind)]))),
    null,
    2,
  );
}

export function toMarkdown(names, rows) {
  const esc = (s) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  const lines = [`| ${names.map((n) => esc(String(n))).join(" | ")} |`, `| ${names.map(() => "---").join(" | ")} |`];
  for (const r of rows) lines.push(`| ${r.map((v) => esc(displayText(v))).join(" | ")} |`);
  return lines.join("\n");
}

/** INSERTs para a tabela (ou um nome genérico para resultados de consulta). */
export function toSqlInserts(dialect, table, columns, rows) {
  const target = table ? dialect.qualified(table.schema, table.name) : dialect.quote("tabela");
  const names = columns.map((c) => dialect.quote(c.name)).join(", ");
  return rows.map((r) => `INSERT INTO ${target} (${names}) VALUES (${r.map((v, i) => dialect.literal(isMarker(v) ? null : v, columns[i].kind)).join(", ")});`).join("\n");
}

/** Valores de uma coluna como lista para `WHERE col IN (...)`. */
export function toSqlInList(dialect, column, values) {
  const uniq = [...new Set(values.map((v) => dialect.literal(isMarker(v) ? null : v, column.kind)))];
  return `${dialect.quote(column.name)} IN (${uniq.join(", ")})`;
}

/** Lê o TSV que o Excel/Sheets colocam na área de transferência (com campos entre aspas). */
export function parseTSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let i = 0;
  let quoted = false;
  let fieldStart = true;
  const s = text.replace(/\r\n?/g, "\n");
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
      i++;
      continue;
    }
    if (c === "\t") {
      row.push(cur);
      cur = "";
      fieldStart = true;
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      fieldStart = true;
      i++;
      continue;
    }
    cur += c;
    fieldStart = false;
    i++;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}
