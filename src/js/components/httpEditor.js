import { state } from "../state.js";
import {
  METHODS,
  BODY_MODES,
  RAW_LANGS,
  mergeParamsFromUrl,
  syncPathVars,
  urlWithParams,
  autoHeaders,
  effectiveAuth,
  formatBytes,
  formatMs,
  statusClass,
  headerValue,
  parseSetCookies,
  AUTH_TYPES,
} from "../utils/httpModel.js";
import { looksLikeCurl } from "../utils/httpConvert.js";
import { SCRIPT_SNIPPETS } from "../utils/httpScripts.js";
import {
  el,
  icon,
  toggle,
  select,
  codeArea,
  insertAtCaret,
  kvTable,
  authEditor,
  paintVarHighlight,
  varTooltip,
  highlightJson,
  prettyMarkup,
  codeBlock,
} from "./httpWidgets.js";

// Request builder (URL bar + tabs) and response viewer of the HTTP tab.

const ui = state.httpUI;

const appEl = document.getElementById("http-app");
const nameEl = document.getElementById("hx-name");
const crumbEl = document.getElementById("hx-crumb");
const methodEl = document.getElementById("hx-method");
const urlEl = document.getElementById("hx-url");
const urlHlEl = document.getElementById("hx-url-hl");
const sendBtn = document.getElementById("hx-send");
const tabsEl = document.getElementById("hx-req-tabs");
const tabBodyEl = document.getElementById("hx-req-body");
const splitEl = document.getElementById("hx-split");
const resizerEl = document.getElementById("hx-resizer");
const responseEl = document.getElementById("hx-response");
const sideStatusEl = document.getElementById("hx-side-status");

const REQ_TABS = [
  { id: "params", label: "Params" },
  { id: "auth", label: "Autorização" },
  { id: "headers", label: "Cabeçalhos" },
  { id: "body", label: "Body" },
  { id: "scripts", label: "Scripts" },
  { id: "settings", label: "Configurações" },
];

const PRETTY_LIMIT = 2 * 1024 * 1024;

let hooks = {};
let req = null;
let readOnly = false;
let entry = null;
let scriptTab = "pre";

// ---------- Helpers ----------

function changed({ list = false } = {}) {
  if (!req || readOnly) return;
  hooks.onChange(req, { list });
}

function updateUrlHighlight() {
  const scope = hooks.getScope();
  paintVarHighlight(urlHlEl, urlEl.value, scope);
  urlHlEl.scrollLeft = urlEl.scrollLeft;
  urlEl.title = varTooltip(urlEl.value, scope);
}

function paintMethod() {
  methodEl.dataset.method = METHODS.includes(methodEl.value) ? methodEl.value : "OTHER";
}

function tabBadge(id) {
  if (!req) return null;
  if (id === "params") return req.params.filter((p) => p.enabled && p.key).length + req.path_vars.length || null;
  if (id === "headers") return req.headers.filter((h) => h.enabled && h.key).length || null;
  if (id === "body") return req.body.mode !== "none" ? "•" : null;
  if (id === "scripts") return req.scripts.pre.trim() || req.scripts.test.trim() ? "•" : null;
  if (id === "auth") return req.auth.type !== "inherit" && req.auth.type !== "none" ? "•" : null;
  return null;
}

function renderTabs() {
  tabsEl.innerHTML = "";
  for (const t of REQ_TABS) {
    const badge = tabBadge(t.id);
    const btn = el("button.hx-tab", { type: "button", onclick: () => ((ui.reqTab = t.id), renderTabs(), renderTabBody()) }, t.label, badge !== null ? el("span.hx-tab-badge", {}, badge) : null);
    btn.classList.toggle("active", ui.reqTab === t.id);
    tabsEl.append(btn);
  }
}

const refreshBadges = () => renderTabs();

function section(title, ...children) {
  return el("div.hx-section", {}, title ? el("div.hx-section-title", {}, title) : null, ...children);
}

// ---------- Request tabs ----------

