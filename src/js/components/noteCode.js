import { codeEditor } from "./codeEditor.js";
import { createDiagramView, renderMermaidSvg, mermaidErrorText } from "./mermaidView.js";
import { highlightCode, CODE_LANGS, normalizeCodeLang } from "../utils/highlight.js";
import { foldRegions, splitHighlightedLines } from "../utils/codeBlock.js";
import { escapeHtml } from "../utils/noteContent.js";

// Blocos de código das Notas.
//
// Na nota o bloco é salvo como <pre data-lang="sql">texto</pre>. No editor ele vira um widget
// (div.nt-code, contenteditable=false) com cabeçalho (linguagem, dobrar, copiar, apagar) e:
//  - visualização: linhas numeradas e realçadas, com regiões que dobram/desdobram;
//  - edição: clicar no código troca para o codeEditor() no mesmo lugar (sai ao perder o foco);
//  - Mermaid: alterna entre o diagrama (zoom/arrastar) e o código.
// serializeEditorHtml() devolve o HTML da nota com os widgets de volta a <pre data-lang>.

const LINE = 19;
const PAD = 8;

const blocks = new WeakMap(); // widget -> estado
let ctx = {
  changed: () => {},
  exit: () => {},
  remove: () => {},
  readOnly: () => false,
};
let lastLang = "text";

