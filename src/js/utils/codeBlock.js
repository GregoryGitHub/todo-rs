// Blocos de código das Notas: regiões dobráveis, divisão do HTML realçado em linhas e
// detecção da linguagem ao criar um bloco (sem DOM; testado em tests/code-block.test.mjs).

// Linguagens dobradas pelo recuo; as demais, por { } [ ] ( ).
const INDENT_LANGS = new Set(["text", "python", "yaml", "sql", "xml", "html", "markdown", "mermaid", "bash", "diff"]);
const PAIRS = { "{": "}", "[": "]", "(": ")" };
const CLOSERS = new Set(Object.values(PAIRS));

const indentOf = (line) => {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n++;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
};

function bracketRegions(lines, out) {
  const stack = [];
  let quote = null; // ", ' ou ` aberto
  let block = false; // dentro de /* */
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (quote !== "`") quote = null; // só template strings atravessam linhas
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (block) {
        if (ch === "*" && line[c + 1] === "/") (block = false), c++;
        continue;
      }
      if (quote) {
        if (ch === "\\") c++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "/" && line[c + 1] === "/") break;
      if (ch === "/" && line[c + 1] === "*") {
        block = true;
        c++;
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (PAIRS[ch]) stack.push({ ch, line: i });
      else if (CLOSERS.has(ch)) {
        let k = stack.length - 1;
        while (k >= 0 && PAIRS[stack[k].ch] !== ch) k--;
        if (k < 0) continue;
        const open = stack[k];
        stack.length = k;
        if (open.line === i) continue;
        // A linha do fechamento continua visível quando começa por ele (estilo VS Code).
        const end = line.slice(0, c).trim() ? i : i - 1;
        if (end > open.line && !(out.get(open.line) >= end)) out.set(open.line, end);
      }
    }
  }
}

function indentRegions(lines, out) {
  const blank = (i) => !lines[i].trim();
  for (let i = 0; i < lines.length; i++) {
    if (blank(i)) continue;
    const ind = indentOf(lines[i]);
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (blank(j)) continue;
      if (indentOf(lines[j]) <= ind) break;
      end = j;
    }
    if (end > i) out.set(i, end);
  }
}

/** Regiões dobráveis: Map(linha inicial → última linha escondida), 0-based. */
export function foldRegions(lines, lang) {
  const out = new Map();
  if (INDENT_LANGS.has(lang) || lang === "text") indentRegions(lines, out);
  else bracketRegions(lines, out);
  return out;
}

/**
 * Divide o HTML de highlightCode() em linhas, fechando e reabrindo os <span> que
 * atravessam quebras (comentários e strings de várias linhas).
 */
export function splitHighlightedLines(html) {
  const lines = [];
  const open = [];
  let cur = "";
  for (const [t] of html.matchAll(/<span[^>]*>|<\/span>|\n|[^<\n]+/g)) {
    if (t === "\n") {
      lines.push(cur + "</span>".repeat(open.length));
      cur = open.join("");
    } else if (t.startsWith("<span")) {
      open.push(t);
      cur += t;
    } else if (t === "</span>") {
      open.pop();
      cur += t;
    } else cur += t;
  }
  lines.push(cur + "</span>".repeat(open.length));
  return lines;
}

const MERMAID_START =
  /^(?:%%[^\n]*\n\s*)*(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|sankey-beta|xychart-beta|block-beta|architecture-beta|kanban)\b/;

/** Linguagem provável de um texto colado/convertido em bloco; null se não der para dizer. */
export function guessCodeLang(text) {
  const t = text.trim();
  if (!t) return null;
  if (MERMAID_START.test(t)) return "mermaid";
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      /* segue */
    }
  }
  if (/^(?:select|insert|update|delete|with|create|alter|declare|exec|merge)\b/i.test(t)) return "sql";
  if (/^<!doctype html|^<html[\s>]/i.test(t)) return "html";
  if (/^<\??[\w:-]+[\s>]/.test(t)) return "xml";
  if (/^(?:diff --git|--- \S)/.test(t)) return "diff";
  if (/^(?:import |export |const |let |function |async function |class \w+ (?:extends|\{))/.test(t)) return "javascript";
  if (/^(?:def |from \w+ import |import \w+$)/m.test(t) && !/[;{}]\s*$/m.test(t)) return "python";
  if (/^#!.*\b(?:ba)?sh\b/.test(t)) return "bash";
  if (/^[.#:@]?[\w-][^{}\n;=()]*\{[^{}]*:[^{}]*;[^{}]*\}/.test(t)) return "css";
  return null;
}
