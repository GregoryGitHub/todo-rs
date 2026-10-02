import { el, icon, select, kvTable, authEditor, codeArea, toggle } from "./httpWidgets.js";
import { createModalHost, btn } from "./modal.js";
import { scriptsEditor } from "./httpEditor.js";
import { normalizeEnvironment, uid, clone, formatMs, statusClass } from "../utils/httpModel.js";
import { parseCurl, looksLikeCurl, importPostman, SNIPPETS } from "../utils/httpConvert.js";

// Modal dialogs of the HTTP tab: environments, collection settings, import,
// code snippets, collection runner and confirmations.

const modal = createModalHost(document.getElementById("hx-modal"));

export const isModalOpen = modal.isOpen;
export const closeModal = modal.close;
const openModal = modal.open;
export const confirmDialog = modal.confirm;

// ---------- Environments ----------

/**
 * Edits environments and globals in place. `onChange()` persists; `onSelect(id)` activates one.
 */
export function environmentsDialog(data, { onChange, onSelect, initialId = null, onExport }) {
  let selected = initialId ?? data.active_env ?? data.environments[0]?.id ?? "globals";
  const body = el("div.hx-envs");

  const render = () => {
    body.innerHTML = "";
    const list = el("div.hx-env-list");
    const entries = [{ id: "globals", name: "Variáveis globais", icon: "fa-solid fa-globe" }, ...data.environments.map((e) => ({ id: e.id, name: e.name, icon: "fa-solid fa-layer-group" }))];
    for (const e of entries) {
      const row = el(
        "button.hx-env-item",
        { type: "button", onclick: () => ((selected = e.id), render()) },
        icon(e.icon),
        el("span", {}, e.name),
        data.active_env === e.id ? el("span.hx-env-active", { title: "Ativo" }, "ativo") : null,
      );
      row.classList.toggle("active", selected === e.id);
      list.append(row);
    }
    list.append(
      el("button.hx-env-new", {
        type: "button",
        onclick: () => {
          const env = normalizeEnvironment({ id: uid(), name: "Novo Ambiente", values: [] });
          data.environments.push(env);
          selected = env.id;
          onChange();
          render();
          body.querySelector(".hx-env-name-input")?.select();
        },
      }, icon("fa-solid fa-plus"), "Novo ambiente"),
    );

    const pane = el("div.hx-env-pane");
    if (selected === "globals") {
      pane.append(
        el("p.hx-hint", {}, "Variáveis globais valem para todas as coleções e ambientes (prioridade mais baixa)."),
        kvTable(data.globals, { onChange, description: false, keyPlaceholder: "variavel", valuePlaceholder: "valor" }),
      );
    } else {
      const env = data.environments.find((e) => e.id === selected);
      if (!env) {
        selected = "globals";
        return render();
      }
      const name = el("input.hx-input.hx-env-name-input", {
        value: env.name,
        maxLength: 60,
        oninput: () => {
          env.name = name.value || "Ambiente";
          list.querySelector(".hx-env-item.active span").textContent = env.name;
          onChange();
        },
      });
      const isActive = data.active_env === env.id;
      pane.append(
        el(
          "div.hx-env-actions",
          {},
          name,
          btn(isActive ? "Desativar" : "Ativar", () => {
            onSelect(isActive ? null : env.id);
            render();
          }, isActive ? "hx-btn" : "hx-btn.primary"),
          el("button.hx-icon-btn", {
            type: "button",
            title: "Duplicar",
            onclick: () => {
              const copy = normalizeEnvironment({ ...clone(env), id: uid(), name: `${env.name} (cópia)` });
              data.environments.push(copy);
              selected = copy.id;
              onChange();
              render();
            },
          }, icon("fa-regular fa-clone")),
          el("button.hx-icon-btn", { type: "button", title: "Exportar (Postman)", onclick: () => onExport(env) }, icon("fa-solid fa-file-export")),
          el("button.hx-icon-btn.danger", {
            type: "button",
            title: "Apagar ambiente",
            onclick: () => {
              data.environments = data.environments.filter((e) => e.id !== env.id);
              if (data.active_env === env.id) onSelect(null);
              selected = data.environments[0]?.id ?? "globals";
              onChange();
              render();
            },
          }, icon("fa-regular fa-trash-can")),
        ),
        kvTable(env.values, { onChange, description: false, keyPlaceholder: "variavel", valuePlaceholder: "valor" }),
        el("p.hx-hint", {}, "Use as variáveis como ", el("code", {}, "{{variavel}}"), " na URL, cabeçalhos, body e autenticação."),
      );
    }
    body.append(list, pane);
  };
  render();
  openModal({ title: "Ambientes", iconCls: "fa-solid fa-layer-group", body, wide: true, footer: [btn("Concluído", closeModal, "hx-btn.primary")] });
}