function renderParams() {
  const onParams = () => {
    req.url = urlWithParams(req.url, req.params);
    urlEl.value = req.url;
    updateUrlHighlight();
    refreshBadges();
    changed({ list: true });
  };
  const nodes = [section("Query Params", kvTable(req.params, { onChange: onParams, readOnly }))];
  if (req.path_vars.length) {
    nodes.push(
      section(
        "Variáveis de caminho",
        kvTable(req.path_vars, { fixedKeys: true, readOnly, onChange: () => changed(), valuePlaceholder: "Valor de :variável" }),
      ),
    );
  } else {
    nodes.push(el("p.hx-hint", {}, "Dica: use ", el("code", {}, "/usuarios/:id"), " na URL para criar variáveis de caminho."));
  }
  return nodes;
}

function renderAuth() {
  const coll = hooks.getCollection(req);
  const parent = coll ? effectiveAuth({ auth: { type: "inherit" } }, coll) : null;
  const label = AUTH_TYPES.find((t) => t.id === parent?.type)?.label || "Sem autenticação";
  return [
    authEditor(req.auth, {
      readOnly,
      onChange: () => (refreshBadges(), changed()),
      inheritInfo: coll ? `Usando a autenticação da coleção "${coll.name}": ${label}.` : "Sem coleção.",
      onEditParent: coll ? () => hooks.onEditCollection(coll, "auth") : null,
    }),
  ];
}

function renderHeaders() {
  const autos = autoHeaders(req, hooks.getCollection(req), hooks.getScope());
  const details = el(
    "details.hx-auto-headers",
    {},
    el("summary", {}, `${autos.length} cabeçalhos automáticos`),
    el(
      "div.hx-auto-list",
      {},
      autos.map((h) => el("div.hx-auto-row", {}, el("span.hx-auto-key", {}, h.key), el("span.hx-auto-val", {}, h.value))),
      el("p.hx-hint", {}, "Adicione um cabeçalho com o mesmo nome para substituir um automático."),
    ),
  );
  return [
    section(
      null,
      kvTable(req.headers, {
        readOnly,
        keyList: "hx-dl-headers",
        valueList: (r) => (r.key.toLowerCase() === "content-type" ? "hx-dl-content-types" : null),
        onChange: () => (refreshBadges(), changed()),
      }),
    ),
    details,
  ];
}

