// Modelo do DataGrid (sem DOM): linhas, visão filtrada/ordenada e alterações pendentes.
//
// As linhas são arrays na ordem das colunas. Filtro e ordenação locais trabalham só com
// índices (`view`), sem copiar dados. Edições alteram a linha no lugar e guardam a original
// em `original`, para gerar UPDATE ... WHERE <pk original> e para reverter.

import { DEFAULT, GENERATED, isMarker } from "./sqlDialect.js";

export const NULL_KEY = "\u0000null";
/** Campo ausente no documento (MongoDB): diferente de NULL. */
export const MISSING_KEY = "\u0000missing";
const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const NUMERIC_KINDS = new Set(["int", "num", "dec"]);

export const isNumericKind = (kind) => NUMERIC_KINDS.has(kind);

/** Texto exibido/copiado de um valor. */
export function displayText(v) {
  if (v === undefined) return "";
  if (v === null) return "<null>";
  if (isMarker(v)) return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v);
}

/** Texto para copiar/exportar (NULL vira vazio em TSV/CSV). */
export function plainText(v) {
  if (v === null || v === undefined || isMarker(v)) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v);
}

export function filterKey(v) {
  if (v === undefined) return MISSING_KEY;
  return v === null ? NULL_KEY : displayText(v);
}

function numberOf(v) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** Comparação por classe de coluna; NULL primeiro. */
export function compareValues(a, b, kind) {
  const an = a === null || a === undefined || isMarker(a);
  const bn = b === null || b === undefined || isMarker(b);
  if (an || bn) return an === bn ? 0 : an ? -1 : 1;
  if (NUMERIC_KINDS.has(kind) || kind === "bool") {
    const x = numberOf(a);
    const y = numberOf(b);
    if (x !== null && y !== null && x !== y) return x < y ? -1 : 1;
    if (x !== null && y !== null) {
      // Inteiros grandes chegam como string: desempata com BigInt.
      if (typeof a === "string" && typeof b === "string" && /^-?\d+$/.test(a) && /^-?\d+$/.test(b)) {
        const p = BigInt(a);
        const q = BigInt(b);
        return p === q ? 0 : p < q ? -1 : 1;
      }
      return 0;
    }
  }
  if (kind === "date" || kind === "datetime" || kind === "time" || kind === "guid" || kind === "bin") {
    const x = String(a);
    const y = String(b);
    return x === y ? 0 : x < y ? -1 : 1;
  }
  return collator.compare(String(a), String(b));
}

/** Converte o texto digitado/colado para o valor da coluna. */
export function parseInput(text, kind) {
  if (text === null || text === undefined) return null;
  const s = String(text);
  if (NUMERIC_KINDS.has(kind)) {
    const t = s.trim().replace(/\s/g, "");
    if (!t) return null;
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) throw new Error(`"${s}" não é um número`);
    const n = Number(t);
    return kind !== "dec" && Number.isSafeInteger(n) && /^[+-]?\d+$/.test(t) ? n : kind === "num" ? n : t;
  }
  if (kind === "bool") {
    const t = s.trim().toLowerCase();
    if (!t) return null;
    if (["1", "true", "t", "yes", "y", "sim", "s", "on"].includes(t)) return true;
    if (["0", "false", "f", "no", "n", "não", "nao", "off"].includes(t)) return false;
    throw new Error(`"${s}" não é booleano (use 1/0)`);
  }
  if (kind === "guid") {
    const t = s.trim();
    if (!t) return null;
    if (!/^\{?[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}\}?$/.test(t)) throw new Error(`"${s}" não é um GUID`);
    return t.replace(/[{}]/g, "").toUpperCase();
  }
  if (kind === "bin") {
    const t = s.trim();
    if (!t) return null;
    if (!/^0x[0-9a-fA-F]*$/.test(t)) throw new Error("Binário deve estar no formato 0x0A1B...");
    return t;
  }
  if (kind === "date" || kind === "datetime" || kind === "time") return s.trim() ? s.trim() : null;
  return s;
}

export class GridModel {
  constructor(columns = [], rows = []) {
    this.setData(columns, rows);
  }

