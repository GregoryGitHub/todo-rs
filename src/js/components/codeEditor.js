import { highlightCode } from "../utils/highlight.js";

// Editor de código leve: <textarea> transparente sobre um <pre> realçado + numeração de linhas.
// Usado pelo Formatter JSON e pelos campos de body/scripts do cliente HTTP.
//
// O realce e a numeração são virtualizados: só as linhas visíveis (+ OVERSCAN) viram HTML,
// então o custo de digitar, rolar ou mostrar a aba não depende do tamanho do texto.

const DEFAULT_HIGHLIGHT_LIMIT = 10_000_000; // acima disso: texto puro (sem cores)
const OVERSCAN = 40; // linhas desenhadas além da área visível, acima e abaixo

/** Início (índice) de cada linha do texto. */
function indexLines(text) {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

/**
 * opts:
 *  - value, lang ("json" | "javascript" | "xml" | "html" | "graphql" | "text"), placeholder, readOnly
 *  - onInput(value): chamado a cada edição
 *  - fill: true ocupa a altura do pai (rolagem interna); false cresce com o conteúdo
 *  - minLines / maxLines: limites de altura quando fill = false
 *  - lineHeight (px), indent (string ou função que devolve a unidade de recuo)
 *  - vars / varState(name): realça {{variáveis}} (cliente HTTP); o textarea recebe data-vars
 *  - skipKey(e): true para ignorar Tab/Enter (ex.: autocomplete aberto)
 *  - hideGutterWhenEmpty, className
 */
export function codeEditor(opts = {}) {
  const {
    value = "",
    placeholder = "",
    readOnly = false,
    onInput,
    fill = false,
    minLines = 6,
    maxLines = 30,
    lineHeight = 19,
    padY = 10,
    vars = false,
    varState = null,
    skipKey = null,
    hideGutterWhenEmpty = false,
    highlightLimit = DEFAULT_HIGHLIGHT_LIMIT,
    className = "",
  } = opts;
  let lang = opts.lang || "text";
  const indentUnit = () => (typeof opts.indent === "function" ? opts.indent() : opts.indent || "  ");

  const root = document.createElement("div");
  root.className = `ce${fill ? " ce-fill" : ""}${className ? ` ${className}` : ""}`;
  root.style.setProperty("--ce-line", `${lineHeight}px`);
  root.style.setProperty("--ce-pad-y", `${padY}px`);

  const gutterBox = document.createElement("div");
  gutterBox.className = "ce-gutter";
  gutterBox.setAttribute("aria-hidden", "true");
  const gutter = document.createElement("pre");
  gutterBox.append(gutter);

  const code = document.createElement("div");
  code.className = "ce-code";
  const hl = document.createElement("pre");
  hl.className = "ce-hl";
  hl.setAttribute("aria-hidden", "true");
  const input = document.createElement("textarea");
  input.className = "ce-input";
  input.spellcheck = false;
  input.wrap = "off";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocapitalize", "off");
  input.placeholder = placeholder;
  input.readOnly = readOnly;
  if (vars) input.dataset.vars = "";
  input.value = value;
  code.append(hl, input);
  root.append(gutterBox, code);

  let frame = 0;
  let lineStarts = [0];
  let indexedText = null; // texto que gerou lineStarts
  let errorLine = null;
  let win = { start: 0, end: -1 }; // linhas (0-based) presentes no HTML
  let stale = true; // conteúdo/realce precisa ser refeito mesmo dentro da janela

  function ensureIndex() {
    if (indexedText !== input.value) {
      indexedText = input.value;
      lineStarts = indexLines(indexedText);
    }
  }

  /** Faixa de linhas visíveis agora (0-based, inclusiva). */
  function visibleRange() {
    const viewH = input.clientHeight || lineHeight * 40;
    const first = Math.max(0, Math.floor((input.scrollTop - padY) / lineHeight));
    const last = Math.min(lineStarts.length - 1, Math.ceil((input.scrollTop + viewH) / lineHeight));
    return { first, last };
  }

  function paintWindow() {
    const text = input.value;
    const total = lineStarts.length;
    const { first, last } = visibleRange();
    const start = Math.max(0, first - OVERSCAN);
    const end = Math.min(total - 1, last + OVERSCAN);
    win = { start, end };

    const from = lineStarts[start];
    const to = end + 1 < total ? lineStarts[end + 1] - 1 : text.length;
    const plain = text.length > highlightLimit;
    hl.innerHTML = plain ? "" : highlightCode(text.slice(from, to), lang, { vars, varState }) + "\n";

    let g = "";
    for (let i = start + 1; i <= end + 1; i++) g += i === errorLine ? `<span class="ce-err">${i}</span>\n` : `${i}\n`;
    gutter.innerHTML = g;
    stale = false;
  }

  function render() {
    frame = 0;
    ensureIndex();
    const text = input.value;
    const total = lineStarts.length;
    root.classList.toggle("plain", text.length > highlightLimit);
    root.classList.toggle("empty", !text);
    root.classList.toggle("no-gutter", hideGutterWhenEmpty && !text);
    root.style.setProperty("--ce-gutter-ch", String(Math.max(2, String(total).length)));

    if (!fill) {
      const visible = Math.min(Math.max(total, minLines), maxLines);
      // + espaço da barra de rolagem horizontal
      root.style.height = `${visible * lineHeight + padY * 2 + 12}px`;
    }
    paintWindow();
    sync();
  }

  /** Acompanha a rolagem; redesenha só se a área visível sair da janela já desenhada. */
  function sync() {
    const y = win.start * lineHeight - input.scrollTop;
    hl.style.transform = `translate(${-input.scrollLeft}px, ${y}px)`;
    gutter.style.transform = `translateY(${y}px)`;
    if (!stale) {
      const { first, last } = visibleRange();
      if (first < win.start || last > win.end) schedule();
    }
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function invalidate() {
    stale = true;
    schedule();
  }

  function insert(text) {
    if (!document.execCommand("insertText", false, text)) input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
  }

  function onKeydown(e) {
    if (readOnly || e.ctrlKey || e.metaKey || e.altKey || skipKey?.(e)) return;
    const { selectionStart: s, selectionEnd: end, value: v } = input;
    if (e.key === "Tab") {
      e.preventDefault();
      const unit = indentUnit();
      if (s === end && !e.shiftKey) return insert(unit);
      // Indenta/desindenta todas as linhas da seleção.
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const block = v.slice(lineStart, end);
      const out = e.shiftKey ? block.replace(/^( {1,4}|\t)/gm, "") : block.replace(/^/gm, unit);
      input.setSelectionRange(lineStart, end);
      insert(out);
      input.setSelectionRange(lineStart, lineStart + out.length);
    } else if (e.key === "Enter" && !e.shiftKey) {
      // Mantém o recuo da linha e abre um nível depois de { [ ( ou de uma tag aberta.
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const line = v.slice(lineStart, s);
      const indent = /^[ \t]*/.exec(line)[0];
      const last = line.trimEnd().slice(-1);
      const next = v[s];
      const opens = last && "{[(".includes(last) ? last : /<[\w:.-]+(?:\s[^<>]*)?(?<!\/)>$/.test(line.trimEnd()) ? ">" : "";
      e.preventDefault();
      if (!opens) return insert("\n" + indent);
      const inner = "\n" + indent + indentUnit();
      const closes = { "{": "}", "[": "]", "(": ")" }[opens];
      if ((closes && next === closes) || (opens === ">" && v.slice(s, s + 2) === "</")) {
        insert(inner + "\n" + indent);
        input.setSelectionRange(s + inner.length, s + inner.length);
      } else insert(inner);
    }
  }

  input.addEventListener("input", () => {
    invalidate();
    onInput?.(input.value);
  });
  input.addEventListener("scroll", sync, { passive: true });
  input.addEventListener("keydown", onKeydown);
  // Ficou visível (aba trocada) ou mudou de tamanho: a área visível pode ter mudado.
  new ResizeObserver(() => {
    if (input.clientHeight) sync();
  }).observe(root);

  render();

  return {
    root,
    input,
    get value() {
      return input.value;
    },
    /** Troca o conteúdo sem disparar onInput. */
    setValue(text) {
      if (input.value !== text) input.value = text;
      invalidate();
    },
    setLang(l) {
      lang = l;
      invalidate();
    },
    /** Marca a linha (1-based) com erro na numeração; null limpa. */
    setErrorLine(n) {
      if (n === errorLine) return;
      errorLine = n;
      invalidate();
    },
    /** { line, col } (1-based) de uma posição do texto, por busca binária no índice de linhas. */
    position(pos) {
      ensureIndex();
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return { line: lo + 1, col: pos - lineStarts[lo] + 1 };
    },
    refresh: invalidate,
  };
}
