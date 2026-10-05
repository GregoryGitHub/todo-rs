import { el, icon } from "../utils/dom.js";
import { uid, target } from "../utils/dbModel.js";
import { canEditTable, buildChanges } from "../utils/sqlGen.js";
import { createDataGrid } from "./dataGrid.js";
import { reviewChangesDialog, dbConfirm } from "./dbDialogs.js";
import { createResultFooter, copyAsItems, exportMenuItems, txControls } from "./dbShared.js";
import { dbApi } from "../api.js";

// Aba de dados de uma tabela/view: paginação no servidor (OFFSET/FETCH), WHERE/ORDER BY,
// filtro local, edição com alterações pendentes e envio em transação.

const PAGE_SIZES = [100, 200, 500, 1000, 5000];

/**
 * tab: { id, conn_id, database, schema, name, kind, where, order_by }
 * ctx: { conn(id), dialect(conn), log, toast, showMenu, copy, openTable, openDdl, saveUi, pageSize, setPageSize, onTitleChange }
 */
export function createTableTab(ctx, tab) {
  const conn = () => ctx.conn(tab.conn_id);
  const dialect = () => ctx.dialect(conn());
  const sessionId = `tab:${tab.id}`;
  const tgt = () => target(conn(), sessionId, tab.database);

  let info = null; // TableInfo
  let offset = 0;
  let hasMore = false;
  let total = null; // COUNT(*) quando pedido
  let loading = null; // queryId em andamento
  let tranCount = 0;
  let txMode = "auto";
  let loadedOnce = false;

  const grid = createDataGrid({
    showMenu: ctx.showMenu,
    onChange: updateToolbar,
    onStatus: (s) => footer.setSelection(s),
    onError: (m) => ctx.toast(m),
    onInfo: (m) => ctx.toast(m),
    onCopied: (n) => n > 1 && ctx.toast(`${n.toLocaleString("pt-BR")} células copiadas`),
    onSubmit: submit,
    onOpenFk: openFk,
    serverFilter: searchServer,
    copyAsItems: (m) => copyAsItems(ctx, dialect(), m, info),
    headerMenuItems: (col) => [
      "sep",
      { label: "Ordenar no servidor (ASC)", icon: "fa-solid fa-server", run: () => serverSort(col, "ASC") },
      { label: "Ordenar no servidor (DESC)", icon: "fa-solid fa-server", run: () => serverSort(col, "DESC") },
    ],
    cellMenuItems: (cell) => [
      "sep",
      { label: "Filtrar no servidor (WHERE)", icon: "fa-solid fa-server", run: () => serverFilter(cell) },
      cell.column.fk && cell.value !== null ? { label: `Abrir ${cell.column.fk.table} (FK)`, icon: "fa-solid fa-arrow-up-right-from-square", run: () => openFk(cell) } : null,
    ],
  });

  // ---------- Barra de ferramentas ----------

  const tb = (iconCls, title, onclick, extra = {}) => el("button.dbt-btn", { type: "button", title, onclick, ...extra }, icon(iconCls), extra.label ? el("span", {}, extra.label) : null);

  const reloadBtn = tb("fa-solid fa-rotate-right", "Recarregar (F5)", () => load());
  const cancelBtn = tb("fa-solid fa-stop", "Cancelar consulta", () => loading && dbApi.cancel(loading), { disabled: true });
  const firstBtn = tb("fa-solid fa-backward-step", "Primeira página", () => goPage(0));
  const prevBtn = tb("fa-solid fa-chevron-left", "Página anterior", () => goPage(Math.max(0, offset - ctx.pageSize())));
  const pageLabel = el("button.dbt-page", { type: "button", title: "Tamanho da página / contar linhas", onclick: (e) => pageMenu(e.currentTarget) });
  const nextBtn = tb("fa-solid fa-chevron-right", "Próxima página", () => goPage(offset + ctx.pageSize()));
  const addBtn = tb("fa-solid fa-plus", "Adicionar linha (Alt+Insert)", () => grid.addRow());
  const delBtn = tb("fa-solid fa-minus", "Excluir linhas selecionadas (Ctrl+Delete)", () => grid.deleteSelectedRows());
  const revertBtn = tb("fa-solid fa-rotate-left", "Reverter alterações", () => grid.revertAll());
  const submitBtn = el("button.dbt-submit", { type: "button", title: "Enviar alterações (Ctrl+Enter)", onclick: () => submit() }, icon("fa-solid fa-arrow-up-from-bracket"), el("span", {}, "Enviar"));
  const tx = txControls({
    getMode: () => txMode,
    setMode: (m) => (txMode = m),
    getCount: () => tranCount,
    run: (action) => runTx(action),
  });
  const ddlBtn = tb("fa-solid fa-code", "DDL", () => ctx.openDdl({ conn: conn(), database: tab.database, schema: tab.schema, name: tab.name, kind: tab.kind || "table" }));
  const findBtn = tb("fa-solid fa-magnifying-glass", "Buscar nos dados (Ctrl+F)", () => grid.openFind());
  const recordBtn = tb("fa-solid fa-table-list", "Modo registro (ver linha na vertical)", () => {
    grid.setRecordMode(!grid.recordMode);
    recordBtn.classList.toggle("on", grid.recordMode);
  });
  const exportBtn = tb("fa-solid fa-file-export", "Exportar", (e) => ctx.showMenuBelow(e.currentTarget, exportMenuItems(ctx, dialect(), grid, info, { exportAll })));
  const roBadge = el("span.dbt-ro", { hidden: true, title: "Sem chave primária, view ou conexão somente leitura" }, icon("fa-solid fa-lock"), "somente leitura");

  const toolbar = el(
    "div.dbt-toolbar",
    {},
    reloadBtn,
    cancelBtn,
    el("span.dbt-sep"),
    firstBtn,
    prevBtn,
    pageLabel,
    nextBtn,
    el("span.dbt-sep"),
    addBtn,
    delBtn,
    revertBtn,
    submitBtn,
    el("span.dbt-sep"),
    tx.root,
    el("span.dbt-sep"),
    ddlBtn,
    findBtn,
    recordBtn,
    exportBtn,
    el("span.hx-flex"),
    roBadge,
  );

  // ---------- WHERE / ORDER BY ----------

  const whereInput = el("input.dbt-filter-input", { type: "text", value: tab.where, placeholder: "ex.: status = 'ativo' AND created_date > '2026-01-01'", spellcheck: false, autocomplete: "off" });
  const orderInput = el("input.dbt-filter-input", { type: "text", value: tab.order_by, placeholder: "ex.: created_date DESC", spellcheck: false, autocomplete: "off" });
  const applyFilters = () => {
    tab.where = whereInput.value.trim();
    tab.order_by = orderInput.value.trim();
    ctx.saveUi();
    offset = 0;
    total = null;
    load();
  };
  for (const inp of [whereInput, orderInput]) {
    // Antes do Enter/Esc abaixo: o autocomplete consome essas teclas quando está aberto.
    ctx.attachColumnComplete?.(inp, () => info?.columns.map((c) => c.name) || []);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyFilters();
      } else if (e.key === "Escape" && inp.value) {
        inp.value = "";
        applyFilters();
      }
    });
  }
  const filters = el(
    "div.dbt-filters",
    {},
    el("label.dbt-filter", {}, el("span.dbt-filter-label", {}, icon("fa-solid fa-filter"), "WHERE"), whereInput),
    el("label.dbt-filter", {}, el("span.dbt-filter-label", {}, icon("fa-solid fa-arrow-down-wide-short"), "ORDER BY"), orderInput),
  );

  const footer = createResultFooter();
  const root = el("div.dbt", {}, toolbar, filters, el("div.dbt-grid", {}, grid.root), footer.root);

  // ---------- Carregar ----------

  function editableNow() {
    return canEditTable(info) && !conn()?.read_only;
  }

  function updateToolbar() {
    const pending = grid.model.pendingCount;
    const editable = editableNow();
    addBtn.disabled = delBtn.disabled = !editable || !!loading;
    revertBtn.disabled = !pending;
    submitBtn.disabled = !pending || !!loading;
    submitBtn.querySelector("span").textContent = pending ? `Enviar (${pending})` : "Enviar";
    submitBtn.classList.toggle("on", !!pending);
    roBadge.hidden = !info || editable;
    reloadBtn.disabled = !!loading;
    cancelBtn.disabled = !loading;
    prevBtn.disabled = firstBtn.disabled = offset === 0 || !!loading;
    nextBtn.disabled = !hasMore || !!loading;
    const shown = grid.model.rows.length - grid.model.removed.size - grid.model.added.size;
    const from = shown ? offset + 1 : 0;
    const to = offset + shown;
    pageLabel.innerHTML = "";
    pageLabel.append(
      el("span", {}, loadedOnce ? (offset === 0 && !hasMore ? `${shown.toLocaleString("pt-BR")} linha${shown === 1 ? "" : "s"}` : `${from.toLocaleString("pt-BR")}–${to.toLocaleString("pt-BR")}${total !== null ? ` de ${total.toLocaleString("pt-BR")}` : hasMore ? " de ?" : ""}`) : "—"),
      icon("fa-solid fa-chevron-down"),
    );
    tx.update();
    ctx.onTitleChange?.(tab, { dirty: pending > 0 || tranCount > 0 });
  }

  async function confirmDiscard() {
    if (!grid.model.pendingCount) return true;
    return dbConfirm({ title: "Descartar alterações?", message: `Há ${grid.model.pendingCount} alteração(ões) não enviada(s). Recarregar descarta essas alterações.`, confirmLabel: "Descartar", danger: true });
  }

  async function load({ force = false } = {}) {
    if (loading) return;
    if (!force && !(await confirmDiscard())) return;
    const c = conn();
    if (!c) return;
    const queryId = uid();
    loading = queryId;
    updateToolbar();
    grid.setMessage(loadedOnce ? "" : "Carregando…");
    footer.setInfo("Executando…", "busy");
    const pageSize = ctx.pageSize();
    try {
      if (!info) info = await dbApi.tableInfo(tgt(), tab.schema, tab.name);
      const sql = dialect().selectPage({ schema: tab.schema, name: tab.name, where: tab.where, orderBy: tab.order_by, offset, limit: pageSize });
      let count = 0;
      let started = false;
      const t0 = performance.now();
      let firstRowAt = null;
      const summary = await dbApi.execute(tgt(), queryId, sql, {
        maxRows: pageSize + 1,
        onEvent: (ev) => {
          if (ev.type === "result_start" && !started) {
            started = true;
            grid.setColumns(mergeColumns(ev.columns, info), { keepLayout: true });
            grid.setEditable(editableNow());
          } else if (ev.type === "rows" && ev.index === 0) {
            firstRowAt ??= performance.now();
            const room = pageSize - count;
            const rows = room < ev.rows.length ? ev.rows.slice(0, Math.max(0, room)) : ev.rows;
            count += ev.rows.length;
            if (rows.length) grid.appendRows(rows);
          }
        },
      });
      hasMore = count > pageSize || summary.truncated;
      tranCount = summary.tran_count;
      loadedOnce = true;
      grid.setMessage(count ? "" : tab.where ? "Nenhuma linha atende ao filtro" : "Tabela vazia");
      const shown = Math.min(count, pageSize);
      const fetchMs = firstRowAt ? Math.round(performance.now() - firstRowAt) : 0;
      footer.setInfo(`${shown.toLocaleString("pt-BR")} linha(s) a partir de ${(offset + 1).toLocaleString("pt-BR")} em ${summary.elapsed_ms} ms`);
      ctx.log({ conn: c, database: tab.database, sql, rows: shown, ms: summary.elapsed_ms, fetchMs, total: Math.round(performance.now() - t0) });
    } catch (e) {
      if (String(e).includes("sessão foi reaberta")) tranCount = 0;
      grid.setMessage(loadedOnce ? "" : String(e));
      footer.setInfo(String(e), "bad");
      ctx.log({ conn: c, database: tab.database, sql: `-- ${tab.schema}.${tab.name}`, error: String(e) });
      if (String(e).includes("ENTRA_LOGIN_REQUIRED")) ctx.requireLogin(c);
    } finally {
      loading = null;
      updateToolbar();
    }
  }

  /** Metadados do resultado + da tabela (PK, identity, FK...) casados por nome. */
  function mergeColumns(cols, tinfo) {
    const byName = new Map((tinfo?.columns || []).map((c) => [c.name.toLowerCase(), c]));
    return cols.map((c) => {
      const t = byName.get(c.name.toLowerCase());
      return t ? { ...t, name: c.name, kind: c.kind, type: t.type || c.type } : { ...c, nullable: true };
    });
  }

  async function goPage(next) {
    if (next === offset) return;
    if (!(await confirmDiscard())) return;
    offset = next;
    load({ force: true });
  }

  function pageMenu(anchor) {
    ctx.showMenuBelow(anchor, [
      { header: "Linhas por página" },
      ...PAGE_SIZES.map((n) => ({
        label: n.toLocaleString("pt-BR"),
        icon: n === ctx.pageSize() ? "fa-solid fa-check" : "",
        indent: true,
        run: () => {
          ctx.setPageSize(n);
          offset = 0;
          load();
        },
      })),
      "sep",
      { label: "Contar linhas (COUNT)", icon: "fa-solid fa-calculator", run: countRows },
    ]);
  }

  async function countRows() {
    try {
      let value = null;
      await dbApi.execute(tgt(), uid(), dialect().count({ schema: tab.schema, name: tab.name, where: tab.where }), {
        onEvent: (ev) => {
          if (ev.type === "rows") value = Number(ev.rows[0]?.[0]);
        },
      });
      total = value;
      updateToolbar();
      ctx.toast(`${(value ?? 0).toLocaleString("pt-BR")} linha(s)${tab.where ? " com o filtro" : ""}`);
    } catch (e) {
      ctx.toast(String(e));
    }
  }

  function serverSort(col, dir) {
    orderInput.value = `${dialect().quote(col.name)} ${dir}`;
    applyFilters();
  }

  function serverFilter(cell) {
    const col = dialect().quote(cell.column.name);
    const cond = cell.value === null ? `${col} IS NULL` : `${col} = ${dialect().literal(cell.value, cell.column.kind)}`;
    whereInput.value = whereInput.value.trim() ? `(${whereInput.value.trim()}) AND ${cond}` : cond;
    applyFilters();
  }

  /** Condição criada pela última busca do filtro local (trocada, não acumulada, na próxima). */
  let lastSearch = "";

  /** Busca do popup de filtro levada ao servidor: col = valor | col LIKE '%valor%'. */
  function searchServer(col, text, mode) {
    const q = dialect().quote(col.name);
    let cond;
    if (mode === "contains") {
      const pattern = `%${text.replace(/[[%_]/g, "[$&]")}%`;
      const target = ["str", "xml"].includes(col.kind) ? q : `CAST(${q} AS NVARCHAR(4000))`;
      cond = `${target} LIKE ${dialect().string(pattern)}`;
    } else {
      cond = `${q} = ${dialect().literal(text, col.kind)}`;
    }
    let where = whereInput.value.trim();
    if (lastSearch && where === lastSearch) where = "";
    else if (lastSearch && where.endsWith(` AND ${lastSearch}`)) where = where.slice(0, -(` AND ${lastSearch}`.length));
    lastSearch = cond;
    const wrap = /\bOR\b/i.test(where) && !/^\(.*\)$/s.test(where);
    whereInput.value = where ? `${wrap ? `(${where})` : where} AND ${cond}` : cond;
    applyFilters();
  }

  function openFk(cell) {
    const fk = cell.column.fk;
    if (!fk || cell.value === null) return;
    ctx.openTable({
      conn: conn(),
      database: tab.database,
      schema: fk.schema,
      name: fk.table,
      kind: "table",
      where: `${dialect().quote(fk.column)} = ${dialect().literal(cell.value, cell.column.kind)}`,
    });
  }

  // ---------- Gravar ----------

  async function runTx(action) {
    try {
      tranCount = await dbApi.tx(tgt(), action);
      ctx.log({ conn: conn(), database: tab.database, sql: action.toUpperCase() + (action === "begin" ? " TRANSACTION" : ""), rows: null });
      if (action === "rollback") {
        ctx.toast("Transação desfeita (rollback)");
        load({ force: true });
      } else if (action === "commit") ctx.toast("Transação confirmada (commit)");
    } catch (e) {
      ctx.toast(String(e));
    }
    updateToolbar();
  }

  async function submit() {
    if (!grid.model.pendingCount || loading) return;
    if (conn()?.read_only) return ctx.toast("Conexão somente leitura");
    let statements;
    try {
      statements = buildChanges(dialect(), { ...info, columns: grid.model.columns }, grid.model.pending());
    } catch (e) {
      return ctx.toast(e.message);
    }
    if (!statements.length) return grid.revertAll();
    const manual = txMode === "manual";
    if (!(await reviewChangesDialog({ statements, connection: `${tab.schema}.${tab.name}`, inTransaction: manual || tranCount > 0 }))) return;
    try {
      if (manual && tranCount === 0) tranCount = await dbApi.tx(tgt(), "begin");
      const affected = await dbApi.apply(tgt(), statements.map((s) => s.sql), !manual);
      const zero = affected.filter((n) => n === 0).length;
      ctx.log({ conn: conn(), database: tab.database, sql: statements.map((s) => s.sql + ";").join("\n"), affected: affected.reduce((a, b) => a + b, 0) });
      grid.acceptPending();
      ctx.toast(zero ? `Gravado, mas ${zero} comando(s) não afetaram nenhuma linha (a linha mudou no banco?)` : `${statements.length} alteração(ões) gravada(s)${manual ? " — confirme com Commit" : ""}`);
      if (manual) tranCount = Math.max(tranCount, 1);
    } catch (e) {
      ctx.log({ conn: conn(), database: tab.database, sql: statements.map((s) => s.sql + ";").join("\n"), error: String(e) });
      ctx.toast(String(e));
    }
    updateToolbar();
  }

  // ---------- Exportar tudo ----------

  /** Busca todas as linhas (sem paginação) com o WHERE/ORDER BY atual. */
  async function exportAll() {
    const sql = dialect().selectPage({ schema: tab.schema, name: tab.name, where: tab.where, orderBy: tab.order_by, offset: 0, limit: 0 }).replace(/\nOFFSET.*$/, "");
    const rows = [];
    let columns = null;
    footer.setInfo("Buscando todas as linhas…", "busy");
    await dbApi.execute(tgt(), uid(), sql, {
      onEvent: (ev) => {
        if (ev.type === "result_start" && !columns) columns = mergeColumns(ev.columns, info);
        else if (ev.type === "rows" && ev.index === 0) rows.push(...ev.rows);
      },
    });
    footer.setInfo(`${rows.length.toLocaleString("pt-BR")} linhas exportadas`);
    return { columns, rows };
  }

  root.addEventListener("keydown", (e) => {
    if (e.key === "F5") {
      e.preventDefault();
      load();
    }
  });

  updateToolbar();

  return {
    root,
    tab,
    activate() {
      if (!loadedOnce && !loading) load({ force: true });
      grid.focus();
    },
    refresh: () => load(),
    get dirty() {
      return grid.model.pendingCount > 0 || tranCount > 0;
    },
    async beforeClose() {
      if (grid.model.pendingCount && !(await dbConfirm({ title: "Fechar aba?", message: `Há ${grid.model.pendingCount} alteração(ões) não enviada(s).`, confirmLabel: "Descartar e fechar", danger: true }))) return false;
      if (tranCount > 0) {
        const ok = await dbConfirm({ title: "Transação aberta", message: "Esta aba tem uma transação aberta. Fechar faz ROLLBACK.", confirmLabel: "Rollback e fechar", danger: true });
        if (!ok) return false;
        await dbApi.tx(tgt(), "rollback").catch(() => {});
      }
      return true;
    },
    dispose() {
      if (loading) dbApi.cancel(loading);
      dbApi.disconnect(sessionId);
    },
  };
}
