import { el, icon } from "../utils/dom.js";
import { escapeHtml } from "../utils/noteContent.js";
import { GridModel, displayText, plainText, parseInput, aggregate, isNumericKind } from "../utils/gridModel.js";
import { toTSV, parseTSV } from "../utils/gridExport.js";
import { DEFAULT, GENERATED, isMarker } from "../utils/sqlDialect.js";
import { openFilterPopup } from "./dataGridFilter.js";
import { createCellEditor, openValueEditor } from "./dataGridEditor.js";

// DataGrid genérico (não sabe nada de banco): tabela "tipo Excel" virtualizada nos dois eixos.
//
// Só as linhas e colunas visíveis (+ margem) viram HTML; o resto é um "sizer" com o tamanho
// total para a barra de rolagem. Coordenadas: `v` = posição na visão (após filtro/ordenação),
// `d` = posição da coluna na ordem exibida; o modelo usa `r` (linha) e `c` (coluna) originais.

const RH = 24; // altura da linha
const HH = 30; // altura do cabeçalho
const OVERSCAN_R = 10;
const OVERSCAN_PX = 300;
const MIN_W = 44;
const AGG_CELL_LIMIT = 200_000;
const CELL_TEXT_LIMIT = 300;

const KIND_ICONS = {
  int: "fa-solid fa-hashtag",
  num: "fa-solid fa-hashtag",
  dec: "fa-solid fa-hashtag",
  bool: "fa-solid fa-toggle-on",
  str: "fa-solid fa-font",
  date: "fa-regular fa-calendar",
  datetime: "fa-regular fa-clock",
  time: "fa-regular fa-clock",
  guid: "fa-solid fa-fingerprint",
  bin: "fa-solid fa-file-zipper",
  xml: "fa-solid fa-code",
  oid: "fa-solid fa-fingerprint",
  json: "fa-solid fa-diagram-project",
  other: "fa-solid fa-circle-question",
};

let measureCtx = null;
function measure(text, font) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Retorno de setSelectedTo para "não alterar esta célula" (undefined é um valor: campo ausente). */
const SKIP = Symbol("skip");

/**
 * opts:
 *  - editable: permite editar (o host decide pela PK/conexão)
 *  - showMenu(x, y, items): menu de contexto do host (formato de http.js/showMenu)
 *  - cellMenuItems(ctx) / headerMenuItems(col): itens extras do host
 *  - serverFilter(col, text, "eq" | "contains"): busca do popup de filtro levada ao servidor
 *  - onChange(): alterações pendentes mudaram
 *  - onStatus({ rows, total, selection, pending }): rodapé
 *  - onError(message)
 *  - onSubmit(): Ctrl+Enter no grid (enviar alterações)
 *  - parseValue(text, column, r, c): texto editado → valor (padrão: parseInput pela classe da coluna)
 *  - editText(value, column, r, { expanded }): texto inicial do editor (padrão: o valor como texto)
 */