function renderBody() {
  const b = req.body;
  const modes = el("div.hx-radios");
  for (const m of BODY_MODES) {
    const r = el("label.hx-radio", {}, el("input", {
      type: "radio",
      name: "hx-body-mode",
      checked: b.mode === m.id,
      disabled: readOnly,
      onchange: () => {
        b.mode = m.id;
        refreshBadges();
        changed();
        renderTabBody();
      },
    }), m.label);
    modes.append(r);
  }
  const bar = el("div.hx-body-bar", {}, modes);
  const nodes = [bar];

  if (b.mode === "none") nodes.push(el("p.hx-hint.hx-center", {}, "Esta requisição não tem corpo."));
  if (b.mode === "form-data") {
    nodes.push(kvTable(b.form, { files: true, readOnly, pickFile: () => hooks.pickFile(), onChange: () => changed() }));
  }
  if (b.mode === "urlencoded") nodes.push(kvTable(b.urlencoded, { readOnly, onChange: () => changed() }));
  if (b.mode === "raw") {
    const ta = codeArea({
      value: b.raw,
      readOnly,
      vars: true,
      rows: 12,
      placeholder: b.lang === "json" ? '{\n  "chave": "valor"\n}' : "",
      onInput: (v) => {
        b.raw = v;
        validate();
        changed();
      },
    });
    const status = el("span.hx-json-status");
    const validate = () => {
      status.textContent = "";
      status.className = "hx-json-status";
      if (b.lang !== "json" || !b.raw.trim()) return;
      try {
        JSON.parse(b.raw.replace(/\{\{[^{}]+\}\}/g, "0"));
        status.textContent = "JSON válido";
        status.classList.add("ok");
      } catch (e) {
        status.textContent = e.message.replace(/^JSON\.parse: /, "");
        status.classList.add("bad");
      }
    };
    bar.append(
      select(RAW_LANGS, b.lang, (l) => {
        b.lang = l;
        validate();
        changed();
      }, { className: "hx-select.small", disabled: readOnly }),
      el("button.hx-link", {
        type: "button",
        disabled: readOnly,
        title: "Formatar (JSON/XML)",
        onclick: () => {
          try {
            if (b.lang === "json") b.raw = JSON.stringify(JSON.parse(b.raw), null, 2);
            else if (b.lang === "xml" || b.lang === "html") b.raw = prettyMarkup(b.raw);
            ta.value = b.raw;
            changed();
          } catch (e) {
            hooks.toast(`Não foi possível formatar: ${e.message}`);
          }
        },
      }, "Formatar"),
    );
    nodes.push(ta, status);
    validate();
  }
  if (b.mode === "binary") {
    const name = b.binary_path ? b.binary_path.split(/[\\/]/).pop() : "";
    nodes.push(
      el(
        "div.hx-binary",
        {},
        el("button.hx-file-btn.large", {
          type: "button",
          disabled: readOnly,
          title: b.binary_path,
          onclick: async () => {
            const path = await hooks.pickFile();
            if (!path) return;
            b.binary_path = path;
            changed();
            renderTabBody();
          },
        }, icon("fa-regular fa-file"), el("span", {}, name || "Escolher arquivo…")),
        b.binary_path ? el("span.hx-hint", {}, b.binary_path) : null,
      ),
    );
  }
  if (b.mode === "graphql") {
    nodes.push(
      el(
        "div.hx-graphql",
        {},
        section("Query", codeArea({ value: b.graphql.query, readOnly, vars: true, rows: 10, placeholder: "query {\n  usuarios { id nome }\n}", onInput: (v) => ((b.graphql.query = v), changed()) })),
        section("Variáveis (JSON)", codeArea({ value: b.graphql.variables, readOnly, vars: true, rows: 10, placeholder: '{\n  "id": 1\n}', onInput: (v) => ((b.graphql.variables = v), changed()) })),
      ),
    );
  }
  return nodes;
}

/** Shared by the request and the collection settings dialog. */
export function scriptsEditor(scripts, { readOnly: ro = false, onChange, initial = "pre" } = {}) {
  let which = initial;
  const wrap = el("div.hx-scripts");
  const render = () => {
    wrap.innerHTML = "";
    const sub = el("div.hx-subtabs");
    for (const [id, label] of [["pre", "Pre-request"], ["test", "Tests"]]) {
      const b = el("button.hx-subtab", { type: "button", onclick: () => ((which = id), (scriptTab = id), render()) }, label, scripts[id].trim() ? el("span.hx-dot") : null);
      b.classList.toggle("active", which === id);
      sub.append(b);
    }
    const ta = codeArea({
      value: scripts[which],
      readOnly: ro,
      rows: 14,
      placeholder:
        which === "pre"
          ? "// Executado antes do envio\npm.environment.set(\"agora\", Date.now());"
          : "// Executado após a resposta\npm.test(\"Status 200\", () => pm.response.to.have.status(200));",
      onInput: (v) => {
        scripts[which] = v;
        onChange?.();
      },
    });
    const snippets = el(
      "div.hx-snippets",
      {},
      el("div.hx-snippets-title", {}, "Trechos"),
      SCRIPT_SNIPPETS[which].map((s) =>
        el("button.hx-snippet", {
          type: "button",
          disabled: ro,
          onclick: () => {
            const prefix = ta.value && !ta.value.endsWith("\n") ? "\n" : "";
            ta.setSelectionRange(ta.value.length, ta.value.length);
            insertAtCaret(ta, `${prefix}${s.code}\n`);
          },
        }, s.label),
      ),
    );
    wrap.append(sub, el("div.hx-script-layout", {}, ta, snippets));
  };
  render();
  return wrap;
}

function renderScripts() {
  return [scriptsEditor(req.scripts, { readOnly, initial: scriptTab, onChange: () => (refreshBadges(), changed()) })];
}

