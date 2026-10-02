import { el } from "../utils/dom.js";
import { escapeHtml } from "../utils/noteContent.js";
import { SQL_KEYWORDS, SQL_FUNCTIONS } from "../utils/highlight.js";

// Autocomplete SQL leve: tabelas/views do banco, colunas (inclusive por alias "t."),
// palavras-chave e funções. Abre sozinho ao digitar 2+ letras ou depois de ".", ou com Ctrl+Espaço.

const KEYWORDS = SQL_KEYWORDS.split("|");
const FUNCTIONS = SQL_FUNCTIONS.split("|");
const MAX_ITEMS = 60;
const unquote = (s) => s.replace(/^\[|\]$/g, "").replace(/]]/g, "]");

/** Tabelas citadas no comando (FROM/JOIN/UPDATE/INTO) com seus aliases. */
export function tableRefs(sql) {
  const refs = [];
  const re = /\b(?:FROM|JOIN|UPDATE|INTO|APPLY)\s+((?:\[[^\]]+\]|[\w#@$]+)(?:\.(?:\[[^\]]+\]|[\w#@$]+)){0,2})(?:\s+(?:AS\s+)?(?!(?:WHERE|ON|JOIN|INNER|LEFT|RIGHT|FULL|CROSS|OUTER|GROUP|ORDER|SET|WITH|UNION|VALUES|SELECT|OUTPUT|HAVING)\b)(\[[^\]]+\]|[A-Za-z_][\w$]*))?/gi;
  for (const m of sql.matchAll(re)) {
    const parts = m[1].split(".").map(unquote);
    const name = parts[parts.length - 1];
    const schema = parts.length >= 2 ? parts[parts.length - 2] : "";
    refs.push({ schema, name, alias: m[2] ? unquote(m[2]) : "" });
  }
  return refs;
}

function rank(items, prefix) {
  const p = prefix.toLowerCase();
  const scored = [];
  for (const it of items) {
    const l = it.label.toLowerCase();
    let score = -1;
    if (!p) score = 1;
    else if (l.startsWith(p)) score = 3;
    else if (l.includes(`_${p}`)) score = 2;
    else if (l.includes(p)) score = 1;
    if (score >= 0) scored.push({ ...it, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.order - b.order || a.label.localeCompare(b.label)).slice(0, MAX_ITEMS);
}

function createPopup(host) {
  const pop = el("div.sqlc", { hidden: true, role: "listbox" });
  host.append(pop);
  let items = [];
  let index = 0;
  let onPick = null;
  const paint = () => {
    pop.innerHTML = items
      .map(
        (it, i) =>
          `<div class="sqlc-item${i === index ? " on" : ""}" data-i="${i}"><i class="${it.icon}"></i><span class="sqlc-label">${escapeHtml(it.label)}</span><span class="sqlc-detail">${escapeHtml(it.detail || "")}</span></div>`,
      )
      .join("");
    pop.querySelector(".sqlc-item.on")?.scrollIntoView({ block: "nearest" });
  };
  pop.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const row = e.target.closest(".sqlc-item");
    if (row) onPick?.(items[Number(row.dataset.i)]);
  });
  return {
    get isOpen() {
      return !pop.hidden;
    },
    show(list, x, y, pick) {
      items = list;
      index = 0;
      onPick = pick;
      if (!items.length) return this.hide();
      pop.hidden = false;
      paint();
      const hostW = host.clientWidth;
      pop.style.left = `${Math.max(4, Math.min(x, hostW - pop.offsetWidth - 4))}px`;
      pop.style.top = `${y}px`;
    },
    hide() {
      pop.hidden = true;
      items = [];
    },
    move(d) {
      index = (index + d + items.length) % items.length;
      paint();
    },
    current: () => items[index],
    destroy: () => pop.remove(),
  };
}

let measureCtx = null;
function textWidth(text, font) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/**
 * Liga o autocomplete a um codeEditor. getSource() → Promise<{ objects: [{schema,name,kind}], columnsOf(schema, name) → Promise<[{name, type}]> }>
 */
export function attachSqlComplete(editor, { getSource }) {
  const { input, root } = editor;
  const popup = createPopup(root);
  let timer = 0;
  let seq = 0;

  function wordBefore(pos) {
    const text = input.value;
    let i = pos;
    while (i > 0 && /[\w$#@\]]/.test(text[i - 1])) i--;
    if (text[i] === "[") i++;
    const word = text.slice(i, pos).replace(/^\[/, "");
    let qualifier = "";
    if (text[i - 1] === ".") {
      let j = i - 1;
      while (j > 0 && /[\w$#@\]\[]/.test(text[j - 1])) j--;
      qualifier = unquote(text.slice(j, i - 1));
    }
    return { start: i, word, qualifier };
  }

  function caretXY(pos) {
    const { line, col } = editor.position(pos);
    const style = getComputedStyle(input);
    const font = `${style.fontSize} ${style.fontFamily}`;
    const lineText = input.value.slice(input.value.lastIndexOf("\n", pos - 1) + 1, pos);
    const lineH = parseFloat(style.lineHeight) || 19;
    const codeLeft = input.offsetLeft + input.parentElement.offsetLeft;
    const x = codeLeft + parseFloat(style.paddingLeft) + textWidth(lineText, font) - input.scrollLeft;
    const y = input.offsetTop + parseFloat(style.paddingTop) + line * lineH - input.scrollTop + 2;
    return { x: col >= 0 ? x : 0, y };
  }

  async function open(explicit = false) {
    const pos = input.selectionStart;
    if (pos !== input.selectionEnd) return popup.hide();
    const { start, word, qualifier } = wordBefore(pos);
    if (!explicit && !qualifier && word.length < 2) return popup.hide();
    if (/^\d/.test(word)) return popup.hide();
    // Dentro de string ou comentário de linha: não sugere.
    const lineStart = input.value.lastIndexOf("\n", pos - 1) + 1;
    const before = input.value.slice(lineStart, pos);
    if ((before.match(/'/g) || []).length % 2 === 1 || before.includes("--")) return popup.hide();

    const my = ++seq;
    let source = null;
    try {
      source = await getSource();
    } catch {
      source = null;
    }
    if (my !== seq) return;
    const items = [];
    const statement = currentStatement(pos);
    const refs = tableRefs(statement);

    if (qualifier) {
      // alias.coluna | tabela.coluna | schema.tabela
      const ref = refs.find((r) => r.alias.toLowerCase() === qualifier.toLowerCase()) || refs.find((r) => r.name.toLowerCase() === qualifier.toLowerCase());
      if (ref && source) {
        const cols = await source.columnsOf(ref.schema, ref.name).catch(() => []);
        cols.forEach((c, i) => items.push({ label: c.name, detail: c.type, icon: "fa-solid fa-table-columns", insert: c.name, order: i }));
      }
      if (source) {
        for (const o of source.objects) if (o.schema.toLowerCase() === qualifier.toLowerCase()) items.push({ label: o.name, detail: o.kind, icon: o.kind === "view" ? "fa-solid fa-eye" : "fa-solid fa-table", insert: o.name, order: 50 });
      }
    } else {
      if (source) {
        for (const ref of refs.slice(0, 6)) {
          const cols = await source.columnsOf(ref.schema, ref.name).catch(() => []);
          for (const c of cols) items.push({ label: c.name, detail: `${ref.alias || ref.name} · ${c.type}`, icon: "fa-solid fa-table-columns", insert: c.name, order: 0 });
        }
        for (const o of source.objects) {
          items.push({ label: o.name, detail: `${o.schema} · ${o.kind}`, icon: o.kind === "view" ? "fa-solid fa-eye" : o.kind === "table" ? "fa-solid fa-table" : "fa-solid fa-gears", insert: o.schema && o.schema !== "dbo" ? `${o.schema}.${o.name}` : o.name, order: 1 });
        }
      }
      for (const k of KEYWORDS) items.push({ label: k, detail: "palavra-chave", icon: "fa-solid fa-font", insert: k, order: 2 });
      for (const f of FUNCTIONS) items.push({ label: f, detail: "função", icon: "fa-solid fa-square-root-variable", insert: `${f}(`, order: 3 });
    }
    if (my !== seq || input.selectionStart !== pos) return;
    const ranked = rank(dedupe(items), word);
    if (!explicit && ranked.length === 1 && ranked[0].label.toLowerCase() === word.toLowerCase()) return popup.hide();
    const { x, y } = caretXY(start);
    popup.show(ranked, x, y, (it) => pick(it, start));
  }

  function dedupe(items) {
    const seen = new Set();
    return items.filter((it) => {
      const k = `${it.label}|${it.detail}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function currentStatement(pos) {
    const text = input.value;
    const a = Math.max(text.lastIndexOf(";", pos - 1), text.lastIndexOf("\nGO", pos - 1), text.lastIndexOf("\n\n", pos - 1));
    let b = text.length;
    for (const sep of [";", "\nGO", "\n\n"]) {
      const i = text.indexOf(sep, pos);
      if (i >= 0) b = Math.min(b, i);
    }
    return text.slice(a + 1, b);
  }

  function pick(it, start) {
    const pos = input.selectionStart;
    const needsQuote = /[^\w$#@]/.test(it.insert.replace(/\.|\($/g, "")) && !it.insert.endsWith("(");
    const text = needsQuote ? it.insert.split(".").map((p) => `[${p.replace(/]/g, "]]")}]`).join(".") : it.insert;
    input.setSelectionRange(start, pos);
    if (!document.execCommand("insertText", false, text)) input.setRangeText(text, start, pos, "end");
    popup.hide();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === " " && e.ctrlKey) {
      e.preventDefault();
      return open(true);
    }
    if (!popup.isOpen) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopImmediatePropagation();
      popup.move(e.key === "ArrowDown" ? 1 : -1);
    } else if ((e.key === "Enter" && !e.ctrlKey && !e.metaKey) || e.key === "Tab") {
      e.preventDefault();
      e.stopImmediatePropagation();
      const it = popup.current();
      if (it) pick(it, wordBefore(input.selectionStart).start);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      popup.hide();
    }
  });
  input.addEventListener("input", (e) => {
    clearTimeout(timer);
    if (e.inputType && !e.inputType.startsWith("insert")) return popup.hide();
    timer = setTimeout(() => open(false), 120);
  });
  input.addEventListener("blur", () => setTimeout(() => popup.hide(), 100));
  input.addEventListener("scroll", () => popup.hide(), { passive: true });

  return {
    isOpen: () => popup.isOpen,
    destroy: () => popup.destroy(),
  };
}

/** Autocomplete simples de palavras (nomes de colunas) para um <input> de uma linha. */
export function attachWordComplete(input, getWords) {
  // Criado no primeiro uso: na ligação o input ainda pode não estar no DOM.
  let lazy = null;
  const popup = {
    get isOpen() {
      return !!lazy?.isOpen;
    },
    show: (...a) => (lazy ??= createPopup(input.parentElement)).show(...a),
    hide: () => lazy?.hide(),
    move: (d) => lazy?.move(d),
    current: () => lazy?.current(),
  };

  function wordAt() {
    const pos = input.selectionStart;
    let i = pos;
    while (i > 0 && /[\w$#@]/.test(input.value[i - 1])) i--;
    return { start: i, word: input.value.slice(i, pos) };
  }

  function open(explicit) {
    const { start, word } = wordAt();
    if (!explicit && word.length < 1) return popup.hide();
    const items = rank(
      getWords().map((w, i) => ({ label: w, icon: "fa-solid fa-table-columns", insert: w, order: i })),
      word,
    );
    if (!explicit && items.length === 1 && items[0].label.toLowerCase() === word.toLowerCase()) return popup.hide();
    const style = getComputedStyle(input);
    const x = input.offsetLeft + parseFloat(style.paddingLeft) + textWidth(input.value.slice(0, start), `${style.fontSize} ${style.fontFamily}`) - input.scrollLeft;
    popup.show(items, x, input.offsetTop + input.offsetHeight + 2, (it) => {
      const pos = input.selectionStart;
      const text = /[^\w$#@]/.test(it.insert) ? `[${it.insert.replace(/]/g, "]]")}]` : it.insert;
      input.setRangeText(text, start, pos, "end");
      popup.hide();
      input.focus();
    });
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === " " && e.ctrlKey) {
      e.preventDefault();
      return open(true);
    }
    if (!popup.isOpen) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopImmediatePropagation();
      popup.move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopImmediatePropagation();
      const it = popup.current();
      if (it) {
        const { start } = wordAt();
        const text = /[^\w$#@]/.test(it.insert) ? `[${it.insert.replace(/]/g, "]]")}]` : it.insert;
        input.setRangeText(text, start, input.selectionStart, "end");
      }
      popup.hide();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      popup.hide();
    }
  });
  input.addEventListener("input", (e) => (e.inputType?.startsWith("insert") ? open(false) : popup.hide()));
  input.addEventListener("blur", () => setTimeout(() => popup.hide(), 100));
}