// ---------- Collection settings ----------

export function collectionDialog(coll, { tab = "general", onChange, onRun, onExport }) {
  let active = tab;
  const body = el("div.hx-coll");
  const tabs = [
    ["general", "Geral"],
    ["auth", "Autorização"],
    ["vars", "Variáveis"],
    ["scripts", "Scripts"],
  ];
  const render = () => {
    body.innerHTML = "";
    const nav = el("div.hx-tabs");
    for (const [id, label] of tabs) {
      const b = el("button.hx-tab", { type: "button", onclick: () => ((active = id), render()) }, label);
      b.classList.toggle("active", active === id);
      nav.append(b);
    }
    const pane = el("div.hx-coll-pane");
    if (active === "general") {
      const name = el("input.hx-input", { value: coll.name, maxLength: 80, oninput: () => ((coll.name = name.value || "Coleção"), onChange()) });
      const desc = codeArea({ value: coll.description, rows: 6, placeholder: "Descrição, links da documentação…", onInput: (v) => ((coll.description = v), onChange()) });
      desc.classList.add("prose");
      pane.append(
        el("label.hx-field", {}, el("span.hx-field-label", {}, "Nome"), name),
        el("label.hx-field", {}, el("span.hx-field-label", {}, "Descrição"), desc),
        el("div.hx-coll-actions", {}, btn([icon("fa-solid fa-forward"), " Executar coleção"], () => onRun(coll)), btn([icon("fa-solid fa-file-export"), " Exportar (Postman v2.1)"], () => onExport(coll))),
      );
    }
    if (active === "auth") {
      pane.append(
        el("p.hx-hint", {}, "Requisições com \"Herdar da coleção\" usam esta autenticação."),
        authEditor(coll.auth, { allowInherit: false, onChange }),
      );
    }
    if (active === "vars") {
      pane.append(
        el("p.hx-hint", {}, "Variáveis da coleção. Ambientes têm prioridade sobre elas."),
        kvTable(coll.variables, { onChange, description: false, keyPlaceholder: "variavel", valuePlaceholder: "valor" }),
      );
    }
    if (active === "scripts") {
      pane.append(el("p.hx-hint", {}, "Executados antes/depois de todas as requisições da coleção."), scriptsEditor(coll.scripts, { onChange }));
    }
    body.append(nav, pane);
  };
  render();
  openModal({ title: coll.name, iconCls: "fa-solid fa-box-archive", body, wide: true, footer: [btn("Concluído", closeModal, "hx-btn.primary")] });
}

// ---------- Import ----------

/**
 * onImport(result) where result is one of:
 *  { kind: "curl", request, collectionId } | { kind: "postman", collection, requests } | { kind: "env", environment }
 * readFile(): Promise<string|null> opens the file dialog.
 */