  setData(columns, rows = []) {
    this.columns = columns;
    this.rows = rows;
    this.sort = []; // [{ col, dir: 1 | -1 }]
    this.filters = new Map(); // col -> Set(filterKey) permitidos
    this.resetPending();
    this.refreshView();
  }

  resetPending() {
    this.original = new Map(); // row -> valores originais (linha base editada)
    this.edited = new Map(); // row -> Set(col)
    this.added = new Set(); // linhas novas
    this.deleted = new Set(); // linhas base marcadas para DELETE
    this.removed = new Set(); // linhas novas descartadas (somem da visão)
  }

  /** Acrescenta linhas vindas do servidor (streaming). */
  appendRows(rows) {
    const first = this.rows.length;
    for (const r of rows) this.rows.push(r);
    if (this.sort.length) return this.refreshView();
    for (let i = first; i < this.rows.length; i++) if (this.passes(i)) this.view.push(i);
  }

  passes(r, skipCol = -1) {
    if (this.removed.has(r)) return false;
    for (const [col, allowed] of this.filters) {
      if (col === skipCol) continue;
      if (!allowed.has(filterKey(this.rows[r][col]))) return false;
    }
    return true;
  }

  refreshView() {
    const view = [];
    for (let i = 0; i < this.rows.length; i++) if (this.passes(i)) view.push(i);
    if (this.sort.length) {
      const specs = this.sort.map((s) => ({ ...s, kind: this.columns[s.col]?.kind }));
      view.sort((a, b) => {
        // Linhas novas ficam no fim, na ordem em que foram criadas.
        const na = this.added.has(a);
        const nb = this.added.has(b);
        if (na || nb) return na === nb ? a - b : na ? 1 : -1;
        for (const s of specs) {
          const c = compareValues(this.rows[a][s.col], this.rows[b][s.col], s.kind);
          if (c) return c * s.dir;
        }
        return a - b;
      });
    }
    this.view = view;
  }

  /** Ordenação local; `add` (Shift) acrescenta como critério secundário. dir 0 remove. */
  setSort(col, dir, add = false) {
    const rest = add ? this.sort.filter((s) => s.col !== col) : [];
    this.sort = dir ? [...rest, { col, dir }] : rest;
    this.refreshView();
  }

  sortDir(col) {
    return this.sort.find((s) => s.col === col)?.dir || 0;
  }

  /** Valores distintos da coluna (com contagem), considerando os filtros das outras colunas. */
  distinct(col) {
    const counts = new Map();
    const sample = new Map();
    for (let i = 0; i < this.rows.length; i++) {
      if (!this.passes(i, col)) continue;
      const v = this.rows[i][col];
      const k = filterKey(v);
      counts.set(k, (counts.get(k) || 0) + 1);
      if (!sample.has(k)) sample.set(k, v);
    }
    const kind = this.columns[col]?.kind;
    return [...counts]
      .map(([key, count]) => ({ key, value: sample.get(key), count }))
      .sort((a, b) => compareValues(a.value, b.value, kind));
  }

  setFilter(col, allowedKeys) {
    if (allowedKeys) this.filters.set(col, allowedKeys);
    else this.filters.delete(col);
    this.refreshView();
  }

  clearFilters() {
    this.filters.clear();
    this.refreshView();
  }

  // ---------- Edição ----------

  setCell(r, c, value) {
    const row = this.rows[r];
    if (!row || this.deleted.has(r)) return false;
    if (Object.is(row[c], value)) return false;
    if (!this.added.has(r)) {
      if (!this.original.has(r)) this.original.set(r, row.slice());
      const orig = this.original.get(r);
      if (!this.edited.has(r)) this.edited.set(r, new Set());
      const cols = this.edited.get(r);
      row[c] = value;
      if (sameValue(orig[c], value)) cols.delete(c);
      else cols.add(c);
      if (!cols.size) {
        this.edited.delete(r);
        this.original.delete(r);
      }
    } else {
      row[c] = value;
      if (!this.edited.has(r)) this.edited.set(r, new Set());
      this.edited.get(r).add(c);
    }
    return true;
  }