function settingRow(title, desc, control) {
  return el("div.hx-setting", {}, el("div.setting-info", {}, el("span.setting-title", {}, title), el("span.setting-desc", {}, desc)), control);
}

function renderSettings() {
  const s = req.settings;
  const g = state.http.settings;
  const timeout = el("input.hx-input.hx-num", {
    type: "number",
    min: 0,
    step: 500,
    value: s.timeout_ms || "",
    placeholder: String(g.timeout_ms),
    disabled: readOnly,
    oninput: () => {
      s.timeout_ms = Math.max(0, Number(timeout.value) || 0);
      changed();
    },
  });
  const gTimeout = el("input.hx-input.hx-num", {
    type: "number",
    min: 500,
    step: 500,
    value: g.timeout_ms,
    oninput: () => {
      g.timeout_ms = Math.max(500, Number(gTimeout.value) || 30000);
      hooks.onGlobalSettings();
    },
  });
  const gHistory = el("input.hx-input.hx-num", {
    type: "number",
    min: 0,
    max: 1000,
    value: g.history_limit,
    oninput: () => {
      g.history_limit = Math.min(1000, Math.max(0, Number(gHistory.value) || 0));
      hooks.onGlobalSettings();
    },
  });
  return [
    section(
      "Esta requisição",
      settingRow("Tempo limite (ms)", "Vazio = padrão global.", timeout),
      settingRow("Seguir redirecionamentos", "Segue respostas 3XX automaticamente (até 10).", toggle(s.follow_redirects, (v) => ((s.follow_redirects = v), changed()), { disabled: readOnly })),
      settingRow("Verificar certificado SSL", "Desative para servidores com certificado autoassinado.", toggle(s.verify_ssl, (v) => ((s.verify_ssl = v), changed()), { disabled: readOnly })),
    ),
    section(
      "Global",
      settingRow("Tempo limite padrão (ms)", "Usado quando a requisição não define um.", gTimeout),
      settingRow("Cookies automáticos", "Guarda e reenvia cookies entre requisições (sessão).", toggle(g.use_cookies, (v) => ((g.use_cookies = v), hooks.onGlobalSettings()))),
      settingRow("Itens no histórico", "Quantidade máxima guardada.", gHistory),
      el("div.hx-setting-actions", {}, el("button.hx-btn", { type: "button", onclick: hooks.onClearCookies }, icon("fa-solid fa-cookie-bite"), "Limpar cookies da sessão")),
    ),
  ];
}

function renderTabBody() {
  tabBodyEl.innerHTML = "";
  if (!req) return;
  const renderers = { params: renderParams, auth: renderAuth, headers: renderHeaders, body: renderBody, scripts: renderScripts, settings: renderSettings };
  tabBodyEl.append(...(renderers[ui.reqTab] || renderParams)());
  tabBodyEl.classList.toggle("read-only", readOnly);
}

// ---------- Public: request ----------

export function loadRequest(request, { readOnly: ro = false, crumb = "" } = {}) {
  req = request;
  readOnly = ro;
  if (!req) return;
  crumbEl.textContent = crumb;
  crumbEl.hidden = !crumb;
  nameEl.value = req.name;
  nameEl.readOnly = ro;
  if (![...methodEl.options].some((o) => o.value === req.method)) methodEl.append(el("option", { value: req.method }, req.method));
  methodEl.value = req.method;
  methodEl.disabled = ro;
  paintMethod();
  urlEl.value = req.url;
  urlEl.readOnly = ro;
  updateUrlHighlight();
  renderTabs();
  renderTabBody();
}

/** Re-renders whatever depends on variables (active environment changed). */
export function refreshVariables() {
  if (!req) return;
  updateUrlHighlight();
  if (ui.reqTab === "headers" || ui.reqTab === "auth") renderTabBody();
}

export function refreshRequestTab() {
  if (!req) return;
  renderTabs();
  renderTabBody();
}

export function focusUrl() {
  urlEl.focus();
  urlEl.select();
}

export function focusName() {
  nameEl.focus();
  nameEl.select();
}

// ---------- Response ----------

