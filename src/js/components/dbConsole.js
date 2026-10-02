import { el, icon } from "../utils/dom.js";
import { uid, target } from "../utils/dbModel.js";
import { splitBatches, statementAt, isReadOnlyQuery, isWriteStatement } from "../utils/sqlSplit.js";
import { codeEditor } from "./codeEditor.js";
import { createDataGrid } from "./dataGrid.js";
import { dbConfirm } from "./dbDialogs.js";
import { createResultFooter, copyAsItems, exportMenuItems, txControls } from "./dbShared.js";
import { attachSqlComplete } from "./sqlComplete.js";
import { dbApi } from "../api.js";

// Console SQL: Ctrl+Enter executa a seleção ou o comando sob o cursor; Ctrl+Shift+Enter executa
// o script inteiro (lotes separados por GO). Cada result set vira uma aba com um DataGrid.

const LIMITS = [100, 500, 1000, 5000, 0];
const time = () => new Date().toLocaleTimeString("pt-BR");

/**
 * tab: { id, conn_id, console_id }; doc: console salvo { id, conn_id, database, name, sql }
 * ctx: { conn, dialect, log, toast, showMenu, showMenuBelow, saveDataSoon, databases(conn), completions, requireLogin, onTitleChange }
 */
export function createConsoleTab(ctx, tab, doc) {
  const conn = () => ctx.conn(doc.conn_id);
  const dialect = () => ctx.dialect(conn());
  const sessionId = `console:${doc.id}`;
  const tgt = () => target(conn(), sessionId, doc.database);

  let running = null; // queryId
  let cancelled = false;
  let tranCount = 0;
  let txMode = "auto";
  let limit = 500;
  let split = 0.45;
  let results = []; // { title, grid, footer, root, rows, truncated, unit }
  let messages = [];
  let activeResult = "output";

  // ---------- Editor ----------

  const editor = codeEditor({
    value: doc.sql,
    lang: "sql",
    fill: true,
    indent: "    ",
    placeholder: "SELECT * FROM ...   (Ctrl+Enter executa o comando sob o cursor)",
    onInput: (v) => {
      doc.sql = v;
      ctx.saveDataSoon();
    },
    skipKey: (e) => complete?.isOpen(),
  });
  const complete = attachSqlComplete(editor, {
    getSource: () => ctx.completions(conn(), doc.database),
    dialect,
  });

  editor.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      run(e.shiftKey ? "all" : "current");
    }
  });

  // ---------- Barra ----------

  const runBtn = el("button.dbt-run", { type: "button", title: "Executar comando sob o cursor ou seleção (Ctrl+Enter)", onclick: () => run("current") }, icon("fa-solid fa-play"), el("span", {}, "Executar"));
  const runAllBtn = el("button.dbt-btn", { type: "button", title: "Executar script inteiro (Ctrl+Shift+Enter)", onclick: () => run("all") }, icon("fa-solid fa-forward"));
  const cancelBtn = el("button.dbt-btn", { type: "button", title: "Cancelar", disabled: true, onclick: cancel }, icon("fa-solid fa-stop"));
  const dbBtn = el("button.dbt-db", { type: "button", title: "Banco do console", onclick: (e) => dbMenu(e.currentTarget) });
  const limitSel = el(
    "select.dbt-tx-select",
    { title: "Limite de linhas por resultado", onchange: () => (limit = Number(limitSel.value)) },
    ...LIMITS.map((n) => el("option", { value: n, selected: n === limit }, n ? `Limite: ${n.toLocaleString("pt-BR")}` : "Sem limite")),
  );
  const tx = txControls({ getMode: () => txMode, setMode: (m) => (txMode = m), getCount: () => tranCount, run: runTx });
  const toolbar = el("div.dbt-toolbar", {}, runBtn, runAllBtn, cancelBtn, el("span.dbt-sep"), dbBtn, el("span.dbt-sep"), tx.root, el("span.dbt-sep"), limitSel, el("span.hx-flex"));

  // ---------- Resultados ----------

  const resTabs = el("div.dbc-rtabs");
  const resBody = el("div.dbc-rbody");
  const output = el("div.dbc-output");
  const resPane = el("div.dbc-results", {}, resTabs, resBody);
  const splitter = el("div.dbc-split", { title: "Arraste para redimensionar" });
  const editorPane = el("div.dbc-editor", {}, editor.root);
  const root = el("div.dbc", {}, toolbar, editorPane, splitter, resPane);

  function applySplit() {
    editorPane.style.flex = `0 0 ${Math.round(split * 100)}%`;
  }
  applySplit();
  splitter.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const rect = root.getBoundingClientRect();
    const top = toolbar.getBoundingClientRect().bottom;
    const move = (ev) => {
      split = Math.min(0.85, Math.max(0.12, (ev.clientY - top) / (rect.bottom - top)));
      applySplit();
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });

  function renderResultTabs() {
    resTabs.innerHTML = "";
    results.forEach((r, i) => {
      resTabs.append(
        el(
          "button.dbc-rtab",
          { type: "button", class: `dbc-rtab${activeResult === i ? " on" : ""}`, onclick: () => showResult(i) },
          icon("fa-solid fa-table"),
          el("span", {}, r.title),
          el("span.dbc-rcount", {}, r.rows.toLocaleString("pt-BR") + (r.truncated ? "+" : "")),
        ),
      );
    });
    const errors = messages.filter((m) => m.kind === "error").length;
    resTabs.append(
      el(
        "button.dbc-rtab",
        { type: "button", class: `dbc-rtab${activeResult === "output" ? " on" : ""}${errors ? " err" : ""}`, onclick: () => showResult("output") },
        icon(errors ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-message"),
        el("span", {}, "Saída"),
      ),
    );
  }

  function showResult(i) {
    activeResult = i;
    resBody.innerHTML = "";
    if (i === "output") {
      resBody.append(output);
      output.scrollTop = output.scrollHeight;
    } else if (results[i]) {
      resBody.append(results[i].root);
      results[i].grid.refresh();
    }
    renderResultTabs();
  }

  function addMessage(kind, text, sql = "") {
    messages.push({ kind, text });
    output.append(
      el(
        "div.dbc-msg",
        { class: `dbc-msg ${kind}` },
        el("span.dbc-msg-time", {}, `[${time()}]`),
        el("span.dbc-msg-text", {}, text),
        sql ? el("pre.dbc-msg-sql", {}, sql.length > 400 ? sql.slice(0, 400) + "…" : sql) : null,
      ),
    );
    output.scrollTop = output.scrollHeight;
  }

  function newResult(columns, unit, index) {
    const footer = createResultFooter();
    const r = { title: `Resultado ${results.length + 1}`, rows: 0, truncated: false, unit, footer };
    r.grid = createDataGrid({
      showMenu: ctx.showMenu,
      onStatus: (s) => footer.setSelection(s),
      onError: (m) => ctx.toast(m),
      onCopied: (n) => n > 1 && ctx.toast(`${n.toLocaleString("pt-BR")} células copiadas`),
      copyAsItems: (m) => copyAsItems(ctx, dialect(), m, null),
    });
    const exportBtn = el(
      "button.dbt-btn",
      { type: "button", title: "Exportar resultado", onclick: (e) => ctx.showMenuBelow(e.currentTarget, exportMenuItems(ctx, dialect(), r.grid, null, { baseName: `resultado-${results.indexOf(r) + 1}` })) },
      icon("fa-solid fa-file-export"),
    );
    const recordBtn = el(
      "button.dbt-btn",
      {
        type: "button",
        title: "Modo registro",
        onclick: () => {
          r.grid.setRecordMode(!r.grid.recordMode);
          recordBtn.classList.toggle("on", r.grid.recordMode);
        },
      },
      icon("fa-solid fa-table-list"),
    );
    const findBtn = el("button.dbt-btn", { type: "button", title: "Buscar (Ctrl+F)", onclick: () => r.grid.openFind() }, icon("fa-solid fa-magnifying-glass"));
    r.moreBtn = el("button.dbc-more", { type: "button", hidden: true, onclick: () => fetchAll(r) }, icon("fa-solid fa-angles-down"), "Buscar todas as linhas");
    r.root = el("div.dbc-result", {}, el("div.dbc-rtools", {}, findBtn, recordBtn, exportBtn, el("span.hx-flex"), r.moreBtn), el("div.dbt-grid", {}, r.grid.root), footer.root);
    r.grid.setColumns(columns);
    r.index = index;
    results.push(r);
    return r;
  }

  // ---------- Execução ----------

  function unitsToRun(mode) {
    const text = editor.value;
    const { selectionStart: s, selectionEnd: e } = editor.input;
    if (s !== e) return splitBatches(text.slice(s, e));
    if (mode === "all") return splitBatches(text);
    const st = statementAt(text, s);
    return st ? [{ sql: st.sql, repeat: 1, start: st.start, end: st.end }] : [];
  }

  async function run(mode) {
    if (running) return;
    const c = conn();
    if (!c) return ctx.toast("Conexão removida");
    const units = unitsToRun(mode);
    if (!units.length) return ctx.toast("Nada para executar");
    if (c.read_only && units.some((u) => isWriteStatement(u.sql))) {
      const ok = await dbConfirm({ title: "Conexão somente leitura", message: "O comando parece alterar dados ou estrutura. Executar mesmo assim?", confirmLabel: "Executar", danger: true });
      if (!ok) return;
    }
    // Destaca o comando executado (como o DataGrip).
    if (mode === "current" && units.length === 1 && units[0].start !== undefined && editor.input.selectionStart === editor.input.selectionEnd) {
      flashRange(units[0].start, units[0].end);
    }
    results.forEach((r) => r.root.remove());
    results = [];
    activeResult = "output";
    cancelled = false;
    setRunning(true);
    if (txMode === "manual" && tranCount === 0) {
      try {
        tranCount = await dbApi.tx(tgt(), "begin");
      } catch (e) {
        addMessage("error", String(e));
        setRunning(false);
        return showResult("output");
      }
    }
    let ok = true;
    for (const unit of units) {
      for (let i = 0; i < (unit.repeat || 1) && ok && !cancelled; i++) ok = await execUnit(unit, limit || null);
      if (!ok || cancelled) break;
    }
    setRunning(false);
    showResult(ok && results.length ? 0 : "output");
  }

  async function execUnit(unit, maxRows, into = null) {
    const c = conn();
    const queryId = uid();
    running = queryId;
    const local = new Map(); // índice do result set -> resultado
    const t0 = performance.now();
    try {
      const summary = await dbApi.execute(tgt(), queryId, unit.sql, {
        maxRows,
        onEvent: (ev) => {
          if (ev.type === "result_start") {
            const r = into && local.size === 0 ? into : newResult(ev.columns, unit, ev.index);
            if (r === into) {
              r.grid.setColumns(ev.columns, { keepLayout: true });
              r.rows = 0;
            }
            local.set(ev.index, r);
            if (results.length === 1 || r === into) showResult(results.indexOf(r));
            else renderResultTabs();
          } else if (ev.type === "rows") {
            const r = local.get(ev.index);
            r.grid.appendRows(ev.rows);
            r.rows += ev.rows.length;
            renderResultTabs();
          } else if (ev.type === "result_end") {
            const r = local.get(ev.index);
            r.truncated = ev.truncated;
            r.moreBtn.hidden = !ev.truncated;
            r.footer.setInfo(`${r.rows.toLocaleString("pt-BR")} linha(s)${ev.truncated ? ` (limite de ${maxRows.toLocaleString("pt-BR")} atingido)` : ""}`);
            if (!r.rows) r.grid.setMessage("Nenhuma linha");
          }
        },
      });
      tranCount = summary.tran_count;
      const parts = [];
      if (summary.rows_affected !== null && summary.rows_affected !== undefined) parts.push(`${summary.rows_affected.toLocaleString("pt-BR")} linha(s) afetada(s)`);
      for (const r of local.values()) parts.push(`${r.rows.toLocaleString("pt-BR")} linha(s) retornada(s)${r.truncated ? "+" : ""}`);
      if (!parts.length) parts.push("Comando executado");
      parts.push(`em ${summary.elapsed_ms} ms`);
      addMessage("ok", parts.join(" · "), unit.sql);
      ctx.log({ conn: c, database: doc.database, sql: unit.sql, rows: summary.rows_affected ?? [...local.values()].reduce((a, r) => a + r.rows, 0), ms: summary.elapsed_ms, total: Math.round(performance.now() - t0) });
      return true;
    } catch (e) {
      const msg = String(e);
      if (msg.includes("sessão foi reaberta")) tranCount = 0;
      addMessage("error", msg, unit.sql);
      ctx.log({ conn: c, database: doc.database, sql: unit.sql, error: msg });
      if (msg.includes("ENTRA_LOGIN_REQUIRED")) ctx.requireLogin(c);
      return false;
    } finally {
      running = null;
      updateToolbar();
    }
  }

  async function fetchAll(r) {
    if (running) return;
    if (!isReadOnlyQuery(r.unit.sql)) {
      const ok = await dbConfirm({ title: "Executar de novo?", message: "Buscar todas as linhas executa o comando novamente. Ele não parece ser só leitura (SELECT).", confirmLabel: "Executar", danger: true });
      if (!ok) return;
    }
    setRunning(true);
    r.moreBtn.hidden = true;
    await execUnit(r.unit, null, r);
    setRunning(false);
  }

  function cancel() {
    if (!running) return;
    cancelled = true;
    dbApi.cancel(running);
  }

  function setRunning(on) {
    root.classList.toggle("running", on);
    if (!on) running = null;
    updateToolbar();
  }

  function updateToolbar() {
    runBtn.disabled = runAllBtn.disabled = root.classList.contains("running");
    cancelBtn.disabled = !root.classList.contains("running");
    dbBtn.innerHTML = "";
    dbBtn.append(icon("fa-solid fa-database"), el("span", {}, doc.database || conn()?.database || "(padrão)"), icon("fa-solid fa-chevron-down"));
    tx.update();
    ctx.onTitleChange?.(tab, { dirty: tranCount > 0, running: root.classList.contains("running") });
  }

  function flashRange(start, end) {
    const { input } = editor;
    const keep = input.selectionStart;
    input.setSelectionRange(start, end);
    root.classList.add("flash");
    setTimeout(() => {
      if (input.selectionStart === start && input.selectionEnd === end) input.setSelectionRange(keep, keep);
      root.classList.remove("flash");
    }, 350);
  }

  async function runTx(action) {
    try {
      tranCount = await dbApi.tx(tgt(), action);
      addMessage("ok", action === "commit" ? "COMMIT" : action === "rollback" ? "ROLLBACK" : "BEGIN TRANSACTION");
      ctx.log({ conn: conn(), database: doc.database, sql: action.toUpperCase(), rows: null });
    } catch (e) {
      addMessage("error", String(e));
    }
    updateToolbar();
  }

  async function dbMenu(anchor) {
    let list = [];
    try {
      list = await ctx.databases(conn());
    } catch (e) {
      return ctx.toast(String(e));
    }
    ctx.showMenuBelow(anchor, [
      { header: "Banco do console" },
      ...list.map((name) => ({
        label: name,
        indent: true,
        icon: name === (doc.database || conn()?.database) ? "fa-solid fa-check" : "",
        run: async () => {
          if (name === doc.database) return;
          if (tranCount > 0 && !(await dbConfirm({ title: "Transação aberta", message: "Trocar de banco fecha a sessão e desfaz a transação aberta.", confirmLabel: "Trocar", danger: true }))) return;
          doc.database = name;
          tranCount = 0;
          ctx.saveDataSoon();
          await dbApi.disconnect(sessionId);
          updateToolbar();
          ctx.onTitleChange?.(tab, {});
        },
      })),
    ]);
  }

  renderResultTabs();
  showResult("output");
  updateToolbar();

  return {
    root,
    tab,
    activate() {
      editor.refresh();
      editor.input.focus();
      if (activeResult !== "output") results[activeResult]?.grid.refresh();
    },
    refresh() {},
    get dirty() {
      return tranCount > 0;
    },
    /** Insere SQL (ex.: "Novo console com SELECT") e posiciona o cursor no fim. */
    setSql(sql) {
      editor.setValue(sql);
      doc.sql = sql;
      ctx.saveDataSoon();
      editor.input.setSelectionRange(sql.length, sql.length);
    },
    async beforeClose() {
      if (tranCount > 0) {
        const ok = await dbConfirm({ title: "Transação aberta", message: "Este console tem uma transação aberta. Fechar faz ROLLBACK.", confirmLabel: "Rollback e fechar", danger: true });
        if (!ok) return false;
        await dbApi.tx(tgt(), "rollback").catch(() => {});
      }
      return true;
    },
    dispose() {
      if (running) dbApi.cancel(running);
      complete?.destroy();
      dbApi.disconnect(sessionId);
    },
  };
}

