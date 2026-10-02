import { el, icon } from "../utils/dom.js";
import { toCSV, toTSV, toJSON, toMarkdown, toSqlInserts, toSqlInList } from "../utils/gridExport.js";
import { saveFileDialogApi, writeFileApi } from "../api.js";

// Peças comuns às abas de tabela e console: rodapé, "copiar como", exportação e transação.

const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString("pt-BR") : n.toLocaleString("pt-BR", { maximumFractionDigits: 6 }));

/** Rodapé: mensagem da última execução à esquerda, agregados da seleção à direita. */
export function createResultFooter() {
  const info = el("span.dbf-info");
  const sel = el("span.dbf-sel");
  const root = el("div.dbf", {}, info, el("span.hx-flex"), sel);
  return {
    root,
    setInfo(text, state = "") {
      info.textContent = text;
      info.className = `dbf-info${state ? ` ${state}` : ""}`;
    },
    setSelection(s) {
      const parts = [];
      const a = s.selection;
      if (a && a.count > 1) {
        parts.push(`Células: ${fmt(a.count)}`);
        if (a.nonNull !== undefined && a.nonNull !== a.count) parts.push(`Não nulas: ${fmt(a.nonNull)}`);
        if (a.numeric) parts.push(`Soma: ${fmt(a.sum)}`, `Média: ${fmt(a.avg)}`, `Mín: ${fmt(a.min)}`, `Máx: ${fmt(a.max)}`);
      } else if (s.active?.column) {
        const c = s.active.column;
        parts.push(`${c.name}: ${c.full_type || c.type || ""}${c.nullable === false ? " NOT NULL" : ""}`);
      }
      if (s.rows !== s.total) parts.push(`Filtro local: ${fmt(s.rows)} de ${fmt(s.total)}`);
      if (s.pending) parts.push(`${s.pending} alteração(ões) pendente(s)`);
      sel.textContent = parts.join("  ·  ");
    },
  };
}

async function copyText(ctx, text, message) {
  try {
    await navigator.clipboard.writeText(text);
    ctx.toast(message);
  } catch {
    ctx.toast("Não foi possível copiar");
  }
}

/** Itens "Copiar como…" para o menu de contexto do grid. */
export function copyAsItems(ctx, dialect, m, table = null) {
  if (!m.rows.length) return [];
  const items = [
    { header: "Copiar como" },
    { label: "CSV", icon: "fa-solid fa-file-csv", indent: true, run: () => copyText(ctx, toCSV(m.names, m.data), "CSV copiado") },
    { label: "JSON", icon: "fa-solid fa-code", indent: true, run: () => copyText(ctx, toJSON(m.columns, m.data), "JSON copiado") },
    { label: "Markdown", icon: "fa-brands fa-markdown", indent: true, run: () => copyText(ctx, toMarkdown(m.names, m.data), "Markdown copiado") },
    { label: "SQL INSERT", icon: "fa-solid fa-database", indent: true, run: () => copyText(ctx, toSqlInserts(dialect, table, m.columns, m.data), "INSERTs copiados") },
  ];
  if (m.cols.length === 1) {
    items.push({ label: "WHERE … IN (…)", icon: "fa-solid fa-filter", indent: true, run: () => copyText(ctx, toSqlInList(dialect, m.columns[0], m.data.map((r) => r[0])), "Lista copiada") });
  }
  return items;
}

const FORMATS = {
  csv: { label: "CSV", ext: "csv", make: (d, cols, rows) => "﻿" + toCSV(cols.map((c) => c.name), rows) },
  csvbr: { label: "CSV para Excel (;)", ext: "csv", make: (d, cols, rows) => "﻿" + toCSV(cols.map((c) => c.name), rows, { sep: ";" }) },
  tsv: { label: "TSV", ext: "tsv", make: (d, cols, rows) => toTSV(cols.map((c) => c.name), rows) },
  json: { label: "JSON", ext: "json", make: (d, cols, rows) => toJSON(cols, rows) },
  md: { label: "Markdown", ext: "md", make: (d, cols, rows) => toMarkdown(cols.map((c) => c.name), rows) },
  sql: { label: "SQL INSERT", ext: "sql", make: (d, cols, rows, table) => toSqlInserts(d, table, cols, rows) },
};

async function saveAs(ctx, fmtKey, dialect, data, table, baseName) {
  const f = FORMATS[fmtKey];
  const path = await saveFileDialogApi({ defaultPath: `${baseName}.${f.ext}`, filters: [{ name: f.label, extensions: [f.ext] }], title: "Exportar dados" });
  if (!path) return;
  try {
    await writeFileApi(path, { text: f.make(dialect, data.columns, data.rows, table) });
    ctx.toast(`${data.rows.length.toLocaleString("pt-BR")} linha(s) exportada(s)`);
  } catch (e) {
    ctx.toast(`Falha ao exportar: ${e}`);
  }
}

/** Menu de exportação: visão atual (com filtro local) ou, nas tabelas, a tabela inteira. */
export function exportMenuItems(ctx, dialect, grid, table, { exportAll = null, baseName = null } = {}) {
  const name = baseName || (table ? `${table.schema}.${table.name}` : "resultado");
  const items = [{ header: "Exportar o que está no grid" }];
  for (const key of Object.keys(FORMATS)) {
    items.push({ label: FORMATS[key].label, indent: true, icon: "fa-regular fa-file", run: () => saveAs(ctx, key, dialect, grid.exportData(), table, name) });
  }
  if (exportAll) {
    items.push("sep", { header: "Exportar tabela inteira (com WHERE)" });
    for (const key of ["csv", "csvbr", "json", "sql"]) {
      items.push({
        label: FORMATS[key].label,
        indent: true,
        icon: "fa-solid fa-file-arrow-down",
        run: async () => {
          try {
            saveAs(ctx, key, dialect, await exportAll(), table, name);
          } catch (e) {
            ctx.toast(String(e));
          }
        },
      });
    }
  }
  return items;
}

/** Seletor Tx: Auto/Manual + Commit/Rollback (como o DataGrip). */
export function txControls({ getMode, setMode, getCount, run }) {
  const select = el(
    "select.dbt-tx-select",
    { title: "Modo de transação", onchange: () => (setMode(select.value), update()) },
    el("option", { value: "auto" }, "Tx: Auto"),
    el("option", { value: "manual" }, "Tx: Manual"),
  );
  const commit = el("button.dbt-btn.dbt-commit", { type: "button", title: "Commit", onclick: () => run("commit") }, icon("fa-solid fa-check"), el("span", {}, "Commit"));
  const rollback = el("button.dbt-btn.dbt-rollback", { type: "button", title: "Rollback", onclick: () => run("rollback") }, icon("fa-solid fa-rotate-left"), el("span", {}, "Rollback"));
  const badge = el("span.dbt-tx-badge", { title: "Transações abertas nesta sessão" });
  const root = el("span.dbt-tx", {}, select, badge, commit, rollback);
  function update() {
    select.value = getMode();
    const n = getCount();
    const show = n > 0 || getMode() === "manual";
    commit.hidden = rollback.hidden = !show;
    commit.disabled = rollback.disabled = n === 0;
    badge.hidden = n === 0;
    badge.textContent = `tx ${n}`;
    root.classList.toggle("open", n > 0);
  }
  update();
  return { root, update };
}