function bodyKind(res) {
  const ct = (headerValue(res.headers, "content-type") || "").toLowerCase();
  if (res.body_base64) {
    if (ct.startsWith("image/")) return "image";
    if (ct.includes("pdf")) return "pdf";
    return "binary";
  }
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("xml")) return "xml";
  if (ct.includes("javascript")) return "javascript";
  const t = res.body.trimStart();
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(res.body);
      return "json";
    } catch {
      /* text */
    }
  }
  if (/^<!doctype html|^<html/i.test(t)) return "html";
  if (/^<\?xml/i.test(t)) return "xml";
  return "text";
}

const KIND_LABEL = { json: "JSON", html: "HTML", xml: "XML", javascript: "JavaScript", text: "Texto", image: "Imagem", pdf: "PDF", binary: "Binário" };

function prettyBody(res, kind) {
  if (res.body.length > PRETTY_LIMIT) return null;
  if (kind === "json") {
    try {
      const text = JSON.stringify(JSON.parse(res.body), null, 2);
      return { html: highlightJson(text), lines: text.split("\n").length };
    } catch {
      return null;
    }
  }
  if (kind === "xml" || kind === "html") {
    const text = prettyMarkup(res.body);
    return { text, lines: text.split("\n").length };
  }
  return null;
}

function rawBlock(text) {
  const block = codeBlock("", { lines: ui.wrap ? 0 : text.split("\n").length, wrap: ui.wrap });
  block.querySelector(".hx-code-body").textContent = text;
  return block;
}

function renderBodyView(res) {
  const kind = bodyKind(res);
  const views = [
    { id: "pretty", label: "Pretty" },
    { id: "raw", label: "Raw" },
    { id: "preview", label: "Preview" },
  ];
  const seg = el("div.hx-seg");
  for (const v of views) {
    const b = el("button", { type: "button", onclick: () => ((ui.bodyView = v.id), renderResponseContent()) }, v.label);
    b.classList.toggle("active", ui.bodyView === v.id);
    seg.append(b);
  }
  const wrapBtn = el("button.hx-icon-btn", { type: "button", title: "Quebrar linhas", onclick: () => ((ui.wrap = !ui.wrap), renderResponseContent()) }, icon("fa-solid fa-paragraph"));
  wrapBtn.classList.toggle("active", ui.wrap);
  const bar = el(
    "div.hx-body-toolbar",
    {},
    seg,
    el("span.hx-kind", {}, KIND_LABEL[kind]),
    el("span.hx-flex"),
    wrapBtn,
    el("button.hx-icon-btn", { type: "button", title: "Copiar corpo", onclick: () => hooks.copy(res.body || "", "Corpo copiado") }, icon("fa-regular fa-copy")),
    el("button.hx-icon-btn", { type: "button", title: "Salvar em arquivo", onclick: () => hooks.saveResponse(entry) }, icon("fa-solid fa-download")),
  );

  let content;
  const binary = !!res.body_base64;
  const ct = headerValue(res.headers, "content-type") || "application/octet-stream";
  if (ui.bodyView === "preview") {
    if (kind === "image") content = el("div.hx-preview-img", {}, el("img", { src: `data:${ct};base64,${res.body_base64}`, alt: "Pré-visualização" }));
    else if (kind === "html") {
      const base = `<base href="${res.url.replace(/"/g, "&quot;")}">`;
      content = el("iframe.hx-preview-frame", { sandbox: "", srcdoc: base + res.body, title: "Pré-visualização" });
    } else if (kind === "pdf") content = el("iframe.hx-preview-frame", { src: `data:application/pdf;base64,${res.body_base64}`, title: "PDF" });
    else if (binary) content = el("div.hx-res-empty", {}, icon("fa-regular fa-file"), el("span", {}, "Sem pré-visualização para este tipo."));
    else content = rawBlock(res.body);
  } else if (binary) {
    content = el(
      "div.hx-res-empty",
      {},
      icon("fa-regular fa-file-zipper"),
      el("span", {}, `Resposta binária (${formatBytes(res.body_size)})`),
      el("button.hx-btn", { type: "button", onclick: () => hooks.saveResponse(entry) }, icon("fa-solid fa-download"), "Salvar em arquivo"),
      kind === "image" ? el("button.hx-link", { type: "button", onclick: () => ((ui.bodyView = "preview"), renderResponseContent()) }, "Ver imagem") : null,
    );
  } else if (!res.body) {
    content = el("div.hx-res-empty", {}, el("span", {}, "Corpo vazio"));
  } else if (ui.bodyView === "pretty") {
    const pretty = prettyBody(res, kind);
    if (!pretty) content = rawBlock(res.body);
    else if (pretty.html) content = codeBlock(pretty.html, { lines: ui.wrap ? 0 : pretty.lines, wrap: ui.wrap });
    else content = rawBlock(pretty.text);
  } else {
    content = rawBlock(res.body);
  }
  return [bar, el("div.hx-res-scroll", {}, content)];
}

