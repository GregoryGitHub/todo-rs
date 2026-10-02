// Small building blocks shared by the HTTP request editor and its dialogs.

import { kv, AUTH_TYPES, DYNAMIC_VARS, varSegments } from "../utils/httpModel.js";
import { escapeHtml } from "../utils/noteContent.js";

/** Tiny DOM helper: el("div.cls", { title: "x", onclick }, child, "text"). */
export function el(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split(".");
  const node = document.createElement(name || "div");
  if (classes.length) node.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null) continue;
    if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === false) {
      if (k in node) node[k] = false;
    }
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "html") node.innerHTML = v;
    else if (k in node && typeof v !== "string") node[k] = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

export const icon = (cls) => el("i", { class: cls });

/** Toggle switch styled like the settings view. */
export function toggle(checked, onChange, { disabled = false } = {}) {
  const input = el("input", { type: "checkbox", checked, disabled, onchange: () => onChange(input.checked) });
  return el("label.toggle-switch.hx-toggle", {}, input, el("span.slider"));
}

export function select(options, value, onChange, { className = "hx-select", disabled = false } = {}) {
  const s = el(`select.${className}`, { disabled, onchange: () => onChange(s.value) });
  for (const o of options) s.append(el("option", { value: o.id, selected: o.id === value }, o.label));
  return s;
}