export function importDialog({ collections, collectionId, onImport, readFile }) {
  let target = collectionId ?? collections[0]?.id;
  const errorEl = el("p.hx-import-error");
  const ta = codeArea({ rows: 10, placeholder: "Cole aqui um comando cURL\nou o JSON de uma coleção/ambiente do Postman (v2.1)" });
  const collSel = select(collections.map((c) => ({ id: String(c.id), label: c.name })), String(target), (v) => (target = Number(v)));

  const run = (text) => {
    errorEl.textContent = "";
    const src = text.trim();
    if (!src) return void (errorEl.textContent = "Cole um cURL ou JSON, ou escolha um arquivo.");
    try {
      if (looksLikeCurl(src)) {
        onImport({ kind: "curl", request: parseCurl(src), collectionId: target });
      } else {
        const result = importPostman(src);
        onImport(result.environment ? { kind: "env", environment: result.environment } : { kind: "postman", ...result });
      }
      closeModal();
    } catch (e) {
      errorEl.textContent = e instanceof SyntaxError ? "JSON inválido." : e.message;
    }
  };

  const body = el(
    "div.hx-import",
    {},
    ta,
    el("div.hx-import-row", {}, el("span.hx-hint", {}, "Requisição cURL vai para:"), collSel),
    errorEl,
  );
  openModal({
    title: "Importar",
    iconCls: "fa-solid fa-file-import",
    body,
    footer: [
      el("button.hx-btn", {
        type: "button",
        onclick: async () => {
          const text = await readFile();
          if (text !== null) run(text);
        },
      }, icon("fa-regular fa-folder-open"), " Arquivo…"),
      el("span.hx-flex"),
      btn("Cancelar", closeModal),
      btn("Importar", () => run(ta.value), "hx-btn.primary"),
    ],
  });
  ta.focus();
}

// ---------- Code snippets ----------

export function codeDialog(built, { copy }) {
  let lang = localStorage.getItem("hx-code-lang") || "curl";
  const pre = el("pre.hx-code-out");
  const render = () => {
    const snip = SNIPPETS.find((s) => s.id === lang) || SNIPPETS[0];
    pre.textContent = snip.gen(built);
  };
  const sel = select(SNIPPETS.map((s) => ({ id: s.id, label: s.label })), lang, (v) => {
    lang = v;
    try {
      localStorage.setItem("hx-code-lang", v);
    } catch {
      /* ignore */
    }
    render();
  });
  render();
  openModal({
    title: "Gerar código",
    iconCls: "fa-solid fa-code",
    wide: true,
    body: el("div.hx-codegen", {}, el("div.hx-codegen-bar", {}, sel, el("span.hx-hint", {}, "Variáveis já resolvidas pelo ambiente ativo.")), pre),
    footer: [btn([icon("fa-regular fa-copy"), " Copiar"], () => copy(pre.textContent, "Código copiado"), "hx-btn.primary")],
  });
}

// ---------- Runner ----------

/**
 * Runs every request of a collection in order.
 * run(request, iteration) -> Promise<entry> (same shape as the editor's response entry).
 */