function table(rows, cols) {
  if (!rows.length) return el("div.hx-res-empty", {}, el("span", {}, "Nada aqui."));
  return el(
    "table.hx-table",
    {},
    el("thead", {}, el("tr", {}, cols.map((c) => el("th", {}, c)))),
    el("tbody", {}, rows.map((r) => el("tr", {}, r.map((cell) => el("td", {}, cell))))),
  );
}

function renderTests() {
  const tests = entry.tests || [];
  if (!tests.length) {
    return [el("div.hx-res-empty", {}, icon("fa-solid fa-flask"), el("span", {}, "Nenhum teste. Escreva testes na aba Scripts → Tests."))];
  }
  const passed = tests.filter((t) => t.passed).length;
  return [
    el("div.hx-test-summary", {}, el("span.ok", {}, `${passed} passaram`), el("span.fail", {}, `${tests.length - passed} falharam`)),
    el(
      "div.hx-res-scroll",
      {},
      tests.map((t) =>
        el(
          `div.hx-test.${t.skipped ? "skip" : t.passed ? "pass" : "fail"}`,
          {},
          el("span.hx-test-badge", {}, t.skipped ? "SKIP" : t.passed ? "PASS" : "FAIL"),
          el("div", {}, el("div.hx-test-name", {}, t.name), t.error ? el("div.hx-test-err", {}, t.error) : null),
        ),
      ),
    ),
  ];
}

function renderConsole() {
  const logs = entry.logs || [];
  if (!logs.length) return [el("div.hx-res-empty", {}, icon("fa-solid fa-terminal"), el("span", {}, "Use console.log() nos scripts para ver mensagens aqui."))];
  return [el("div.hx-res-scroll", {}, el("div.hx-console", {}, logs.map((l) => el(`div.hx-log.${l.level}`, {}, l.text))))];
}

function renderSent() {
  const s = entry.sent;
  if (!s) return [el("div.hx-res-empty", {}, el("span", {}, "A requisição não chegou a ser montada."))];
  return [
    el(
      "div.hx-res-scroll",
      {},
      el("div.hx-sent-line", {}, el("span.hx-method-tag", { dataset: { method: s.method } }, s.method), el("span.hx-sent-url", {}, s.url)),
      table(s.headers.map((h) => [h.key, h.value]), ["Cabeçalho", "Valor"]),
      s.bodyPreview ? el("div.hx-section-title", {}, "Corpo") : null,
      s.bodyPreview ? rawBlock(s.bodyPreview) : null,
    ),
  ];
}