export function createDataGrid(opts = {}) {
  const model = new GridModel();
  let editable = !!opts.editable;
  let order = []; // posição exibida -> índice da coluna
  let widths = []; // por índice de coluna
  let hidden = new Set();
  let message = "";
  let recordMode = false;

  // Seleção (coordenadas exibidas)
  let ranges = []; // [{ v0, v1, d0, d1 }] normalizados
  let active = { v: 0, d: 0 };
  let anchor = { v: 0, d: 0 };

  // Busca
  let findText = "";
  let findHits = null; // Set "v:d"

  const root = el("div.dg", { tabindex: "0" });
  const scroll = el("div.dg-scroll");
  const sizer = el("div.dg-sizer");
  const head = el("div.dg-head");
  const corner = el("div.dg-corner", { title: "Selecionar tudo (Ctrl+A)" });
  const hcells = el("div.dg-hcells");
  const body = el("div.dg-body");
  const msgEl = el("div.dg-msg", { hidden: true });
  const dropLine = el("div.dg-drop", { hidden: true });
  head.append(corner, hcells);
  sizer.append(head, body, dropLine);
  scroll.append(sizer);

  const findInput = el("input", { type: "search", placeholder: "Buscar no resultado", spellcheck: false, autocomplete: "off" });
  const findCount = el("span.dg-find-count");
  const findBar = el(
    "div.dg-find",
    { hidden: true },
    icon("fa-solid fa-magnifying-glass"),
    findInput,
    findCount,
    el("button.hx-icon-btn", { type: "button", title: "Anterior (Shift+F3)", onclick: () => findStep(-1) }, icon("fa-solid fa-chevron-up")),
    el("button.hx-icon-btn", { type: "button", title: "Próximo (F3)", onclick: () => findStep(1) }, icon("fa-solid fa-chevron-down")),
    el("button.hx-icon-btn", { type: "button", title: "Fechar (Esc)", onclick: () => closeFind() }, icon("fa-solid fa-xmark")),
  );
  const record = el("div.dg-record", { hidden: true });
  root.append(findBar, scroll, record, msgEl);

  const editor = createCellEditor({
    container: sizer,
    onCommit: commitEdit,
    onCancel: () => root.focus({ preventScroll: true }),
    onExpand: (text) => openValueFor(active, text),
  });

  // ---------- Geometria ----------

  let xs = []; // início de cada coluna exibida (sem a coluna de números)
  let totalW = 0;
  let rnW = 48;
  let font = "12px monospace";

  function layout() {
    xs = new Array(order.length);
    let x = 0;
    for (let d = 0; d < order.length; d++) {
      xs[d] = x;
      x += widths[order[d]];
    }
    totalW = x;
    rnW = Math.max(44, String(model.view.length || 1).length * 8 + 22);
    sizer.style.width = `${rnW + totalW}px`;
    sizer.style.height = `${HH + model.view.length * RH}px`;
    root.style.setProperty("--dg-rn", `${rnW}px`);
  }

  /** Coluna exibida sob o x do conteúdo (já sem a coluna de números). */
  function displayAt(x) {
    let lo = 0;
    let hi = order.length - 1;
    if (hi < 0 || x < 0) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    return x < xs[lo] + widths[order[lo]] ? lo : -1;
  }

  function pointFromEvent(e) {
    const rect = scroll.getBoundingClientRect();
    const x = e.clientX - rect.left + scroll.scrollLeft - rnW;
    const y = e.clientY - rect.top + scroll.scrollTop - HH;
    return { v: Math.floor(y / RH), d: displayAt(x), x, y, inRowNumbers: e.clientX - rect.left < rnW };
  }

  // ---------- Pintura ----------

  let frame = 0;
  let painted = { v0: -1, v1: -1, d0: -1, d1: -1 };
  let dirty = true;

  function schedule(force = false) {
    if (force) dirty = true;
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function visibleWindow() {
    const h = scroll.clientHeight || 600;
    const w = scroll.clientWidth || 1000;
    const v0 = Math.max(0, Math.floor(scroll.scrollTop / RH) - OVERSCAN_R);
    const v1 = Math.min(model.view.length - 1, Math.ceil((scroll.scrollTop + h) / RH) + OVERSCAN_R);
    const left = scroll.scrollLeft - OVERSCAN_PX;
    const right = scroll.scrollLeft + w + OVERSCAN_PX - rnW;
    const leftX = Math.max(0, left);
    let d0 = displayAt(leftX);
    if (d0 < 0) d0 = leftX >= totalW ? Math.max(0, order.length - 1) : 0;
    let d1 = order.length - 1;
    for (let d = d0; d < order.length; d++) {
      if (xs[d] > right) {
        d1 = d;
        break;
      }
    }
    return { v0, v1, d0, d1 };
  }

  function inSelection(v, d) {
    for (const s of ranges) if (v >= s.v0 && v <= s.v1 && d >= s.d0 && d <= s.d1) return true;
    return false;
  }

  function cellText(value) {
    if (value === undefined) return ""; // campo ausente (documentos)
    if (value === null) return '<span class="dg-null">&lt;null&gt;</span>';
    if (isMarker(value)) return `<span class="dg-marker">${escapeHtml(String(value))}</span>`;
    let s = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    if (s.length > CELL_TEXT_LIMIT) s = s.slice(0, CELL_TEXT_LIMIT) + "…";
    return escapeHtml(s).replace(/\r?\n/g, '<span class="dg-nl">↵</span>');
  }

  function paint() {
    frame = 0;
    if (recordMode) return paintRecord();
    const w = visibleWindow();
    if (!dirty && w.v0 === painted.v0 && w.v1 === painted.v1 && w.d0 === painted.d0 && w.d1 === painted.d1) return;
    dirty = false;
    painted = w;

    // Cabeçalho
    let h = "";
    for (let d = w.d0; d <= w.d1 && d < order.length; d++) {
      const c = order[d];
      const col = model.columns[c];
      const dir = model.sortDir(c);
      const filtered = model.filters.has(c);
      const selCol = ranges.some((s) => d >= s.d0 && d <= s.d1 && s.v0 === 0 && s.v1 === model.view.length - 1 && model.view.length > 0);
      const keyIcon = col.is_pk ? '<i class="fa-solid fa-key dg-h-pk" title="Chave primária"></i>' : col.fk ? '<i class="fa-solid fa-link dg-h-fk" title="Chave estrangeira"></i>' : "";
      const title = escapeHtml(`${col.name} ${col.full_type || col.type || ""}${col.nullable === false ? " NOT NULL" : ""}${col.fk ? `\n→ ${col.fk.schema}.${col.fk.table}.${col.fk.column}` : ""}`);
      h +=
        `<div class="dg-h${selCol ? " sel" : ""}${dir ? " sorted" : ""}" data-d="${d}" style="left:${rnW + xs[d]}px;width:${widths[c]}px" title="${title}">` +
        `<i class="${KIND_ICONS[col.kind] || KIND_ICONS.other} dg-h-type"></i>${keyIcon}<span class="dg-h-name">${escapeHtml(col.name)}</span>` +
        `<button class="dg-h-btn dg-h-filter${filtered ? " on" : ""}" data-act="filter" title="Filtro local"><i class="fa-solid fa-filter"></i></button>` +
        `<button class="dg-h-btn dg-h-sort${dir ? " on" : ""}" data-act="sort" title="Ordenar (Shift: adicionar critério)"><i class="fa-solid ${dir === 1 ? "fa-arrow-up-short-wide" : dir === -1 ? "fa-arrow-down-wide-short" : "fa-sort"}"></i>${dir && model.sort.length > 1 ? `<sup>${model.sort.findIndex((s) => s.col === c) + 1}</sup>` : ""}</button>` +
        `<div class="dg-rs" data-act="resize"></div></div>`;
    }
    hcells.innerHTML = h;

    // Linhas
    let b = "";
    for (let v = w.v0; v <= w.v1; v++) {
      const r = model.view[v];
      const row = model.rows[r];
      const rs = model.rowState(r);
      const rowSel = ranges.some((s) => v >= s.v0 && v <= s.v1);
      b += `<div class="dg-row${rs ? ` ${rs}` : ""}${v === active.v ? " cur" : ""}" style="top:${v * RH}px"><div class="dg-rn${rowSel ? " sel" : ""}">${rs === "new" ? "+" : v + 1}</div>`;
      for (let d = w.d0; d <= w.d1 && d < order.length; d++) {
        const c = order[d];
        const cs = model.cellState(r, c);
        let cls = `dg-c k-${model.columns[c].kind}`;
        if (inSelection(v, d)) cls += " sel";
        if (v === active.v && d === active.d) cls += " act";
        if (cs === "edited") cls += " edited";
        if (findHits?.has(`${v}:${d}`)) cls += " hit";
        b += `<div class="${cls}" style="left:${rnW + xs[d]}px;width:${widths[c]}px">${cellText(row[c])}</div>`;
      }
      b += "</div>";
    }
    body.innerHTML = b;
  }

  // ---------- Modo registro (transposto) ----------

  function paintRecord() {
    const r = model.view[active.v];
    record.innerHTML = "";
    if (r === undefined) {
      record.append(el("div.dg-record-empty", {}, "Nenhuma linha"));
      return;
    }
    const row = model.rows[r];
    const nav = el(
      "div.dg-record-nav",
      {},
      el("button.hx-icon-btn", { type: "button", title: "Anterior (↑)", disabled: active.v === 0, onclick: () => moveRecord(-1) }, icon("fa-solid fa-chevron-up")),
      el("button.hx-icon-btn", { type: "button", title: "Próxima (↓)", disabled: active.v >= model.view.length - 1, onclick: () => moveRecord(1) }, icon("fa-solid fa-chevron-down")),
      el("span", {}, `Linha ${active.v + 1} de ${model.view.length.toLocaleString("pt-BR")}`),
      model.rowState(r) ? el("span.dg-record-state", {}, { new: "nova", edited: "alterada", deleted: "excluída" }[model.rowState(r)]) : null,
    );
    const list = el("div.dg-record-list");
    order.forEach((c, d) => {
      const col = model.columns[c];
      const valueEl = el("div.dg-record-val", { html: cellText(row[c]) });
      valueEl.classList.toggle("edited", model.cellState(r, c) === "edited");
      valueEl.classList.toggle("act", d === active.d);
      const line = el(
        "div.dg-record-row",
        {
          onclick: () => {
            active = { v: active.v, d };
            ranges = [{ v0: active.v, v1: active.v, d0: d, d1: d }];
            schedule(true);
            emitStatus();
          },
          ondblclick: () => openValueFor({ v: active.v, d }),
        },
        el("div.dg-record-name", {}, icon(KIND_ICONS[col.kind] || KIND_ICONS.other), col.is_pk ? icon("fa-solid fa-key dg-h-pk") : null, el("span", {}, col.name)),
        el("div.dg-record-type", {}, col.full_type || col.type || ""),
        valueEl,
      );
      list.append(line);
    });
    record.append(nav, list);
  }

  function moveRecord(delta) {
    const v = clamp(active.v + delta, 0, model.view.length - 1);
    setActive(v, active.d);
  }

  // ---------- Seleção ----------

  function normRange(a, b) {
    return { v0: Math.min(a.v, b.v), v1: Math.max(a.v, b.v), d0: Math.min(a.d, b.d), d1: Math.max(a.d, b.d) };
  }

  function setActive(v, d, { extend = false, add = false } = {}) {
    if (!model.view.length || !order.length) return;
    v = clamp(v, 0, model.view.length - 1);
    d = clamp(d, 0, order.length - 1);
    active = { v, d };
    if (extend) ranges[ranges.length - 1] = normRange(anchor, active);
    else {
      anchor = { v, d };
      const r = { v0: v, v1: v, d0: d, d1: d };
      ranges = add ? [...ranges, r] : [r];
    }
    ensureVisible(v, d);
    schedule(true);
    emitStatus();
  }

  function ensureVisible(v, d) {
    const top = v * RH;
    const viewH = scroll.clientHeight - HH;
    if (top < scroll.scrollTop) scroll.scrollTop = top;
    else if (top + RH > scroll.scrollTop + viewH) scroll.scrollTop = top + RH - viewH;
    if (d >= 0 && d < order.length) {
      const left = xs[d];
      const right = left + widths[order[d]];
      const viewW = scroll.clientWidth - rnW;
      if (left < scroll.scrollLeft) scroll.scrollLeft = left;
      else if (right > scroll.scrollLeft + viewW) scroll.scrollLeft = Math.min(left, right - viewW);
    }
  }

  function selectAll() {
    if (!model.view.length || !order.length) return;
    ranges = [{ v0: 0, v1: model.view.length - 1, d0: 0, d1: order.length - 1 }];
    schedule(true);
    emitStatus();
  }

  function resetSelection() {
    active = { v: Math.min(active.v, Math.max(0, model.view.length - 1)), d: Math.min(active.d, Math.max(0, order.length - 1)) };
    anchor = { ...active };
    ranges = model.view.length && order.length ? [{ v0: active.v, v1: active.v, d0: active.d, d1: active.d }] : [];
  }

  /** Linhas (índices do modelo) tocadas pela seleção, na ordem da visão. */
  function selectedRows() {
    const set = new Set();
    for (const s of ranges) for (let v = s.v0; v <= s.v1; v++) set.add(v);
    return [...set].sort((a, b) => a - b).map((v) => model.view[v]).filter((r) => r !== undefined);
  }

  /** Colunas (índices do modelo) tocadas pela seleção, na ordem exibida. */
  function selectedCols() {
    const set = new Set();
    for (const s of ranges) for (let d = s.d0; d <= s.d1; d++) set.add(d);
    return [...set].sort((a, b) => a - b).map((d) => order[d]);
  }

  function forEachSelectedCell(fn) {
    const seen = new Set();
    for (const s of ranges) {
      for (let v = s.v0; v <= s.v1; v++) {
        for (let d = s.d0; d <= s.d1; d++) {
          const key = v * 100000 + d;
          if (seen.has(key)) continue;
          seen.add(key);
          fn(model.view[v], order[d], v, d);
        }
      }
    }
  }

  function emitStatus() {
    let selection = null;
    const cells = ranges.reduce((n, s) => n + (s.v1 - s.v0 + 1) * (s.d1 - s.d0 + 1), 0);
    if (cells > 1 && cells <= AGG_CELL_LIMIT) {
      const values = [];
      const kinds = [];
      forEachSelectedCell((r, c) => {
        values.push(model.rows[r]?.[c]);
        kinds.push(model.columns[c].kind);
      });
      selection = aggregate(values, kinds);
    } else if (cells > AGG_CELL_LIMIT) selection = { count: cells };
    opts.onStatus?.({ rows: model.view.length, total: model.rows.length - model.removed.size, selection, pending: model.pendingCount, active: activeCell() });
  }

  function activeCell() {
    const r = model.view[active.v];
    const c = order[active.d];
    return r === undefined || c === undefined ? null : { r, c, v: active.v, d: active.d, value: model.rows[r][c], column: model.columns[c] };
  }

  // ---------- Edição ----------

  const parseCell = (text, c, r) => (opts.parseValue ? opts.parseValue(text, model.columns[c], r, c) : parseInput(text, model.columns[c].kind));
  const textOf = (value, c, r, expanded = false) =>
    opts.editText ? opts.editText(value, model.columns[c], r, { expanded }) : value === null || value === undefined || isMarker(value) ? "" : plainText(value);

  function columnEditable(c, r) {
    const col = model.columns[c];
    if (!editable || !col || col.is_identity || col.is_computed || model.deleted.has(r)) return false;
    const v = model.rows[r]?.[c];
    // Binário truncado na leitura não pode ser regravado.
    return !(col.kind === "bin" && typeof v === "string" && v.endsWith("…"));
  }

  function startEdit(initial = null) {
    const cell = activeCell();
    if (!cell) return;
    if (!columnEditable(cell.c, cell.r)) {
      if (editable) opts.onError?.(`A coluna "${cell.column.name}" não pode ser editada`);
      return;
    }
    const v = cell.value;
    if (typeof v === "string" && (v.length > 2000 || (v.includes("\n") && initial === null))) return openValueFor(active);
    // Subdocumentos/arrays são editados no editor de valor (texto identado).
    if (cell.column.kind === "json" && initial === null && v !== undefined && v !== null) return openValueFor(active);
    ensureVisible(active.v, active.d);
    editor.open({
      left: rnW + xs[active.d],
      top: HH + active.v * RH,
      width: widths[cell.c],
      height: RH,
      text: initial ?? textOf(v, cell.c, cell.r),
      selectAll: initial === null,
    });
  }

  function commitEdit(text, move) {
    const cell = activeCell();
    if (!cell) return true;
    let value;
    try {
      value = parseCell(text, cell.c, cell.r);
    } catch (e) {
      opts.onError?.(e.message);
      return false;
    }
    // Texto vazio em coluna NOT NULL de texto vira string vazia, não NULL.
    if (value === null && cell.column.kind === "str" && text === "" && cell.column.nullable === false) value = "";
    if (model.setCell(cell.r, cell.c, value)) changed();
    root.focus({ preventScroll: true });
    if (move === "down") setActive(active.v + 1, active.d);
    else if (move === "right") setActive(active.v, active.d + 1);
    else if (move === "left") setActive(active.v, active.d - 1);
    else schedule(true);
    return true;
  }

  function openValueFor(pos, text = null) {
    const r = model.view[pos.v];
    const c = order[pos.d];
    if (r === undefined || c === undefined) return;
    const col = model.columns[c];
    const value = model.rows[r][c];
    const canEdit = columnEditable(c, r);
    openValueEditor({
      host: root,
      title: col.name,
      subtitle: `${col.full_type || col.type || ""} · linha ${pos.v + 1}`,
      text: text ?? textOf(value, c, r, true),
      readOnly: !canEdit,
      onSave: (t) => {
        try {
          if (model.setCell(r, c, parseCell(t, c, r))) changed();
        } catch (e) {
          opts.onError?.(e.message);
        }
        schedule(true);
        root.focus({ preventScroll: true });
      },
      onSetNull: col.nullable === false ? null : () => {
        if (model.setCell(r, c, null)) changed();
        schedule(true);
      },
    });
  }

  function changed() {
    layout();
    schedule(true);
    emitStatus();
    opts.onChange?.();
  }

  function setSelectedTo(valueFor) {
    let any = false;
    let blocked = 0;
    forEachSelectedCell((r, c) => {
      if (!columnEditable(c, r)) return blocked++;
      const value = valueFor(model.columns[c], r, c);
      if (value === SKIP) return blocked++;
      if (model.setCell(r, c, value)) any = true;
    });
    if (blocked && !any) opts.onError?.("Células selecionadas não podem receber esse valor");
    if (any) changed();
  }

  function setNullSelected() {
    setSelectedTo((col) => (col.nullable === false ? SKIP : null));
  }

  function setDefaultSelected() {
    let blocked = false;
    forEachSelectedCell((r) => {
      if (!model.added.has(r)) blocked = true;
    });
    if (blocked) return opts.onError?.("DEFAULT só vale para linhas novas");
    setSelectedTo(() => DEFAULT);
  }

  function addRow() {
    if (!editable) return;
    const after = model.view.length ? active.v : -1;
    model.addRow(model.blankRow(), after);
    changed();
    const firstEditable = order.findIndex((c) => !model.columns[c].is_identity && !model.columns[c].is_computed);
    setActive(after + 1, Math.max(0, firstEditable));
  }

  function duplicateRows() {
    if (!editable) return;
    const rows = selectedRows();
    let pos = Math.max(...ranges.map((s) => s.v1));
    for (const r of rows) {
      const copy = model.rows[r].map((v, c) => {
        const col = model.columns[c];
        if (col.is_identity || col.is_computed) return GENERATED;
        return col.is_pk && !model.added.has(r) ? DEFAULT : v;
      });
      model.addRow(copy, pos++);
    }
    changed();
  }

  function deleteSelectedRows() {
    if (!editable) return;
    model.deleteRows(selectedRows());
    resetSelection();
    changed();
  }

  function revertSelected() {
    model.revertRows(selectedRows());
    model.refreshView();
    resetSelection();
    changed();
  }

  // ---------- Copiar / colar ----------

  function selectionMatrix() {
    const rows = selectedRows();
    const cols = selectedCols();
    return { rows, cols, data: rows.map((r) => cols.map((c) => model.rows[r][c])), names: cols.map((c) => model.columns[c].name), columns: cols.map((c) => model.columns[c]) };
  }

  async function copySelection(withHeader = false) {
    const m = selectionMatrix();
    if (!m.rows.length) return;
    const text = m.rows.length === 1 && m.cols.length === 1 && !withHeader ? plainText(m.data[0][0]) : toTSV(m.names, m.data, { header: withHeader });
    try {
      await navigator.clipboard.writeText(text);
      opts.onCopied?.(m.rows.length * m.cols.length);
    } catch {
      opts.onError?.("Não foi possível copiar");
    }
  }

  async function paste() {
    if (!editable) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return opts.onError?.("Não foi possível ler a área de transferência");
    }
    const data = parseTSV(text);
    if (!data.length) return;
    const start = { ...active };
    // Um único valor colado numa seleção maior preenche a seleção inteira.
    if (data.length === 1 && data[0].length === 1 && ranges.length === 1 && (ranges[0].v1 > ranges[0].v0 || ranges[0].d1 > ranges[0].d0)) {
      return setSelectedTo((col, r, c) => {
        try {
          return parseCell(data[0][0], c, r);
        } catch {
          return SKIP;
        }
      });
    }
    let errors = 0;
    let added = 0;
    for (let i = 0; i < data.length; i++) {
      let v = start.v + i;
      if (v >= model.view.length) {
        model.addRow(model.blankRow(), model.view.length - 1);
        added++;
        v = model.view.length - 1;
      }
      const r = model.view[v];
      for (let j = 0; j < data[i].length; j++) {
        const d = start.d + j;
        if (d >= order.length) break;
        const c = order[d];
        if (!columnEditable(c, r)) {
          errors++;
          continue;
        }
        try {
          model.setCell(r, c, parseCell(data[i][j], c, r));
        } catch {
          errors++;
        }
      }
    }
    ranges = [{ v0: start.v, v1: Math.min(model.view.length - 1, start.v + data.length - 1), d0: start.d, d1: Math.min(order.length - 1, start.d + Math.max(...data.map((r) => r.length)) - 1) }];
    changed();
    if (errors) opts.onError?.(`${errors} valor(es) não puderam ser colados (coluna somente leitura ou tipo inválido)`);
    else if (added) opts.onInfo?.(`${added} linha(s) nova(s) criada(s) pela colagem`);
  }

  // ---------- Busca ----------

  function openFind() {
    findBar.hidden = false;
    findInput.focus();
    findInput.select();
  }

  function closeFind() {
    findBar.hidden = true;
    findText = "";
    findHits = null;
    findInput.value = "";
    findCount.textContent = "";
    schedule(true);
    root.focus({ preventScroll: true });
  }

  function runFind() {
    findText = findInput.value.trim().toLowerCase();
    if (!findText) {
      findHits = null;
      findCount.textContent = "";
      return schedule(true);
    }
    findHits = new Set();
    for (let v = 0; v < model.view.length && findHits.size < 100000; v++) {
      const row = model.rows[model.view[v]];
      for (let d = 0; d < order.length; d++) {
        const value = row[order[d]];
        if (value !== null && value !== undefined && displayText(value).toLowerCase().includes(findText)) findHits.add(`${v}:${d}`);
      }
    }
    findCount.textContent = findHits.size ? `${findHits.size.toLocaleString("pt-BR")} ocorrência(s)` : "nada encontrado";
    if (findHits.size && !findHits.has(`${active.v}:${active.d}`)) findStep(1);
    schedule(true);
  }

  function findStep(dir) {
    if (!findHits?.size) return;
    const total = model.view.length * order.length;
    let i = active.v * order.length + active.d;
    for (let n = 0; n < total; n++) {
      i = (i + dir + total) % total;
      const v = Math.floor(i / order.length);
      const d = i % order.length;
      if (findHits.has(`${v}:${d}`)) return setActive(v, d);
    }
  }

  findInput.addEventListener("input", runFind);
  findInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" || e.key === "F3") {
      e.preventDefault();
      findStep(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") closeFind();
  });

  // ---------- Colunas ----------

  function defaultWidth(c) {
    const col = model.columns[c];
    const headerW = measure(col.name, `600 12px ${getComputedStyle(root).getPropertyValue("--nt-font") || "sans-serif"}`) + 96;
    let contentW = 0;
    const sample = Math.min(model.view.length, 60);
    for (let i = 0; i < sample; i++) {
      const v = model.rows[model.view[i]][c];
      const s = v === null || v === undefined ? "<null>" : displayText(v);
      contentW = Math.max(contentW, Math.min(s.length, 60));
    }
    const charW = measure("0", font);
    return Math.round(clamp(Math.max(headerW, contentW * charW + 18), 70, 420));
  }

  function autoFit(c) {
    const col = model.columns[c];
    let w = measure(col.name, `600 12px sans-serif`) + 96;
    const n = Math.min(model.view.length, 2000);
    for (let i = 0; i < n; i++) {
      const v = model.rows[model.view[i]][c];
      const s = v === null || v === undefined ? "<null>" : displayText(v).slice(0, 200);
      w = Math.max(w, measure(s, font) + 18);
    }
    widths[c] = Math.round(clamp(w, MIN_W, 900));
    layout();
    schedule(true);
  }

  function hideColumn(c) {
    if (order.length <= 1) return;
    hidden.add(c);
    order = order.filter((x) => x !== c);
    resetSelection();
    layout();
    schedule(true);
  }

  function showAllColumns() {
    hidden.clear();
    order = model.columns.map((_, i) => i);
    layout();
    schedule(true);
  }

  function openFilter(c, x, y) {
    const col = model.columns[c];
    openFilterPopup({
      host: root,
      x,
      y,
      title: `Filtro local de "${col.name}"`,
      items: model.distinct(c),
      selected: model.filters.get(c) || null,
      onChange: applyLocal,
      // O filtro local só vê as linhas carregadas: a aba pode buscar o texto no servidor.
      server: opts.serverFilter
        ? {
            run: (text, mode) => {
              applyLocal(null);
              opts.serverFilter(col, text, mode);
            },
          }
        : null,
    });

    function applyLocal(set) {
      model.setFilter(c, set);
      resetSelection();
      layout();
      schedule(true);
      emitStatus();
      return model.view.length;
    }
  }

  function sortBy(c, dir, add = false) {
    model.setSort(c, dir, add);
    resetSelection();
    layout();
    schedule(true);
    emitStatus();
  }

  function cycleSort(c, add) {
    const cur = model.sortDir(c);
    sortBy(c, cur === 0 ? 1 : cur === 1 ? -1 : 0, add);
  }

  // ---------- Menus ----------

  function headerMenu(c, x, y) {
    const col = model.columns[c];
    opts.showMenu?.(x, y, [
      { header: col.name },
      { label: "Ordenar crescente (local)", icon: "fa-solid fa-arrow-up-short-wide", run: () => sortBy(c, 1) },
      { label: "Ordenar decrescente (local)", icon: "fa-solid fa-arrow-down-wide-short", run: () => sortBy(c, -1) },
      model.sortDir(c) ? { label: "Remover ordenação", icon: "fa-solid fa-xmark", run: () => sortBy(c, 0, true) } : null,
      ...(opts.headerMenuItems?.(col, c) || []),
      "sep",
      { label: "Filtro local…", icon: "fa-solid fa-filter", run: () => openFilter(c, x, y) },
      model.filters.has(c) ? { label: "Limpar filtro da coluna", icon: "fa-solid fa-filter-circle-xmark", run: () => openFilterClear(c) } : null,
      model.filters.size ? { label: "Limpar todos os filtros", icon: "fa-solid fa-filter-circle-xmark", run: clearFilters } : null,
      "sep",
      { label: "Ajustar largura", icon: "fa-solid fa-arrows-left-right", run: () => autoFit(c) },
      { label: "Ocultar coluna", icon: "fa-regular fa-eye-slash", disabled: order.length <= 1, run: () => hideColumn(c) },
      hidden.size ? { label: `Mostrar colunas ocultas (${hidden.size})`, icon: "fa-regular fa-eye", run: showAllColumns } : null,
      { label: "Copiar nome", icon: "fa-regular fa-copy", run: () => navigator.clipboard.writeText(col.name).catch(() => {}) },
    ]);
  }

  function openFilterClear(c) {
    model.setFilter(c, null);
    resetSelection();
    layout();
    schedule(true);
    emitStatus();
  }

  function clearFilters() {
    model.clearFilters();
    resetSelection();
    layout();
    schedule(true);
    emitStatus();
  }

  function filterByActiveValue(exclude = false) {
    const cell = activeCell();
    if (!cell) return;
    const keys = model.distinct(cell.c).map((i) => i.key);
    const key = cell.value === null || cell.value === undefined ? "\u0000null" : displayText(cell.value);
    model.setFilter(cell.c, exclude ? new Set(keys.filter((k) => k !== key)) : new Set([key]));
    resetSelection();
    layout();
    schedule(true);
    emitStatus();
  }

  function cellMenu(x, y) {
    const cell = activeCell();
    if (!cell) return;
    const canEdit = editable && columnEditable(cell.c, cell.r);
    const rowsSel = selectedRows();
    const hasPendingSel = rowsSel.some((r) => model.rowState(r));
    opts.showMenu?.(x, y, [
      { label: "Copiar", icon: "fa-regular fa-copy", run: () => copySelection(false) },
      { label: "Copiar com cabeçalho", icon: "fa-regular fa-clone", run: () => copySelection(true) },
      ...(opts.copyAsItems?.(selectionMatrix()) || []),
      editable ? { label: "Colar", icon: "fa-regular fa-paste", run: paste } : null,
      "sep",
      { label: canEdit ? "Editar valor…" : "Ver valor…", icon: "fa-solid fa-up-right-and-down-left-from-center", run: () => openValueFor(active) },
      canEdit && cell.column.nullable !== false ? { label: "Definir NULL", icon: "fa-solid fa-ban", run: setNullSelected } : null,
      canEdit && model.added.has(cell.r) ? { label: "Definir DEFAULT", icon: "fa-solid fa-rotate-left", run: setDefaultSelected } : null,
      "sep",
      { label: "Filtrar por este valor", icon: "fa-solid fa-filter", run: () => filterByActiveValue(false) },
      { label: "Excluir este valor do filtro", icon: "fa-solid fa-filter-circle-xmark", run: () => filterByActiveValue(true) },
      model.filters.size ? { label: "Limpar filtros locais", icon: "fa-solid fa-xmark", run: clearFilters } : null,
      ...(opts.cellMenuItems?.(cell) || []),
      editable ? "sep" : null,
      editable ? { label: "Adicionar linha", icon: "fa-solid fa-plus", run: addRow } : null,
      editable ? { label: "Duplicar linha(s)", icon: "fa-regular fa-copy", run: duplicateRows } : null,
      editable ? { label: `Excluir ${rowsSel.length > 1 ? `${rowsSel.length} linhas` : "linha"}`, icon: "fa-regular fa-trash-can", danger: true, run: deleteSelectedRows } : null,
      hasPendingSel ? { label: "Reverter alterações selecionadas", icon: "fa-solid fa-rotate-left", run: revertSelected } : null,
    ]);
  }

  // ---------- Eventos ----------

  let drag = null; // { kind: "cells" | "rows" | "cols" | "resize" | "move", ... }

  function onMouseMove(e) {
    if (!drag) return;
    if (drag.kind === "resize") {
      widths[drag.c] = Math.max(MIN_W, Math.round(drag.w0 + e.clientX - drag.x0));
      layout();
      schedule(true);
      return;
    }
    if (drag.kind === "move") {
      if (!drag.moving && Math.abs(e.clientX - drag.x0) < 5) return;
      drag.moving = true;
      root.classList.add("dg-moving");
      const p = pointFromEvent(e);
      let target = p.d < 0 ? (p.x < 0 ? 0 : order.length) : p.x - xs[p.d] > widths[order[p.d]] / 2 ? p.d + 1 : p.d;
      drag.target = target;
      dropLine.hidden = false;
      dropLine.style.left = `${rnW + (target < order.length ? xs[target] : totalW) - 1}px`;
      autoScroll(e);
      return;
    }
    autoScroll(e);
    const p = pointFromEvent(e);
    const v = clamp(p.v, 0, model.view.length - 1);
    const d = p.d < 0 ? (p.x < 0 ? 0 : order.length - 1) : p.d;
    if (drag.kind === "rows") {
      active = { v, d: order.length - 1 };
      ranges[ranges.length - 1] = { v0: Math.min(drag.v, v), v1: Math.max(drag.v, v), d0: 0, d1: order.length - 1 };
    } else if (drag.kind === "cols") {
      active = { v: model.view.length - 1, d };
      ranges[ranges.length - 1] = { v0: 0, v1: model.view.length - 1, d0: Math.min(drag.d, d), d1: Math.max(drag.d, d) };
    } else {
      active = { v, d };
      ranges[ranges.length - 1] = normRange(anchor, active);
    }
    schedule(true);
  }

  function onMouseUp() {
    if (drag?.kind === "move" && drag.moving && drag.target !== undefined) {
      const from = drag.d;
      let to = drag.target;
      if (to !== from && to !== from + 1) {
        const [c] = order.splice(from, 1);
        if (to > from) to--;
        order.splice(to, 0, c);
        resetSelection();
        layout();
        schedule(true);
      }
    } else if (drag?.kind === "move" && !drag.moving) {
      selectColumns(drag.d, drag.e);
    }
    if (drag && drag.kind !== "resize" && drag.kind !== "move") emitStatus();
    drag = null;
    dropLine.hidden = true;
    root.classList.remove("dg-moving");
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  }

  function autoScroll(e) {
    const rect = scroll.getBoundingClientRect();
    if (e.clientY > rect.bottom - 10) scroll.scrollTop += RH;
    else if (e.clientY < rect.top + HH + 6) scroll.scrollTop -= RH;
    if (e.clientX > rect.right - 10) scroll.scrollLeft += 30;
    else if (e.clientX < rect.left + rnW + 4) scroll.scrollLeft -= 30;
  }

  function beginDrag(state) {
    drag = state;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function selectColumns(d, e) {
    if (!model.view.length) return;
    const r = { v0: 0, v1: model.view.length - 1, d0: d, d1: d };
    if (e.shiftKey) {
      ranges[ranges.length - 1] = { ...r, d0: Math.min(anchor.d, d), d1: Math.max(anchor.d, d) };
    } else {
      anchor = { v: 0, d };
      ranges = e.ctrlKey || e.metaKey ? [...ranges, r] : [r];
    }
    active = { v: active.v, d };
    schedule(true);
    emitStatus();
  }

  hcells.addEventListener("mousedown", (e) => {
    const h = e.target.closest(".dg-h");
    if (!h || e.button !== 0) return;
    const d = Number(h.dataset.d);
    const c = order[d];
    const act = e.target.closest("[data-act]")?.dataset.act;
    e.preventDefault();
    root.focus({ preventScroll: true });
    if (act === "resize") return beginDrag({ kind: "resize", c, x0: e.clientX, w0: widths[c] });
    if (act === "sort") return cycleSort(c, e.shiftKey);
    if (act === "filter") {
      const r = e.target.closest("[data-act]").getBoundingClientRect();
      return openFilter(c, r.left, r.bottom + 4);
    }
    beginDrag({ kind: "move", d, x0: e.clientX, e: { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey } });
  });
  hcells.addEventListener("dblclick", (e) => {
    if (e.target.closest('[data-act="resize"]')) autoFit(order[Number(e.target.closest(".dg-h").dataset.d)]);
  });
  hcells.addEventListener("contextmenu", (e) => {
    const h = e.target.closest(".dg-h");
    if (!h) return;
    e.preventDefault();
    headerMenu(order[Number(h.dataset.d)], e.clientX, e.clientY);
  });
  corner.addEventListener("mousedown", (e) => {
    e.preventDefault();
    root.focus({ preventScroll: true });
    selectAll();
  });

  body.addEventListener("mousedown", (e) => {
    if (e.button === 2) {
      // Clique direito fora da seleção seleciona a célula.
      const p = pointFromEvent(e);
      if (p.v >= 0 && p.v < model.view.length && p.d >= 0 && !inSelection(p.v, p.d)) setActive(p.v, p.d);
      return;
    }
    if (e.button !== 0) return;
    const p = pointFromEvent(e);
    if (p.v < 0 || p.v >= model.view.length) return;
    e.preventDefault();
    editor.commit("");
    root.focus({ preventScroll: true });
    if (p.inRowNumbers) {
      const r = { v0: p.v, v1: p.v, d0: 0, d1: order.length - 1 };
      if (e.shiftKey) ranges[ranges.length - 1] = { ...r, v0: Math.min(anchor.v, p.v), v1: Math.max(anchor.v, p.v) };
      else {
        anchor = { v: p.v, d: 0 };
        ranges = e.ctrlKey || e.metaKey ? [...ranges, r] : [r];
      }
      active = { v: p.v, d: active.d };
      schedule(true);
      emitStatus();
      return beginDrag({ kind: "rows", v: e.shiftKey ? anchor.v : p.v });
    }
    if (p.d < 0) return;
    if (e.shiftKey) setActive(p.v, p.d, { extend: true });
    else setActive(p.v, p.d, { add: e.ctrlKey || e.metaKey });
    beginDrag({ kind: "cells" });
  });
  body.addEventListener("dblclick", (e) => {
    const p = pointFromEvent(e);
    if (p.v < 0 || p.v >= model.view.length || p.d < 0) return;
    const cell = activeCell();
    if (e.ctrlKey && cell?.column.fk) return opts.onOpenFk?.(cell);
    if (cell && columnEditable(cell.c, cell.r)) startEdit();
    else openValueFor(active);
  });
  body.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    cellMenu(e.clientX, e.clientY);
  });
  scroll.addEventListener("scroll", () => schedule(), { passive: true });
  new ResizeObserver(() => schedule(true)).observe(scroll);

  root.addEventListener("keydown", (e) => {
    if (editor.isOpen || e.target !== root) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    const pageRows = Math.max(1, Math.floor((scroll.clientHeight - HH) / RH) - 1);
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (recordMode && (k === "ArrowUp" || k === "ArrowDown") && !ctrl) {
      handled();
      return moveRecord(k === "ArrowUp" ? -1 : 1);
    }
    if (k === "ArrowDown" || k === "ArrowUp" || k === "ArrowLeft" || k === "ArrowRight") {
      handled();
      const dv = k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : 0;
      const dd = k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0;
      let v = active.v + dv;
      let d = active.d + dd;
      if (ctrl) {
        if (dv) v = dv > 0 ? model.view.length - 1 : 0;
        if (dd) d = dd > 0 ? order.length - 1 : 0;
      }
      return setActive(v, d, { extend: e.shiftKey });
    }
    if (k === "PageDown" || k === "PageUp") {
      handled();
      return setActive(active.v + (k === "PageDown" ? pageRows : -pageRows), active.d, { extend: e.shiftKey });
    }
    if (k === "Home" || k === "End") {
      handled();
      if (ctrl) return setActive(k === "Home" ? 0 : model.view.length - 1, k === "Home" ? 0 : order.length - 1, { extend: e.shiftKey });
      return setActive(active.v, k === "Home" ? 0 : order.length - 1, { extend: e.shiftKey });
    }
    if (k === "Tab") {
      handled();
      return setActive(active.v, active.d + (e.shiftKey ? -1 : 1));
    }
    if (ctrl && k.toLowerCase() === "a") return handled(), selectAll();
    if (ctrl && k.toLowerCase() === "c") return handled(), copySelection(e.shiftKey);
    if (ctrl && k.toLowerCase() === "v") return handled(), paste();
    if (ctrl && k.toLowerCase() === "f") return handled(), openFind();
    if (ctrl && k.toLowerCase() === "d") return handled(), duplicateRows();
    if (ctrl && e.shiftKey && k.toLowerCase() === "n") return handled(), setNullSelected();
    if (ctrl && k === "Delete") return handled(), deleteSelectedRows();
    if (ctrl && k === "Enter") return handled(), opts.onSubmit?.();
    if (e.altKey && k === "Insert") return handled(), addRow();
    if (k === "F3") return handled(), findStep(e.shiftKey ? -1 : 1);
    if (k === "Escape" && !findBar.hidden) return handled(), closeFind();
    if (k === "Enter" && e.shiftKey) return handled(), openValueFor(active);
    if (k === "F2" || k === "Enter") return handled(), recordMode ? openValueFor(active) : startEdit();
    if ((k === "Delete" || k === "Backspace") && editable) return handled(), setNullSelected();
    if (k.length === 1 && !ctrl && !e.altKey && editable && !recordMode) {
      handled();
      startEdit(k);
    }
  });

  // ---------- API ----------

  function applyColumns(columns, keepLayout) {
    const prev = keepLayout && model.columns.length === columns.length && model.columns.every((c, i) => c.name === columns[i].name);
    model.setData(columns, []);
    if (!prev) {
      order = columns.map((_, i) => i);
      widths = columns.map(() => 120);
      hidden = new Set();
      widthsPending = true;
    }
    ranges = [];
    active = { v: 0, d: 0 };
    anchor = { v: 0, d: 0 };
    findHits = null;
  }

  let widthsPending = false;

  function fitWidthsIfNeeded() {
    if (!widthsPending || !model.view.length) return;
    widthsPending = false;
    font = `12px ${getComputedStyle(root).getPropertyValue("--nt-mono").trim() || "monospace"}`;
    widths = model.columns.map((_, c) => defaultWidth(c));
  }

  function refreshAll() {
    fitWidthsIfNeeded();
    layout();
    if (!ranges.length) resetSelection();
    msgEl.hidden = !message;
    msgEl.textContent = message;
    schedule(true);
    emitStatus();
  }

  return {
    root,
    model,
    /** Novas colunas (resultado novo). `keepLayout` mantém larguras/ordem se as colunas forem as mesmas. */
    setColumns(columns, { keepLayout = false } = {}) {
      applyColumns(columns, keepLayout);
      scroll.scrollTop = 0;
      refreshAll();
    },
    appendRows(rows) {
      model.appendRows(rows);
      refreshAll();
    },
    /** Colunas que apareceram depois (documentos com campos novos). */
    addColumns(cols) {
      if (!cols.length) return;
      const first = model.columns.length;
      model.addColumns(cols);
      font = `12px ${getComputedStyle(root).getPropertyValue("--nt-mono").trim() || "monospace"}`;
      cols.forEach((_, i) => {
        order.push(first + i);
        widths[first + i] = model.view.length ? defaultWidth(first + i) : 140;
      });
      refreshAll();
    },
    /** Aplica valueFor(column, r, c) às células selecionadas editáveis (ex.: remover campo). */
    setSelected: (valueFor) => setSelectedTo(valueFor),
    setRows(rows) {
      model.setData(model.columns, rows);
      ranges = [];
      refreshAll();
    },
    setMessage(text) {
      message = text || "";
      msgEl.hidden = !message;
      msgEl.textContent = message;
    },
    setEditable(on) {
      editable = !!on;
      root.classList.toggle("dg-editable", editable);
    },
    get editable() {
      return editable;
    },
    refresh: refreshAll,
    focus() {
      root.focus({ preventScroll: true });
    },
    selectedRows,
    activeCell,
    selectionMatrix,
    addRow,
    duplicateRows,
    deleteSelectedRows,
    setNullSelected,
    revertSelected,
    revertAll() {
      model.revertAll();
      resetSelection();
      changed();
    },
    acceptPending() {
      model.acceptPending();
      resetSelection();
      layout();
      schedule(true);
      emitStatus();
    },
    copySelection,
    paste,
    openFind,
    clearFilters,
    get recordMode() {
      return recordMode;
    },
    setRecordMode(on) {
      recordMode = !!on;
      scroll.hidden = recordMode;
      record.hidden = !recordMode;
      dirty = true;
      schedule(true);
    },
    /** Colunas visíveis (na ordem exibida) e linhas da visão atual, para exportar. */
    exportData({ selectionOnly = false } = {}) {
      if (selectionOnly) {
        const m = selectionMatrix();
        return { columns: m.columns, rows: m.data };
      }
      const cols = order.slice();
      return { columns: cols.map((c) => model.columns[c]), rows: model.view.map((r) => cols.map((c) => model.rows[r][c])) };
    },
    hasNumericSelection() {
      return selectedCols().some((c) => isNumericKind(model.columns[c].kind));
    },
  };
}