export function runnerDialog(coll, requests, { run, onCancelRun }) {
  let iterations = 1;
  let delay = 0;
  let stopOnFail = false;
  let running = false;
  let stopped = false;
  const selected = new Set(requests.map((r) => r.id));

  const results = el("div.hx-run-results");
  const summary = el("div.hx-run-summary");
  const startBtn = el("button.hx-btn.primary", { type: "button" }, icon("fa-solid fa-play"), " Executar");

  const list = el(
    "div.hx-run-list",
    {},
    requests.length
      ? requests.map((r) =>
          el(
            "label.hx-run-item",
            {},
            el("input", { type: "checkbox", checked: true, onchange: (e) => (e.target.checked ? selected.add(r.id) : selected.delete(r.id)) }),
            el("span.hx-method-tag", { dataset: { method: r.method } }, r.method),
            el("span.hx-run-name", {}, r.name),
          ),
        )
      : el("p.hx-hint", {}, "Esta coleção não tem requisições."),
  );

  const num = (value, min, onInput) => {
    const i = el("input.hx-input.hx-num", { type: "number", min, value, oninput: () => onInput(Math.max(min, Number(i.value) || min)) });
    return i;
  };

  const config = el(
    "div.hx-run-config",
    {},
    el("label.hx-field", {}, el("span.hx-field-label", {}, "Iterações"), num(1, 1, (v) => (iterations = v))),
    el("label.hx-field", {}, el("span.hx-field-label", {}, "Intervalo (ms)"), num(0, 0, (v) => (delay = v))),
    el("label.hx-field.inline", {}, toggle(false, (v) => (stopOnFail = v)), el("span.hx-field-label", {}, "Parar na primeira falha")),
  );

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const start = async () => {
    if (running) {
      stopped = true;
      onCancelRun();
      return;
    }
    const queue = requests.filter((r) => selected.has(r.id));
    if (!queue.length) return;
    running = true;
    stopped = false;
    startBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Parar';
    results.innerHTML = "";
    let passed = 0;
    let failed = 0;
    let errors = 0;
    const t0 = performance.now();
    const updateSummary = () => {
      summary.innerHTML = "";
      summary.append(
        el("span.ok", {}, `${passed} testes ok`),
        el("span.fail", {}, `${failed} falhas`),
        el("span.err", {}, `${errors} erros`),
        el("span.hx-hint", {}, formatMs(Math.round(performance.now() - t0))),
      );
    };
    updateSummary();

    outer: for (let it = 0; it < iterations; it++) {
      if (iterations > 1) results.append(el("div.hx-run-iter", {}, `Iteração ${it + 1}`));
      for (const r of queue) {
        if (stopped) break outer;
        const row = el("div.hx-run-row", {}, el("span.hx-method-tag", { dataset: { method: r.method } }, r.method), el("span.hx-run-name", {}, r.name), el("span.hx-run-status", {}, el("span.hx-spinner.small")));
        results.append(row);
        row.scrollIntoView({ block: "nearest" });
        const entry = await run(r, it);
        const status = row.querySelector(".hx-run-status");
        status.innerHTML = "";
        if (entry.response) {
          status.append(el(`span.hx-status.small.${statusClass(entry.response.status)}`, {}, entry.response.status), el("span.hx-hint", {}, formatMs(entry.response.time_ms)));
        } else {
          errors++;
          status.append(el("span.hx-status.small.err", { title: entry.error }, "Erro"));
        }
        const tests = entry.tests || [];
        if (tests.length || entry.error) {
          row.append(
            el(
              "div.hx-run-tests",
              {},
              entry.error && !entry.response ? el("div.hx-test-err", {}, entry.error) : null,
              tests.map((t) => el(`div.hx-run-test.${t.passed ? "pass" : "fail"}`, {}, t.passed ? "✓ " : "✗ ", t.name, t.error ? el("span.hx-test-err", {}, ` — ${t.error}`) : null)),
            ),
          );
        }
        passed += tests.filter((t) => t.passed).length;
        const fails = tests.filter((t) => !t.passed).length;
        failed += fails;
        updateSummary();
        if (stopOnFail && (fails || !entry.response)) break outer;
        if (delay) await sleep(delay);
      }
    }
    running = false;
    startBtn.innerHTML = '<i class="fa-solid fa-play"></i> Executar novamente';
    updateSummary();
  };
  startBtn.addEventListener("click", start);

  openModal({
    title: `Runner — ${coll.name}`,
    iconCls: "fa-solid fa-forward",
    wide: true,
    body: el("div.hx-runner", {}, el("div.hx-run-left", {}, config, list), el("div.hx-run-right", {}, summary, results)),
    footer: [el("span.hx-hint", {}, "Variáveis definidas por scripts persistem entre as requisições."), el("span.hx-flex"), startBtn],
    onClose: () => {
      if (running) {
        stopped = true;
        onCancelRun();
      }
    },
  });
}