function renderResponseContent() {
  const body = responseEl.querySelector(".hx-res-content");
  if (!body) return;
  body.innerHTML = "";
  const res = entry.response;
  responseEl.querySelectorAll(".hx-res-tabs .hx-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === ui.resTab));
  if (ui.resTab === "body" && res) body.append(...renderBodyView(res));
  if (ui.resTab === "headers" && res) {
    body.append(el("div.hx-res-scroll", {}, table(res.headers.map(([k, v]) => [k, v]), ["Cabeçalho", "Valor"])));
  }
  if (ui.resTab === "cookies" && res) {
    const cookies = parseSetCookies(res.headers);
    body.append(
      el(
        "div.hx-res-scroll",
        {},
        table(
          cookies.map((c) => [c.name, c.value, c.domain, c.path, c.expires, [c.httpOnly && "HttpOnly", c.secure && "Secure"].filter(Boolean).join(", ")]),
          ["Nome", "Valor", "Domínio", "Caminho", "Expira", "Flags"],
        ),
      ),
    );
  }
  if (ui.resTab === "tests") body.append(...renderTests());
  if (ui.resTab === "console") body.append(...renderConsole());
  if (ui.resTab === "sent") body.append(...renderSent());
}

function updateSideStatus() {
  sideStatusEl.className = "hx-side-status";
  sideStatusEl.textContent = "";
  if (!entry) return;
  if (entry.state === "loading") {
    sideStatusEl.classList.add("loading");
    sideStatusEl.textContent = "…";
  } else if (entry.response) {
    sideStatusEl.classList.add(statusClass(entry.response.status));
    sideStatusEl.textContent = entry.response.status;
  } else if (entry.error) {
    sideStatusEl.classList.add("err");
    sideStatusEl.textContent = "!";
  }
}

export function renderResponse(e) {
  entry = e;
  responseEl.innerHTML = "";
  updateSideStatus();
  const sending = entry?.state === "loading";
  sendBtn.classList.toggle("cancel", sending);
  sendBtn.innerHTML = sending ? '<i class="fa-solid fa-xmark"></i><span>Cancelar</span>' : '<i class="fa-solid fa-paper-plane"></i><span>Enviar</span>';
  sendBtn.title = sending ? "Cancelar requisição" : "Enviar (Ctrl+Enter)";

  if (!entry) {
    responseEl.append(
      el(
        "div.hx-res-placeholder",
        {},
        el("div.hx-res-illus", {}, icon("fa-solid fa-paper-plane")),
        el("strong", {}, "Envie a requisição para ver a resposta"),
        el("span", {}, el("kbd", {}, "Ctrl"), " + ", el("kbd", {}, "Enter"), " envia de qualquer lugar"),
      ),
    );
    return;
  }
  if (sending) {
    responseEl.append(
      el(
        "div.hx-res-placeholder",
        {},
        el("div.hx-spinner"),
        el("strong", {}, "Enviando requisição…"),
        el("button.hx-btn", { type: "button", onclick: hooks.onCancel }, "Cancelar"),
      ),
    );
    return;
  }

  const res = entry.response;
  const head = el("div.hx-res-head");
  if (res) {
    const status = el(`span.hx-status.${statusClass(res.status)}`, { title: res.http_version }, `${res.status} ${res.status_text}`.trim());
    const size = el("span.hx-metric", { title: `Cabeçalhos: ${formatBytes(res.headers_size)}\nCorpo: ${formatBytes(res.body_size)}` }, formatBytes(res.body_size + res.headers_size));
    head.append(status, el("span.hx-metric", { title: "Tempo total" }, icon("fa-regular fa-clock"), formatMs(res.time_ms)), size);
  } else {
    head.append(el("span.hx-status.err", {}, "Erro"));
  }
  responseEl.append(head);

  if (!res) {
    responseEl.append(
      el(
        "div.hx-res-error",
        {},
        icon("fa-solid fa-triangle-exclamation"),
        el("strong", {}, "Não foi possível obter resposta"),
        el("code", {}, entry.error || "Erro desconhecido"),
        el("span.hx-hint", {}, "Verifique a URL, a conexão, o proxy/firewall ou desative a verificação SSL em Configurações."),
      ),
    );
    if (entry.logs?.length || entry.sent) {
      const tabs = el("div.hx-tabs.hx-res-tabs");
      for (const [id, label] of [["console", `Console (${entry.logs?.length || 0})`], ["sent", "Requisição"]]) {
        tabs.append(el("button.hx-tab", { type: "button", dataset: { tab: id }, onclick: () => ((ui.resTab = id), renderResponseContent()) }, label));
      }
      if (!["console", "sent"].includes(ui.resTab)) ui.resTab = "sent";
      responseEl.append(tabs, el("div.hx-res-content"));
      renderResponseContent();
    }
    return;
  }

  const tests = entry.tests || [];
  const failed = tests.some((t) => !t.passed);
  const tabs = el("div.hx-tabs.hx-res-tabs");
  const defs = [
    ["body", "Corpo"],
    ["headers", `Cabeçalhos (${res.headers.length})`],
    ["cookies", `Cookies (${parseSetCookies(res.headers).length})`],
    ["tests", tests.length ? `Testes (${tests.filter((t) => t.passed).length}/${tests.length})` : "Testes"],
    ["console", `Console${entry.logs?.length ? ` (${entry.logs.length})` : ""}`],
    ["sent", "Requisição"],
  ];
  for (const [id, label] of defs) {
    const b = el("button.hx-tab", { type: "button", dataset: { tab: id }, onclick: () => ((ui.resTab = id), renderResponseContent()) }, label);
    if (id === "tests" && tests.length) b.classList.add(failed ? "bad" : "good");
    tabs.append(b);
  }
  responseEl.append(tabs, el("div.hx-res-content"));
  renderResponseContent();
}

// ---------- Init ----------

function applySplit() {
  splitEl.style.setProperty("--hx-split", `${Math.round(ui.split * 1000) / 10}%`);
}

function initResizer() {
  resizerEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    resizerEl.setPointerCapture(e.pointerId);
    const rect = splitEl.getBoundingClientRect();
    const move = (ev) => {
      ui.split = Math.min(0.82, Math.max(0.18, (ev.clientY - rect.top) / rect.height));
      applySplit();
    };
    const up = () => {
      resizerEl.removeEventListener("pointermove", move);
      resizerEl.removeEventListener("pointerup", up);
      appEl.classList.remove("resizing");
    };
    appEl.classList.add("resizing");
    resizerEl.addEventListener("pointermove", move);
    resizerEl.addEventListener("pointerup", up);
  });
  resizerEl.addEventListener("dblclick", () => {
    ui.split = 0.48;
    applySplit();
  });
  applySplit();
}

