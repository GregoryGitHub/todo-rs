// Gera os comandos UPDATE/INSERT/DELETE das alterações pendentes do grid.
// A linha é identificada pela chave primária com os valores ORIGINAIS (antes da edição).

import { isMarker } from "./sqlDialect.js";

/** Colunas que identificam a linha; sem PK a tabela fica somente leitura no grid. */
export function keyColumns(columns) {
  return columns.map((c, i) => (c.is_pk ? i : -1)).filter((i) => i >= 0);
}

export function canEditTable(info) {
  return !!info && info.kind === "table" && keyColumns(info.columns).length > 0;
}

function where(dialect, columns, keys, values) {
  return keys
    .map((i) => {
      const v = values[i];
      const col = dialect.quote(columns[i].name);
      return v === null || v === undefined ? `${col} IS NULL` : `${col} = ${dialect.literal(v, columns[i].kind)}`;
    })
    .join(" AND ");
}

/**
 * pending: resultado de GridModel.pending(). info: TableInfo (schema, name, columns com kind).
 * Devolve [{ sql, kind: "update" | "insert" | "delete", row }] na ordem DELETE → UPDATE → INSERT.
 */
export function buildChanges(dialect, info, pending) {
  const table = dialect.qualified(info.schema, info.name);
  const cols = info.columns;
  const keys = keyColumns(cols);
  if (!keys.length) throw new Error("A tabela não tem chave primária; edição desativada.");
  const out = [];

  for (const d of pending.deletes) {
    out.push({ kind: "delete", row: d.row, sql: `DELETE FROM ${table} WHERE ${where(dialect, cols, keys, d.original)}` });
  }
  for (const u of pending.updates) {
    const sets = u.cols
      .filter((i) => !cols[i].is_computed && !cols[i].is_identity)
      .map((i) => `${dialect.quote(cols[i].name)} = ${dialect.literal(u.values[i], cols[i].kind)}`);
    if (!sets.length) continue;
    out.push({ kind: "update", row: u.row, sql: `UPDATE ${table} SET ${sets.join(", ")} WHERE ${where(dialect, cols, keys, u.original)}` });
  }
  for (const ins of pending.inserts) {
    const idx = cols.map((_, i) => i).filter((i) => !cols[i].is_computed && !cols[i].is_identity && !isMarker(ins.values[i]));
    out.push({
      kind: "insert",
      row: ins.row,
      sql: idx.length
        ? `INSERT INTO ${table} (${idx.map((i) => dialect.quote(cols[i].name)).join(", ")}) VALUES (${idx.map((i) => dialect.literal(ins.values[i], cols[i].kind)).join(", ")})`
        : `INSERT INTO ${table} DEFAULT VALUES`,
    });
  }
  return out;
}