/** Aba somente leitura com o DDL/definição de um objeto. */
export function createDdlTab(ctx, tab) {
  const conn = () => ctx.conn(tab.conn_id);
  const editor = codeEditor({ value: "-- carregando…", lang: "sql", fill: true, readOnly: true });
  const status = el("span.dbf-info");
  let loaded = false;
  const toolbar = el(
    "div.dbt-toolbar",
    {},
    el("button.dbt-btn", { type: "button", title: "Recarregar", onclick: () => load() }, icon("fa-solid fa-rotate-right")),
    el("button.dbt-btn", { type: "button", title: "Copiar", onclick: () => ctx.copy(editor.value, "DDL copiado") }, icon("fa-regular fa-copy"), el("span", {}, "Copiar")),
    el("button.dbt-btn", { type: "button", title: "Abrir num console para editar/executar", onclick: () => ctx.openConsole(conn(), tab.database, editor.value) }, icon("fa-solid fa-terminal"), el("span", {}, "Abrir no console")),
    el("span.hx-flex"),
    status,
  );
  const root = el("div.dbc", {}, toolbar, el("div.dbc-editor.full", {}, editor.root));

  async function load() {
    status.textContent = "Carregando…";
    try {
      const sql = await dbApi.ddl(target(conn(), `meta:${tab.conn_id}:${tab.database}`, tab.database), { kind: tab.kind, schema: tab.schema, name: tab.name });
      editor.setValue(sql);
      status.textContent = "";
      loaded = true;
    } catch (e) {
      editor.setValue(`-- ${String(e)}`);
      status.textContent = "Erro";
    }
  }

  return {
    root,
    tab,
    activate() {
      if (!loaded) load();
      editor.refresh();
    },
    refresh: load,
    dirty: false,
    beforeClose: async () => true,
    dispose() {},
  };
}