/**
 * hooks: getScope(), getCollection(req), onChange(req, {list}), onSend(), onCancel(),
 * onImportCurl(text), pickFile(), onEditCollection(coll, tab), saveResponse(entry),
 * copy(text, msg), toast(msg), onGlobalSettings(), onClearCookies()
 */
export function initHttpEditor(h) {
  hooks = h;
  for (const m of METHODS) methodEl.append(el("option", { value: m }, m));

  nameEl.addEventListener("input", () => {
    if (!req) return;
    req.name = nameEl.value;
    changed({ list: true });
  });
  nameEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      urlEl.focus();
    }
  });
  nameEl.addEventListener("blur", () => {
    if (req && !readOnly && !req.name.trim()) {
      req.name = "Nova Requisição";
      nameEl.value = req.name;
      changed({ list: true });
    }
  });

  methodEl.addEventListener("change", () => {
    if (!req) return;
    req.method = methodEl.value;
    paintMethod();
    changed({ list: true });
  });

  urlEl.addEventListener("input", () => {
    if (!req) return;
    req.url = urlEl.value;
    req.params = mergeParamsFromUrl(req.url, req.params);
    req.path_vars = syncPathVars(req.url, req.path_vars);
    updateUrlHighlight();
    refreshBadges();
    if (ui.reqTab === "params") renderTabBody();
    changed({ list: true });
  });
  urlEl.addEventListener("scroll", () => (urlHlEl.scrollLeft = urlEl.scrollLeft));
  urlEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && document.getElementById("hx-suggest").hidden) {
      e.preventDefault();
      hooks.onSend();
    }
  });
  urlEl.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text") || "";
    if (!readOnly && looksLikeCurl(text)) {
      e.preventDefault();
      hooks.onImportCurl(text);
    }
  });

  sendBtn.addEventListener("click", () => (entry?.state === "loading" ? hooks.onCancel() : hooks.onSend()));
  initResizer();
}