/** Recebe do editor: changed(), exit(widget, "before"|"after"), remove(widget), readOnly(). */
export function initCodeBlocks(c) {
  ctx = { ...ctx, ...c };
  // Diagramas seguem o tema claro/escuro. O atributo é regravado com o mesmo valor (ex.: ao
  // carregar settings.json): só redesenha quando o tema muda de fato, senão o zoom/posição se perdem.
  new MutationObserver((records) => {
    if (records.every((r) => r.oldValue === document.documentElement.dataset.theme)) return;
    for (const w of document.querySelectorAll(".nt-code.is-mermaid")) {
      const s = blocks.get(w);
      if (s && !s.editing && s.mode === "view") renderBody(w);
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"], attributeOldValue: true });
}

export const isCodeBlock = (node) => blocks.has(node);

/** Widget que contém o nó (ou null). */
export function codeBlockOf(node) {
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const w = el?.closest?.(".nt-code");
  return w && blocks.has(w) ? w : null;
}

// ---------- Serialização ----------

const escapeText = (s) => s.replace(/[&<> ]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", " ": "&nbsp;" })[c]);

function blockHtml(w) {
  const s = blocks.get(w);
  return `<pre data-lang="${escapeHtml(s.lang)}">${escapeText(s.source)}</pre>`;
}

/** Substitui, num clone, os widgets (na mesma ordem de `originals`) pelo <pre data-lang>. */
function replaceClones(container, originals) {
  [...container.querySelectorAll(".nt-code")].forEach((clone, i) => {
    const w = originals[i];
    if (!w || !blocks.has(w)) return clone.remove();
    const tpl = document.createElement("template");
    tpl.innerHTML = blockHtml(w);
    clone.replaceWith(tpl.content);
  });
}

/** HTML da nota: igual a root.innerHTML, mas com os blocos de código no formato salvo. */
export function serializeEditorHtml(root) {
  if (!root.querySelector(".nt-code")) return root.innerHTML;
  let out = "";
  for (const n of root.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) out += escapeText(n.data);
    else if (n.nodeType !== Node.ELEMENT_NODE) continue;
    else if (blocks.has(n)) out += blockHtml(n);
    else if (!n.querySelector(".nt-code")) out += n.outerHTML;
    else {
      const clone = n.cloneNode(true);
      replaceClones(clone, [...n.querySelectorAll(".nt-code")]);
      out += clone.outerHTML;
    }
  }
  return out;
}

/** HTML/texto de uma seleção que inclui blocos de código (copiar/recortar). */
export function serializeRange(range, root) {
  const originals = [...root.querySelectorAll(".nt-code")].filter((w) => range.intersectsNode(w));
  if (!originals.length) return null;
  const box = document.createElement("div");
  box.append(range.cloneContents());
  // Um widget recortado pela seleção vira o bloco inteiro.
  replaceClones(box, originals);
  const text = [...box.childNodes].map((n) => n.textContent).join("\n");
  return { html: box.innerHTML, text };
}

/** Texto de um <pre> (com <br> e linhas em blocos). */
export function preText(pre) {
  const clone = pre.cloneNode(true);
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  clone.querySelectorAll("div,p").forEach((d) => d.previousSibling && d.before("\n"));
  return clone.textContent.replace(/\r\n?/g, "\n");
}

/** Troca os <pre data-lang> soltos em `root` (carregados, colados, desfeitos) por widgets. */
export function hydrateCodeBlocks(root) {
  for (const pre of root.querySelectorAll("pre[data-lang]")) {
    if (pre.closest(".nt-code")) continue;
    pre.replaceWith(createCodeBlock(preText(pre), pre.dataset.lang));
  }
}

// ---------- Widget ----------

const hlLang = (lang) => (lang === "html" ? "xml" : lang);

function langOptions(current) {
  const known = CODE_LANGS.some(([id]) => id === current);
  const opts = known ? CODE_LANGS : [...CODE_LANGS, [current, current]];
  return opts.map(([id, label]) => `<option value="${escapeHtml(id)}"${id === current ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

/** Cria o widget. mode (só Mermaid): "view" (diagrama) | "code" | "live" (código e diagrama lado a lado). */
export function createCodeBlock(source, lang, { mode = "view" } = {}) {
  lang = normalizeCodeLang(lang);
  const w = document.createElement("div");
  w.className = "nt-code";
  w.contentEditable = "false";
  w.innerHTML = `
    <div class="nc-head">
      <select class="nc-lang" title="Linguagem">${langOptions(lang)}</select>
      <span class="nc-spacer"></span>
      <div class="nc-seg" role="group">
        <button type="button" data-nc="view" title="Visualizar diagrama"><i class="fa-solid fa-diagram-project"></i><span>Visualizar</span></button>
        <button type="button" data-nc="code" title="Ver código"><i class="fa-solid fa-code"></i><span>Código</span></button>
        <button type="button" data-nc="live" title="Código e diagrama lado a lado, atualizando ao digitar"><i class="fa-solid fa-table-columns"></i><span>Live</span></button>
      </div>
      <button type="button" class="nc-btn" data-nc="fold-all" title="Recolher tudo"><i class="fa-solid fa-angles-up"></i></button>
      <button type="button" class="nc-btn" data-nc="copy" title="Copiar código"><i class="fa-regular fa-copy"></i></button>
      <button type="button" class="nc-btn nc-del" data-nc="delete" title="Apagar bloco"><i class="fa-regular fa-trash-can"></i></button>
    </div>
    <div class="nc-body"></div>`;
  const s = {
    lang,
    source: source.replace(/\n$/, ""),
    mode,
    editing: false,
    ce: null,
    folded: new Set(),
    regions: new Map(),
    diagram: null,
    rendered: null, // tema + fonte já desenhados no diagrama
    live: null, // { root, ce, viewPane, timer } no modo live
  };
  blocks.set(w, s);
  bind(w);
  renderBody(w);
  return w;
}

function bind(w) {
  const s = blocks.get(w);
  const head = w.querySelector(".nc-head");
  const body = w.querySelector(".nc-body");
  const select = head.querySelector(".nc-lang");

  // Botões não tiram o foco do editor de código (copiar enquanto edita).
  head.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });
  head.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-nc]");
    if (!btn) return;
    const action = btn.dataset.nc;
    if (action === "copy") copySource(w, btn);
    else if (action === "delete") !ctx.readOnly() && ctx.remove(w);
    else if (action === "fold-all") toggleAllFolds(w);
    else if (action === "view" || action === "code" || action === "live") {
      if (s.mode === action && !s.editing) return;
      s.mode = action;
      if (s.editing) s.ce.input.blur();
      else renderBody(w);
    }
  });
  // "input" (antes de borbulhar até o editor, que grava a alteração no histórico).
  select.addEventListener("input", () => {
    s.lang = normalizeCodeLang(select.value);
    lastLang = s.lang;
    if (s.lang === "mermaid" && !s.editing) s.mode = "view";
    if (s.editing) s.ce.setLang(hlLang(s.lang));
    renderBody(w);
  });

  body.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const fold = e.target.closest("[data-fold]");
    if (fold) {
      e.preventDefault();
      toggleFold(w, Number(fold.dataset.fold));
      return;
    }
    if (s.editing || ctx.readOnly() || e.target.closest(".nc-diagram, .nc-live")) return;
    if (e.target.closest(".nc-gutter")) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    startEdit(w, posFromPoint(w, e));
  });
}

function updateHead(w) {
  const s = blocks.get(w);
  const mermaid = s.lang === "mermaid";
  w.dataset.lang = s.lang;
  w.classList.toggle("is-mermaid", mermaid);
  w.classList.toggle("editing", s.editing);
  const showDiagram = mermaid && s.mode === "view" && !s.editing;
  const live = mermaid && s.mode === "live" && !s.editing;
  w.classList.toggle("is-live", live);
  w.classList.toggle("show-diagram", showDiagram);
  const ro = ctx.readOnly();
  w.classList.toggle("readonly", ro);
  const select = w.querySelector(".nc-lang");
  select.disabled = ro;
  if (select.value !== s.lang) select.innerHTML = langOptions(s.lang);
  for (const b of w.querySelectorAll(".nc-seg [data-nc]")) b.classList.toggle("active", b.dataset.nc === (showDiagram ? "view" : live ? "live" : "code"));
  const foldBtn = w.querySelector('[data-nc="fold-all"]');
  foldBtn.hidden = showDiagram || live || s.editing || !s.regions.size;
  const anyFolded = s.folded.size > 0;
  foldBtn.title = anyFolded ? "Expandir tudo" : "Recolher tudo";
  foldBtn.firstElementChild.className = `fa-solid ${anyFolded ? "fa-angles-down" : "fa-angles-up"}`;
}

function renderBody(w) {
  const s = blocks.get(w);
  if (!s.editing) {
    const mermaid = s.lang === "mermaid";
    if (mermaid && s.mode === "live") renderLive(w);
    else {
      if (s.live) clearTimeout(s.live.timer);
      s.live = null;
      if (mermaid && s.mode === "view") renderDiagram(w);
      else renderLines(w);
    }
  }
  updateHead(w);
}

function renderLines(w) {
  const s = blocks.get(w);
  const lines = s.source.split("\n");
  const hl = splitHighlightedLines(highlightCode(s.source, hlLang(s.lang)));
  s.regions = foldRegions(lines, s.lang);
  for (const f of s.folded) if (!s.regions.has(f)) s.folded.delete(f);

  let gutter = "";
  let code = "";
  for (let i = 0; i < lines.length; i++) {
    const end = s.regions.get(i);
    const folded = s.folded.has(i);
    const toggle =
      end === undefined
        ? ""
        : `<span class="nc-f" data-fold="${i}" title="${folded ? "Expandir" : "Recolher"}"><i class="fa-solid fa-chevron-${folded ? "right" : "down"}"></i></span>`;
    const ell = folded ? `<span class="nc-ell" data-fold="${i}" title="Expandir ${end - i} linha(s)">⋯</span>` : "";
    gutter += `<div class="nc-gl${folded ? " folded" : ""}">${i + 1}${toggle}</div>`;
    code += `<div class="nc-l${folded ? " folded" : ""}" data-i="${i}"><span class="nc-t">${hl[i] || ""}</span>${ell}</div>`;
    if (folded) i = end;
  }
  const body = w.querySelector(".nc-body");
  body.innerHTML =
    `<div class="nc-view" style="--nc-ch:${Math.max(2, String(lines.length).length)}">` +
    `<div class="nc-gutter">${gutter}</div><div class="nc-code"><div class="nc-lines">${code}</div></div></div>`;
}

/** Modo live: codeEditor à esquerda (sempre editável) e diagrama à direita, redesenhado ao digitar. */
function renderLive(w) {
  const s = blocks.get(w);
  const body = w.querySelector(".nc-body");
  if (!s.live || !body.contains(s.live.root)) {
    const root = document.createElement("div");
    root.className = "nc-live";
    const codePane = document.createElement("div");
    codePane.className = "nc-live-code";
    const viewPane = document.createElement("div");
    viewPane.className = "nc-live-view";
    const ce = codeEditor({
      value: s.source,
      lang: "mermaid",
      fill: true,
      lineHeight: LINE,
      padY: PAD,
      readOnly: ctx.readOnly(),
      className: "nc-ce",
      onInput: (v) => {
        s.source = v;
        clearTimeout(s.live.timer);
        s.live.timer = setTimeout(() => renderDiagram(w, viewPane), 300);
      },
    });
    ce.input.addEventListener("keydown", (e) => editKeys(w, e));
    ce.input.addEventListener("focus", () => w.classList.add("editing"));
    ce.input.addEventListener("blur", () => w.classList.remove("editing"));
    codePane.append(ce.root);
    root.append(codePane, viewPane);
    body.replaceChildren(root);
    s.live = { root, ce, viewPane, timer: 0 };
  } else if (s.live.ce.value !== s.source) s.live.ce.setValue(s.source);
  renderDiagram(w, s.live.viewPane);
}

/** Desenha o diagrama em `host` (corpo do bloco ou o painel direito do modo live). */
function renderDiagram(w, host = w.querySelector(".nc-body")) {
  const s = blocks.get(w);
  s.diagram ??= createDiagramView();
  const root = s.diagram.root;
  root.classList.toggle("fill", host !== w.querySelector(".nc-body"));
  if (root.parentElement !== host && !root.closest(".nc-fullscreen")) host.replaceChildren(root);
  const src = s.source;
  if (!src.trim()) {
    s.rendered = null;
    s.diagram.setMessage(s.mode === "live" ? "Diagrama vazio. Escreva o código ao lado." : "Diagrama vazio. Clique em Código ou Live para escrever.");
    return;
  }
  // Já desenhado com esta fonte e este tema: mantém o zoom/posição do usuário.
  const key = `${document.documentElement.dataset.theme}\0${src}`;
  if (s.rendered === key) return;
  s.rendered = key;
  renderMermaidSvg(src).then(
    (svg) => {
      if (s.rendered === key && s.diagram.root.isConnected) s.diagram.setSvg(svg);
    },
    (err) => {
      if (s.rendered === key) s.diagram.showError(mermaidErrorText(err));
    },
  );
}

function toggleFold(w, line) {
  const s = blocks.get(w);
  if (s.folded.has(line)) s.folded.delete(line);
  else if (s.regions.has(line)) s.folded.add(line);
  renderBody(w);
}

function toggleAllFolds(w) {
  const s = blocks.get(w);
  if (s.folded.size) s.folded.clear();
  else for (const line of s.regions.keys()) s.folded.add(line);
  renderBody(w);
}

async function copySource(w, btn) {
  try {
    await navigator.clipboard.writeText(blocks.get(w).source);
    const icon = btn.firstElementChild;
    icon.className = "fa-solid fa-check";
    setTimeout(() => (icon.className = "fa-regular fa-copy"), 1200);
  } catch (err) {
    console.error("copy failed", err);
  }
}

/** Posição no texto do ponto clicado na visualização. */
function posFromPoint(w, e) {
  const s = blocks.get(w);
  const lines = s.source.split("\n");
  const lineEl = e.target.closest(".nc-l");
  if (!lineEl) return s.source.length;
  const i = Number(lineEl.dataset.i);
  let col = lines[i].length;
  const t = lineEl.querySelector(".nc-t");
  const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
  if (r && t.contains(r.startContainer)) {
    const probe = document.createRange();
    probe.setStart(t, 0);
    probe.setEnd(r.startContainer, r.startOffset);
    col = Math.min(col, probe.toString().length);
  } else if (e.clientX < t.getBoundingClientRect().left) col = 0;
  let pos = 0;
  for (let k = 0; k < i; k++) pos += lines[k].length + 1;
  return pos + col;
}

// ---------- Edição ----------

/** Entra no modo de edição com o cursor em `pos` (número, "start" ou "end"). */
export function startEdit(w, pos = "end") {
  const s = blocks.get(w);
  if (!s || ctx.readOnly()) return;
  if (s.lang === "mermaid" && s.mode === "live" && s.live) {
    const input = s.live.ce.input;
    const p = pos === "end" ? input.value.length : pos === "start" ? 0 : pos;
    input.focus({ preventScroll: true });
    input.setSelectionRange(p, p);
    w.scrollIntoView({ block: "nearest" });
    return;
  }
  if (!s.editing) {
    s.editing = true;
    if (s.lang === "mermaid") s.mode = "code";
    s.ce = codeEditor({
      value: s.source,
      lang: hlLang(s.lang),
      minLines: 1,
      maxLines: 100_000,
      lineHeight: LINE,
      padY: PAD,
      className: "nc-ce",
      onInput: (v) => {
        s.source = v;
      },
    });
    const input = s.ce.input;
    input.addEventListener("keydown", (e) => editKeys(w, e));
    input.addEventListener("blur", () => stopEdit(w));
    w.querySelector(".nc-body").replaceChildren(s.ce.root);
    updateHead(w);
  }
  const input = s.ce.input;
  const p = pos === "end" ? input.value.length : pos === "start" ? 0 : pos;
  input.focus({ preventScroll: true });
  input.setSelectionRange(p, p);
  if (typeof pos === "string") w.scrollIntoView({ block: "nearest" });
}

function stopEdit(w) {
  const s = blocks.get(w);
  if (!s?.editing) return;
  s.editing = false;
  s.ce = null;
  renderBody(w);
}

function editKeys(w, e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  const input = e.target;
  const { selectionStart: a, selectionEnd: b, value: v } = input;
  const collapsed = a === b;
  if (e.key === "Escape") {
    e.preventDefault();
    ctx.exit(w, "after");
  } else if (collapsed && ((e.key === "ArrowUp" && !v.slice(0, a).includes("\n")) || (e.key === "ArrowLeft" && a === 0))) {
    e.preventDefault();
    ctx.exit(w, "before");
  } else if (collapsed && ((e.key === "ArrowDown" && !v.slice(a).includes("\n")) || (e.key === "ArrowRight" && a === v.length))) {
    e.preventDefault();
    ctx.exit(w, "after");
  } else if (e.key === "Backspace" && !v) {
    e.preventDefault();
    ctx.remove(w);
  }
}

/** Linguagem usada por último no seletor (padrão de novos blocos). */
export const lastCodeLang = () => lastLang;