/** Inserts text at the caret of an input/textarea and fires "input". */
export function insertAtCaret(field, text) {
  field.focus();
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  field.setRangeText(text, start, end, "end");
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Textarea behaving like a small code editor (Tab indents, Enter keeps indentation). */
export function codeArea({ value = "", placeholder = "", readOnly = false, onInput, rows = 8, vars = false, className = "" }) {
  const ta = el(`textarea.hx-code-input${className ? `.${className}` : ""}`, {
    spellcheck: false,
    placeholder,
    readOnly,
    rows,
    oninput: () => onInput?.(ta.value),
  });
  if (vars) ta.dataset.vars = "";
  ta.value = value;
  ta.addEventListener("keydown", (e) => {
    if (readOnly) return;
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey) {
      if (!document.getElementById("hx-suggest")?.hidden) return;
      e.preventDefault();
      insertAtCaret(ta, "  ");
    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const before = ta.value.slice(0, ta.selectionStart);
      const line = before.slice(before.lastIndexOf("\n") + 1);
      let indent = line.match(/^\s*/)[0];
      if (/[{[(]\s*$/.test(line)) indent += "  ";
      if (indent) {
        e.preventDefault();
        insertAtCaret(ta, `\n${indent}`);
      }
    }
  });
  return ta;
}

// ---------- Key/value table ----------

const HEADER_SUGGESTIONS = [
  "Accept", "Accept-Encoding", "Accept-Language", "Authorization", "Cache-Control", "Connection", "Content-Type",
  "Cookie", "If-Match", "If-None-Match", "If-Modified-Since", "Origin", "Pragma", "Referer", "User-Agent",
  "X-API-Key", "X-Requested-With", "X-Request-Id", "X-Forwarded-For",
];
const CONTENT_TYPES = [
  "application/json", "application/xml", "application/x-www-form-urlencoded", "multipart/form-data",
  "text/plain", "text/html", "application/octet-stream",
];

function ensureDatalists() {
  if (document.getElementById("hx-dl-headers")) return;
  const mk = (id, values) => el("datalist", { id }, values.map((v) => el("option", { value: v })));
  document.body.append(mk("hx-dl-headers", HEADER_SUGGESTIONS), mk("hx-dl-content-types", CONTENT_TYPES));
}

function bulkText(rows) {
  return rows.map((r) => `${r.enabled ? "" : "//"}${r.key}:${r.value}`).join("\n");
}

function parseBulk(text, oldRows) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => {
      const disabled = line.startsWith("//");
      const body = disabled ? line.slice(2) : line;
      const idx = body.indexOf(":");
      const row = kv(idx >= 0 ? body.slice(0, idx).trim() : body.trim(), idx >= 0 ? body.slice(idx + 1).trim() : "", !disabled);
      const old = oldRows.find((r) => r.key === row.key);
      return old ? { ...old, ...row, description: old.description } : row;
    });
}

/**
 * Editable key/value grid (mutates `rows` in place). Options:
 *  - onChange(): called after every edit
 *  - fixedKeys: keys are read-only and rows cannot be added/removed (path variables)
 *  - files: rows get a Texto/Arquivo selector (form-data), pickFile(): Promise<path|null>
 *  - keyList: datalist id for key suggestions
 *  - description: show the description column
 *  - readOnly
 */
export function kvTable(rows, opts = {}) {
  ensureDatalists();
  const { onChange = () => {}, fixedKeys = false, files = false, keyList = null, description = true, readOnly = false } = opts;
  const keyPh = opts.keyPlaceholder || "Chave";
  const valuePh = opts.valuePlaceholder || "Valor";
  const wrap = el("div.hx-kv");
  let bulk = false;

  const header = el(
    "div.hx-kv-head",
    {},
    el("span"),
    el("span", {}, "Chave"),
    el("span", {}, "Valor"),
    description ? el("span.hx-kv-desc-col", {}, "Descrição") : null,
    fixedKeys || readOnly
      ? el("span")
      : el("button.hx-link", { type: "button", title: "Editar como texto (chave:valor por linha)", onclick: () => ((bulk = !bulk), render()) }, "Em massa"),
  );

  function rowEl(row, ghost) {
    const r = ghost ? kv() : row;
    if (files && ghost) Object.assign(r, { type: "text", file_path: "" });
    const line = el("div.hx-kv-row");
    line.classList.toggle("ghost", ghost);
    line.classList.toggle("disabled", !ghost && !r.enabled);
    if (description) line.classList.add("with-desc");

    const materialize = () => {
      if (!ghost) return;
      ghost = false;
      rows.push(r);
      line.classList.remove("ghost");
      check.disabled = false;
      del.hidden = false;
      line.after(rowEl(null, true));
    };
    const changed = () => {
      materialize();
      onChange();
    };

    const check = el("input.hx-kv-check", {
      type: "checkbox",
      checked: ghost ? false : r.enabled,
      disabled: ghost || readOnly,
      title: "Ativar/desativar",
      onchange: () => {
        r.enabled = check.checked;
        line.classList.toggle("disabled", !r.enabled);
        onChange();
      },
    });
    const keyIn = el("input.hx-kv-input", {
      value: r.key,
      placeholder: keyPh,
      readOnly: fixedKeys || readOnly,
      spellcheck: false,
      list: keyList || undefined,
      oninput: () => {
        r.key = keyIn.value;
        changed();
      },
    });
    keyIn.dataset.vars = "";

    let valueCell;
    if (files && r.type === "file") {
      const name = r.file_path ? r.file_path.split(/[\\/]/).pop() : "";
      valueCell = el(
        "button.hx-file-btn",
        {
          type: "button",
          title: r.file_path || "Escolher arquivo",
          disabled: readOnly,
          onclick: async () => {
            const path = await opts.pickFile?.();
            if (!path) return;
            r.file_path = path;
            changed();
            line.replaceWith(rowEl(r, false));
          },
        },
        icon("fa-regular fa-file"),
        el("span", {}, name || "Escolher arquivo…"),
      );
    } else {
      valueCell = el("input.hx-kv-input", {
        value: r.value,
        placeholder: valuePh,
        readOnly,
        spellcheck: false,
        list: opts.valueList?.(r) || undefined,
        oninput: () => {
          r.value = valueCell.value;
          changed();
        },
      });
      valueCell.dataset.vars = "";
    }

    const valueWrap = el("div.hx-kv-value", {}, valueCell);
    if (files && !readOnly) {
      const typeSel = select(
        [
          { id: "text", label: "Texto" },
          { id: "file", label: "Arquivo" },
        ],
        r.type,
        (t) => {
          r.type = t;
          changed();
          line.replaceWith(rowEl(r, false));
        },
        { className: "hx-kv-type" },
      );
      valueWrap.append(typeSel);
    }

    const descIn = description
      ? el("input.hx-kv-input.hx-kv-desc-col", {
          value: r.description || "",
          placeholder: "Descrição",
          readOnly,
          oninput: () => {
            r.description = descIn.value;
            changed();
          },
        })
      : null;

    const del = el(
      "button.hx-kv-del",
      {
        type: "button",
        title: "Remover",
        hidden: ghost || fixedKeys || readOnly,
        onclick: () => {
          const idx = rows.indexOf(r);
          if (idx >= 0) rows.splice(idx, 1);
          line.remove();
          onChange();
        },
      },
      icon("fa-solid fa-xmark"),
    );

    line.append(check, keyIn, valueWrap);
    if (descIn) line.append(descIn);
    line.append(del);
    return line;
  }

  function render() {
    wrap.innerHTML = "";
    wrap.classList.toggle("bulk", bulk);
    if (bulk) {
      header.lastChild.textContent = "Tabela";
      const ta = codeArea({
        value: bulkText(rows),
        placeholder: "chave:valor\n//desativado:valor",
        rows: Math.max(4, rows.length + 1),
        onInput: (v) => {
          const next = parseBulk(v, rows);
          rows.splice(0, rows.length, ...next);
          onChange();
        },
      });
      wrap.append(header, ta);
      return;
    }
    if (!fixedKeys && !readOnly) header.lastChild.textContent = "Em massa";
    wrap.append(header, ...rows.map((r) => rowEl(r, false)));
    if (!fixedKeys && !readOnly) wrap.append(rowEl(null, true));
  }

  render();
  return wrap;
}

// ---------- Auth editor ----------

function field(label, input, hint) {
  return el("label.hx-field", {}, el("span.hx-field-label", {}, label), input, hint ? el("span.hx-field-hint", {}, hint) : null);
}

function varInput(value, onInput, { placeholder = "", type = "text", readOnly = false } = {}) {
  const input = el("input.hx-input", { value, placeholder, type, readOnly, spellcheck: false, oninput: () => onInput(input.value) });
  input.dataset.vars = "";
  return input;
}

/** Edits `auth` in place. `inheritInfo` describes the parent auth when type is "inherit". */
export function authEditor(auth, { onChange, allowInherit = true, inheritInfo = null, onEditParent = null, readOnly = false }) {
  const wrap = el("div.hx-auth");
  const render = () => {
    wrap.innerHTML = "";
    const types = AUTH_TYPES.filter((t) => allowInherit || t.id !== "inherit");
    const typeSel = select(types, auth.type, (t) => {
      auth.type = t;
      onChange();
      render();
    }, { disabled: readOnly });
    const left = el("div.hx-auth-type", {}, field("Tipo", typeSel));
    const right = el("div.hx-auth-fields");
    wrap.append(left, right);

    const set = (obj, key) => (v) => {
      obj[key] = v;
      onChange();
    };
    if (auth.type === "inherit") {
      right.append(el("p.hx-hint", {}, inheritInfo || "Usa a autenticação da coleção."));
      if (onEditParent) right.append(el("button.hx-link", { type: "button", onclick: onEditParent }, "Editar autenticação da coleção"));
    } else if (auth.type === "none") {
      right.append(el("p.hx-hint", {}, "Esta requisição não usa autenticação."));
    } else if (auth.type === "bearer") {
      right.append(field("Token", varInput(auth.bearer.token, set(auth.bearer, "token"), { placeholder: "{{token}}", readOnly }), "Enviado como \"Authorization: Bearer <token>\"."));
    } else if (auth.type === "basic") {
      right.append(
        field("Usuário", varInput(auth.basic.username, set(auth.basic, "username"), { readOnly })),
        field("Senha", varInput(auth.basic.password, set(auth.basic, "password"), { type: "password", readOnly })),
      );
    } else if (auth.type === "apikey") {
      right.append(
        field("Chave", varInput(auth.apikey.key, set(auth.apikey, "key"), { placeholder: "X-API-Key", readOnly })),
        field("Valor", varInput(auth.apikey.value, set(auth.apikey, "value"), { placeholder: "{{apiKey}}", readOnly })),
        field(
          "Adicionar em",
          select(
            [
              { id: "header", label: "Cabeçalho" },
              { id: "query", label: "Query params" },
            ],
            auth.apikey.in,
            set(auth.apikey, "in"),
            { disabled: readOnly },
          ),
        ),
      );
    }
  };
  render();
  return wrap;
}

// ---------- {{variable}} highlighting & autocomplete ----------

/** Paints `{{var}}` backgrounds behind a transparent input (see .hx-url-hl). */
export function paintVarHighlight(target, text, scope) {
  target.innerHTML = "";
  for (const seg of varSegments(text, scope)) {
    if (!seg.name) target.append(seg.text);
    else target.append(el(`span.hx-var.${seg.known ? "known" : "unknown"}`, {}, seg.text));
  }
  target.append(" ");
}

export function varTooltip(text, scope) {
  return varSegments(text, scope)
    .filter((s) => s.name)
    .map((s) => (s.known ? `{{${s.name}}} = ${s.value}${s.source ? `  (${s.source})` : ""}` : `{{${s.name}}} não definida`))
    .join("\n");
}

/**
 * Autocomplete for `{{` inside any input/textarea with [data-vars] under `root`.
 * `getScope()` returns the current variable Map.
 */
export function attachVarAutocomplete(root, popup, getScope) {
  let target = null;
  let items = [];
  let active = 0;
  let start = 0;

  const close = () => {
    popup.hidden = true;
    target = null;
  };

  const choose = (name) => {
    if (!target) return;
    const t = target;
    const caret = t.selectionStart;
    const after = t.value.slice(caret);
    const closing = after.startsWith("}}") ? "" : "}}";
    t.setRangeText(`${name}${closing}`, start, caret, "end");
    if (!closing) t.setSelectionRange(t.selectionStart + 2, t.selectionStart + 2);
    close();
    t.dispatchEvent(new Event("input", { bubbles: true }));
    t.focus();
  };

  const render = () => {
    popup.innerHTML = "";
    items.forEach((it, i) => {
      const row = el(
        "div.hx-suggest-item",
        { onmousedown: (e) => (e.preventDefault(), choose(it.name)) },
        el("span.hx-suggest-name", {}, it.name),
        el("span.hx-suggest-val", {}, it.value),
        el("span.hx-suggest-src", {}, it.source),
      );
      row.classList.toggle("active", i === active);
      popup.append(row);
    });
    popup.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  };

  const update = (t) => {
    const caret = t.selectionStart;
    const before = t.value.slice(0, caret);
    const m = before.match(/\{\{([\w.$-]*)$/);
    if (!m) return close();
    const partial = m[1].toLowerCase();
    start = caret - m[1].length;
    const scope = getScope();
    items = [
      ...[...scope].map(([name, v]) => ({ name, value: v.value, source: v.source })),
      ...Object.keys(DYNAMIC_VARS).map((name) => ({ name, value: "dinâmica", source: "Dinâmica" })),
    ]
      .filter((it) => it.name.toLowerCase().includes(partial))
      .slice(0, 40);
    if (!items.length) return close();
    target = t;
    active = 0;
    render();
    popup.hidden = false;
    const r = t.getBoundingClientRect();
    const host = root.getBoundingClientRect();
    const width = Math.max(220, Math.min(340, r.width));
    popup.style.width = `${width}px`;
    popup.style.left = `${Math.max(6, Math.min(r.left - host.left, host.width - width - 6))}px`;
    const below = r.bottom - host.top + 4;
    popup.style.top = below + 200 > host.height ? `${Math.max(6, r.top - host.top - popup.offsetHeight - 4)}px` : `${below}px`;
  };

  root.addEventListener("input", (e) => {
    if (e.target.matches?.("[data-vars]")) update(e.target);
  });
  root.addEventListener("keydown", (e) => {
    if (popup.hidden || e.target !== target) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      render();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      choose(items[active].name);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }, true);
  root.addEventListener("focusout", () => setTimeout(() => {
    if (target && document.activeElement !== target) close();
  }, 100));
  return { close };
}

// ---------- Response rendering ----------

const JSON_TOKEN = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],]/g;

/** Syntax-highlighted HTML for an already pretty-printed JSON string. */
export function highlightJson(text) {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(JSON_TOKEN)) {
    out += escapeHtml(text.slice(last, m.index));
    const tok = m[0];
    let cls = "num";
    if (m[1]) cls = m[2] ? "key" : "str";
    else if (m[3]) cls = "bool";
    else if (tok === "null") cls = "null";
    else if (/^[{}[\],]$/.test(tok)) cls = "punc";
    if (m[1] && m[2]) out += `<span class="j-key">${escapeHtml(m[1])}</span>${escapeHtml(m[2])}`;
    else out += `<span class="j-${cls}">${escapeHtml(tok)}</span>`;
    last = m.index + tok.length;
  }
  return out + escapeHtml(text.slice(last));
}