  /** Nova linha (valores iniciais por coluna) inserida na visão depois de `afterViewPos`. */
  addRow(values, afterViewPos = this.view.length - 1) {
    const r = this.rows.length;
    this.rows.push(values);
    this.added.add(r);
    this.view.splice(Math.min(this.view.length, afterViewPos + 1), 0, r);
    return r;
  }

  /** Valores iniciais de uma linha nova: gerados, DEFAULT ou NULL conforme a coluna (ou `column.blank`). */
  blankRow() {
    return this.columns.map((c) => ("blank" in c ? c.blank : c.is_identity || c.is_computed ? GENERATED : c.has_default ? DEFAULT : c.nullable === false ? DEFAULT : null));
  }

  /** Colunas novas (documentos com campos diferentes): as linhas existentes ficam com o campo ausente. */
  addColumns(cols) {
    if (cols.length) this.columns.push(...cols);
  }

  deleteRows(rows) {
    for (const r of rows) {
      if (this.added.has(r)) {
        this.added.delete(r);
        this.edited.delete(r);
        this.removed.add(r);
      } else if (r < this.rows.length) {
        this.deleted.add(r);
      }
    }
    this.view = this.view.filter((r) => !this.removed.has(r));
  }

  revertRows(rows) {
    for (const r of rows) {
      if (this.added.has(r)) {
        this.deleteRows([r]);
        continue;
      }
      this.deleted.delete(r);
      const orig = this.original.get(r);
      if (orig) this.rows[r] = orig;
      this.original.delete(r);
      this.edited.delete(r);
    }
  }

  revertAll() {
    this.revertRows([...this.added, ...this.deleted, ...this.original.keys()]);
    this.resetPendingKeepRemoved();
    this.refreshView();
  }

  get pendingCount() {
    return this.added.size + this.deleted.size + [...this.edited.keys()].filter((r) => !this.added.has(r)).length;
  }

  /** Alterações a enviar ao banco. */
  pending() {
    const updates = [];
    for (const [r, cols] of this.edited) {
      if (this.added.has(r) || this.deleted.has(r) || !cols.size) continue;
      updates.push({ row: r, original: this.original.get(r), values: this.rows[r], cols: [...cols].sort((a, b) => a - b) });
    }
    const inserts = [...this.added].sort((a, b) => a - b).map((r) => ({ row: r, values: this.rows[r] }));
    const deletes = [...this.deleted].sort((a, b) => a - b).map((r) => ({ row: r, original: this.original.get(r) || this.rows[r] }));
    return { updates, inserts, deletes };
  }

  /** Depois de gravar no banco: as alterações viram o novo estado base. */
  acceptPending() {
    for (const r of this.deleted) this.removed.add(r);
    this.resetPendingKeepRemoved();
    this.refreshView();
  }

  resetPendingKeepRemoved() {
    const removed = this.removed;
    this.resetPending();
    this.removed = removed;
  }

  cellState(r, c) {
    if (this.deleted.has(r)) return "deleted";
    if (this.added.has(r)) return "new";
    return this.edited.get(r)?.has(c) ? "edited" : "";
  }

  rowState(r) {
    if (this.deleted.has(r)) return "deleted";
    if (this.added.has(r)) return "new";
    return this.edited.has(r) ? "edited" : "";
  }
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  return String(a) === String(b) && typeof a !== "boolean" && typeof b !== "boolean";
}

/** Contagem/soma/média/mín/máx de valores selecionados (rodapé, como no DataGrip). */
export function aggregate(values, kinds) {
  let count = 0;
  let nonNull = 0;
  let numeric = 0;
  let sum = 0;
  let min = null;
  let max = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    count++;
    if (v === null || v === undefined || isMarker(v)) continue;
    nonNull++;
    if (!NUMERIC_KINDS.has(kinds[i])) continue;
    const n = numberOf(v);
    if (n === null) continue;
    numeric++;
    sum += n;
    if (min === null || n < min) min = n;
    if (max === null || n > max) max = n;
  }
  return numeric ? { count, nonNull, numeric, sum, avg: sum / numeric, min, max } : { count, nonNull, numeric };
}