/** Indents XML/HTML markup for the "Pretty" view (best effort, no parsing). */
export function prettyMarkup(text) {
  const tokens = text.replace(/>\s+</g, "><").split(/(?=<)|(?<=>)/);
  let depth = 0;
  const lines = [];
  const OPEN = /^<[^/!?][^>]*[^/]>$|^<[a-z]>$/i;
  const VOID = /^<(br|hr|img|input|meta|link|area|base|col|embed|source|track|wbr)\b/i;
  for (const tok of tokens) {
    if (!tok.trim()) continue;
    const prev = lines[lines.length - 1];
    // Keeps "<tag>text</tag>" and "<tag></tag>" on a single line.
    if (!tok.startsWith("<") && prev && OPEN.test(prev.trim()) && !VOID.test(prev.trim())) {
      lines[lines.length - 1] = prev + tok;
      continue;
    }
    if (tok.startsWith("</")) {
      depth = Math.max(0, depth - 1);
      if (prev && /^\s*<[^/!?][^>]*>[^<]*$/.test(prev) && !VOID.test(prev.trim())) {
        lines[lines.length - 1] = prev + tok;
        continue;
      }
    }
    lines.push("  ".repeat(depth) + tok);
    if (OPEN.test(tok) && !VOID.test(tok)) depth++;
  }
  return lines.join("\n");
}

export function codeBlock(html, { lines = 0, wrap = false } = {}) {
  const body = el("pre.hx-code-body", { html });
  const block = el("div.hx-code");
  block.classList.toggle("wrap", wrap);
  if (lines > 0 && !wrap) {
    block.append(el("pre.hx-gutter", {}, Array.from({ length: lines }, (_, i) => i + 1).join("\n")));
  }
  block.append(body);
  return block;
}
