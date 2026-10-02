// Formatter JSON: diagnóstico heurístico + pipeline de reparo local (sem dependências).
//
// Etapas, nesta ordem, repetidas a cada camada de "JSON dentro de string":
//   1. texto: caracteres invisíveis, mojibake (UTF-8 lido como Latin-1/CP1252), U+FFFD
//   2. invólucros: bloco ``` , JWT, Base64, URL-encoding, entidades HTML
//   3. lixo antes do JSON (log, `var x =`, JSONP `cb(`)
//   4. escapes sem aspas externas ({\"a\":1}, {\\\"a\\\":1}, \n literais)
//   5. parser tolerante (JSON5/JS/Python/Mongo shell, vírgulas, comentários, truncado...)
//   6. se o resultado for uma string contendo JSON, desce mais uma camada
//
// O parser gera uma AST própria em vez de usar JSON.parse para preservar a ordem
// das chaves (JS reordena chaves numéricas) e a precisão de números grandes.

const MAX_LAYERS = 8;

// AST: { t: "o", e: [[key, node], ...] } | { t: "a", e: [node] } | { t: "s", v } | { t: "n", v: "raw" } | { t: "b", v } | { t: "z" }

// ---------- Diagnóstico ----------

class Steps {
  constructor() {
    this.list = [];
    this.byId = new Map();
  }
  /** kind: "info" (estado detectado) | "fix" (reparo aplicado) | "warn" (atenção). */
  add(id, label, kind = "fix", detail = "") {
    const cur = this.byId.get(id);
    if (cur) {
      cur.count++;
      return;
    }
    const step = { id, label, kind, detail, count: 1 };
    this.byId.set(id, step);
    this.list.push(step);
  }
  has(id) {
    return this.byId.has(id);
  }
}

// ---------- 1. Texto ----------

const INVISIBLE = /[​-‍⁠﻿­]/g;

// Caracteres do Windows-1252 nas posições 0x80–0x9F (o que um "é" vira quando o UTF-8 é lido como CP1252).
const CP1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86],
  [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95],
  [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);
const CONT = `[\\u0080-\\u00BF${[...CP1252.keys()].map((c) => `\\u${c.toString(16).padStart(4, "0")}`).join("")}]`;
// Uma sequência UTF-8 completa (byte líder + continuações) lida como Latin-1/CP1252.
const MOJIBAKE = new RegExp(`[\\u00C2-\\u00DF]${CONT}|[\\u00E0-\\u00EF]${CONT}{2}|[\\u00F0-\\u00F4]${CONT}{3}`, "g");
const utf8Strict = new TextDecoder("utf-8", { fatal: true });

function fixMojibake(s) {
  let fixed = 0;
  // Até 3 passadas: texto que foi "re-encodado" mais de uma vez.
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    s = s.replace(MOJIBAKE, (seq) => {
      const bytes = Uint8Array.from(seq, (ch) => {
        const c = ch.charCodeAt(0);
        return c <= 0xff ? c : CP1252.get(c);
      });
      try {
        const out = utf8Strict.decode(bytes);
        changed = true;
        fixed++;
        return out;
      } catch {
        return seq;
      }
    });
    if (!changed) break;
  }
  return { s, fixed };
}

function cleanText(s, steps) {
  const inv = s.match(INVISIBLE);
  if (inv) {
    s = s.replace(INVISIBLE, "");
    steps.add("invisible", `${inv.length} caractere${inv.length > 1 ? "s" : ""} invisíve${inv.length > 1 ? "is" : "l"} removido${inv.length > 1 ? "s" : ""} (BOM, zero-width)`);
  }
  const moji = fixMojibake(s);
  if (moji.fixed) {
    s = moji.s;
    steps.add("mojibake", `Acentuação corrompida corrigida (${moji.fixed}×, UTF-8 lido como Latin-1)`);
  }
  const lost = s.match(/�/g);
  if (lost) steps.add("replacement", `${lost.length} caractere${lost.length > 1 ? "s" : ""} irrecuperáve${lost.length > 1 ? "is" : "l"} (�) no texto original`, "warn");
  return s;
}

// ---------- 2. Invólucros ----------

function bytesToUtf8(bin) {
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

function base64Decode(b64) {
  let t = b64.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return bytesToUtf8(atob(t));
}

const HTML_ENTITIES = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " " };

function unwrap(s, steps) {
  let t = s.trim();

  const fence = /^```[\w+-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/.exec(t);
  if (fence) {
    steps.add("fence", "Bloco de código ``` removido", "info");
    t = fence[1].trim();
  }

  // JWT: header.payload.assinatura -> { header, payload }
  const jwt = /^(eyJ[\w-]*)\.(eyJ[\w-]*)\.([\w-]*)$/.exec(t);
  if (jwt) {
    try {
      const header = base64Decode(jwt[1]);
      const payload = base64Decode(jwt[2]);
      steps.add("jwt", "Token JWT decodificado (header + payload)", "info");
      return `{"header": ${header}, "payload": ${payload}}`;
    } catch {
      /* não era JWT */
    }
  }

  // Base64 (inclusive url-safe) cujo conteúdo é JSON.
  if (t.length >= 8 && /^[A-Za-z0-9+/_\-\s]+={0,2}$/.test(t) && !/^\d+$/.test(t) && !/^(true|false|null)$/.test(t)) {
    try {
      const dec = base64Decode(t).trim();
      if (/^[[{"]/.test(dec)) {
        steps.add("base64", "Conteúdo Base64 decodificado", "info");
        return dec;
      }
    } catch {
      /* não era Base64 */
    }
  }

  // URL-encoding: %7B%22a%22%3A1%7D
  if (/^(%7B|%5B|%22)/i.test(t) || (/%22/i.test(t) && /%3A/i.test(t) && !t.includes('"'))) {
    let dec = t;
    try {
      dec = decodeURIComponent(dec);
    } catch {
      dec = dec.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
    steps.add("urlencoded", "URL-encoding decodificado (%7B, %22...)", "info");
    t = dec.trim();
  }

  // Entidades HTML: {&quot;a&quot;:1}
  const ent = t.match(/&(quot|#34|#x22);/gi);
  if (ent && ent.length > (t.match(/"/g)?.length || 0)) {
    t = t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, name) => {
      if (name[0] === "#") {
        const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return HTML_ENTITIES[name.toLowerCase()] ?? m;
    });
    steps.add("html", "Entidades HTML decodificadas (&quot; → \")", "info");
  }
  return t;
}

// ---------- 3. Lixo antes do JSON ----------

function cutPrefix(s, steps) {
  const first = s.search(/\S/);
  if (first < 0) return s;
  const c = s[first];
  if (c === "{" || c === "[" || c === '"' || c === "'" || c === "“") return s.slice(first);
  // String escapada sem aspas externas (\"{...}\") e comentários iniciais ficam com o parser.
  if (/^(\\+"|\/[/*])/.test(s.slice(first, first + 3))) return s.slice(first);
  // Primitivo isolado (número, true, null...) é JSON válido.
  if (/^\s*(-?\d[\d.eE+-]*|true|false|null)\s*$/.test(s)) return s;
  // Prefere um "{" / "[" que realmente abre JSON (evita cortar em "[INFO] {...}").
  let brace = -1;
  for (const m of s.matchAll(/[{[]/g)) {
    const ahead = s.slice(m.index, m.index + 200);
    const opens = m[0] === "{" ? /^\{\s*(["'}\\“]|[\w$-]+\s*:|$)/.test(ahead) : /^\[\s*(["'{[\]\d.\\“-]|true|false|null|$)/.test(ahead);
    if (opens) {
      brace = m.index;
      break;
    }
  }
  if (brace < 0) brace = s.search(/[{[]/);
  if (brace < 0) return s;
  const junk = s.slice(first, brace).trim();
  steps.add("prefix", `Texto antes do JSON ignorado: “${junk.length > 28 ? junk.slice(0, 28) + "…" : junk}”`);
  return s.slice(brace);
}

// ---------- 4. Escapes sem aspas externas ----------

function looksEscaped(s) {
  const t = s.trimStart();
  if (/^[[{]\s*(\\[nrt]\s*)*\\+["']/.test(t)) return true;
  // Todas as aspas estão escapadas.
  return t.includes('\\"') && !/(^|[^\\])"/.test(t);
}

const SIMPLE_ESC = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "/": "/", "\\": "\\", '"': '"', "'": "'" };

function unescapeOnce(s) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/gs, (m, e) => {
    if (e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    return SIMPLE_ESC[e] ?? m;
  });
}

// ---------- 5. Parser tolerante ----------

const WORDS = {
  true: true, True: true, TRUE: true, false: false, False: false, FALSE: false,
  null: null, None: null, NULL: null, nil: null, Null: null, undefined: null,
};
const NUM_RE = /[+-]?(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)/y;
const OPEN_QUOTE = { '"': '"', "'": "'", "`": "`", "“": "”", "‘": "’", "”": "”" };
const isWordStart = (c) => /[A-Za-z_$À-￿]/.test(c);

class Parser {
  constructor(src, steps) {
    this.s = src;
    this.i = 0;
    this.steps = steps;
    this.stack = []; // tipos de container abertos ("o" | "a"), para fechar colchetes trocados
    this.depth = 0;
  }

  get eof() {
    return this.i >= this.s.length;
  }

  fix(id, label, kind = "fix") {
    this.steps.add(id, label, kind);
  }

  /** Pula espaços, comentários, \n literais e caracteres de controle soltos. */
  ws() {
    const s = this.s;
    while (this.i < s.length) {
      const c = s.charCodeAt(this.i);
      if (c === 32 || c === 10 || c === 13 || c === 9) {
        this.i++;
      } else if (c === 0xa0 || c === 0x2028 || c === 0x2029 || c === 0x3000 || (c >= 0x2000 && c <= 0x200a)) {
        this.i++;
        this.fix("nbsp", "Espaços especiais (NBSP) normalizados");
      } else if (c < 32 || c === 0x7f) {
        this.i++;
        this.fix("ctrl", "Caracteres de controle fora de strings removidos");
      } else if (c === 47 && s[this.i + 1] === "/") {
        const end = s.indexOf("\n", this.i);
        this.i = end < 0 ? s.length : end + 1;
        this.fix("comments", "Comentários removidos");
      } else if (c === 47 && s[this.i + 1] === "*") {
        const end = s.indexOf("*/", this.i + 2);
        this.i = end < 0 ? s.length : end + 2;
        this.fix("comments", "Comentários removidos");
      } else if (c === 35) {
        // "#" comentário estilo Python/YAML
        const end = s.indexOf("\n", this.i);
        this.i = end < 0 ? s.length : end + 1;
        this.fix("comments", "Comentários removidos");
      } else if (c === 92) {
        // "\n", "\t" literais entre tokens (JSON formatado e depois escapado)
        const n = s[this.i + 1];
        this.i += n === "n" || n === "r" || n === "t" ? 2 : 1;
        this.fix("literal-ws", "Quebras de linha escapadas (\\n literais) removidas");
      } else {
        break;
      }
    }
  }

  parseTop() {
    this.ws();
    if (this.eof) return null;
    const values = [this.value()];
    for (;;) {
      this.ws();
      if (this.eof) break;
      const c = this.s[this.i];
      if (c === "," || c === ";") {
        this.i++;
        continue;
      }
      if (c === "{" || c === "[") {
        values.push(this.value());
        continue;
      }
      const rest = this.s.slice(this.i).trim();
      this.fix("suffix", `Texto após o JSON ignorado: “${rest.length > 28 ? rest.slice(0, 28) + "…" : rest}”`);
      break;
    }
    if (values.length > 1) {
      this.fix("ndjson", `${values.length} documentos (JSON Lines / concatenados) agrupados em um array`, "info");
      return { t: "a", e: values };
    }
    return values[0];
  }

  value() {
    this.ws();
    if (this.eof) {
      this.fix("truncated", "JSON truncado: estruturas abertas foram fechadas", "warn");
      return { t: "z" };
    }
    const c = this.s[this.i];
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (OPEN_QUOTE[c]) return { t: "s", v: this.string() };
    if (c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9")) return this.number();
    if (isWordStart(c)) return this.word();
    // Algo que não inicia um valor: vira string até o próximo delimitador.
    return this.bare();
  }

  object() {
    this.i++;
    this.stack.push("o");
    if (++this.depth > 5000) throw new Error("Aninhamento profundo demais");
    const entries = [];
    const index = new Map();
    let needComma = false;
    for (;;) {
      this.ws();
      if (this.eof) {
        this.fix("truncated", "JSON truncado: estruturas abertas foram fechadas", "warn");
        break;
      }
      const c = this.s[this.i];
      if (c === "}") {
        this.i++;
        break;
      }
      if (c === "]") {
        if (this.stack.lastIndexOf("a") >= 0) {
          this.fix("brackets", "Chaves/colchetes desbalanceados corrigidos");
          break; // pertence ao array pai: fecha este objeto sem consumir
        }
        this.i++;
        this.fix("brackets", "Chaves/colchetes desbalanceados corrigidos");
        break;
      }
      if (c === ",") {
        this.i++;
        if (!needComma) this.fix("commas", "Vírgulas extras removidas");
        needComma = false;
        continue;
      }
      if (needComma) this.fix("missing-comma", "Vírgulas ausentes inseridas");

      const key = this.key();
      if (key === null) continue;
      this.ws();
      const sep = this.s[this.i];
      if (sep === ":") this.i++;
      else if (sep === "=") {
        this.i += this.s[this.i + 1] === ">" ? 2 : 1;
        this.fix("assign", "“=” / “=>” convertidos em “:”");
      } else this.fix("colon", "Dois-pontos ausentes inseridos");

      this.ws();
      let val;
      const n = this.s[this.i];
      if (this.eof) {
        this.fix("truncated", "JSON truncado: estruturas abertas foram fechadas", "warn");
        val = { t: "z" };
      } else if (n === "," || n === "}") {
        this.fix("missing-value", "Valores ausentes preenchidos com null");
        val = { t: "z" };
      } else val = this.value();

      if (index.has(key)) {
        entries[index.get(key)][1] = val;
        this.fix("dup-keys", "Chaves duplicadas (mantido o último valor)", "warn");
      } else {
        index.set(key, entries.length);
        entries.push([key, val]);
      }
      needComma = true;
    }
    this.stack.pop();
    this.depth--;
    return { t: "o", e: entries };
  }

  key() {
    const c = this.s[this.i];
    if (OPEN_QUOTE[c]) {
      if (c !== '"') this.fix(c === "'" ? "single-quotes" : "smart-quotes", c === "'" ? "Aspas simples convertidas" : "Aspas tipográficas (“ ”) convertidas");
      return this.string();
    }
    // Chave sem aspas (JS/JSON5/YAML-ish)
    const m = /[^\s:=,{}[\]"'“”]+/y;
    m.lastIndex = this.i;
    const r = m.exec(this.s);
    if (!r) {
      this.i++;
      this.fix("unexpected", "Caracteres inesperados ignorados");
      return null;
    }
    this.i += r[0].length;
    this.fix("unquoted-keys", "Chaves sem aspas corrigidas");
    return r[0];
  }

  array() {
    this.i++;
    this.stack.push("a");
    if (++this.depth > 5000) throw new Error("Aninhamento profundo demais");
    const items = [];
    let needComma = false;
    for (;;) {
      this.ws();
      if (this.eof) {
        this.fix("truncated", "JSON truncado: estruturas abertas foram fechadas", "warn");
        break;
      }
      const c = this.s[this.i];
      if (c === "]") {
        this.i++;
        break;
      }
      if (c === "}") {
        if (this.stack.lastIndexOf("o") >= 0) {
          this.fix("brackets", "Chaves/colchetes desbalanceados corrigidos");
          break; // pertence ao objeto pai
        }
        this.i++;
        this.fix("brackets", "Chaves/colchetes desbalanceados corrigidos");
        break;
      }
      if (c === ",") {
        this.i++;
        if (!needComma) this.fix("commas", "Vírgulas extras removidas");
        needComma = false;
        continue;
      }
      if (c === ":") {
        this.i++;
        this.fix("unexpected", "Caracteres inesperados ignorados");
        continue;
      }
      if (needComma) this.fix("missing-comma", "Vírgulas ausentes inseridas");
      items.push(this.value());
      needComma = true;
    }
    this.stack.pop();
    this.depth--;
    return { t: "a", e: items };
  }

  string() {
    const s = this.s;
    const open = s[this.i];
    const close = OPEN_QUOTE[open];
    if (open === "'") this.fix("single-quotes", "Aspas simples convertidas");
    else if (open === "`") this.fix("backticks", "Template strings (`) convertidas");
    else if (open !== '"') this.fix("smart-quotes", "Aspas tipográficas (“ ”) convertidas");
    this.i++;
    let out = "";
    let start = this.i;
    while (this.i < s.length) {
      const ch = s[this.i];
      if (ch === "\\") {
        out += s.slice(start, this.i);
        out += this.escape();
        start = this.i;
        continue;
      }
      if (ch === close || (close === "”" && ch === '"')) {
        // Aspas internas não escapadas: "ele disse "oi" ali" — só fecha se vier um delimitador.
        if (close === '"' && this.innerQuote()) {
          this.i++;
          continue;
        }
        out += s.slice(start, this.i);
        this.i++;
        return out;
      }
      const code = ch.charCodeAt(0);
      if (code < 32) {
        if (code === 10 || code === 13) this.fix("raw-newlines", "Quebras de linha cruas dentro de strings escapadas");
        else this.fix("raw-ctrl", "Caracteres de controle dentro de strings escapados");
      }
      this.i++;
    }
    this.fix("truncated", "JSON truncado: estruturas abertas foram fechadas", "warn");
    return out + s.slice(start);
  }

  /** Na aspa em this.i: true se ela é conteúdo (seguida de letra/dígito na mesma linha). */
  innerQuote() {
    const s = this.s;
    let j = this.i + 1;
    while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
    if (j >= s.length) return false;
    const n = s[j];
    if (/[,:}\]\r\n]/.test(n) || n === "\\" || OPEN_QUOTE[n] || n === "/" || n === "#") return false;
    if (/[\p{L}\p{N}_({<.!?-]/u.test(n)) {
      this.fix("inner-quotes", "Aspas internas não escapadas corrigidas");
      return true;
    }
    return false;
  }

  escape() {
    const s = this.s;
    const e = s[this.i + 1];
    this.i += 2;
    if (e === undefined) return "\\";
    if (e in SIMPLE_ESC) return SIMPLE_ESC[e];
    if (e === "u") {
      if (s[this.i] === "{") {
        const end = s.indexOf("}", this.i);
        const cp = parseInt(s.slice(this.i + 1, end), 16);
        if (end > 0 && Number.isFinite(cp) && cp <= 0x10ffff) {
          this.i = end + 1;
          this.fix("escapes", "Escapes inválidos em strings corrigidos");
          return String.fromCodePoint(cp);
        }
      }
      const hex = s.slice(this.i, this.i + 4);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        this.i += 4;
        return String.fromCharCode(parseInt(hex, 16));
      }
      this.fix("escapes", "Escapes inválidos em strings corrigidos");
      return "\\u";
    }
    if (e === "x" && /^[0-9a-fA-F]{2}$/.test(s.slice(this.i, this.i + 2))) {
      this.i += 2;
      this.fix("escapes", "Escapes inválidos em strings corrigidos");
      return String.fromCharCode(parseInt(s.slice(this.i - 2, this.i), 16));
    }
    if (e === "\n" || e === "\r") {
      if (e === "\r" && s[this.i] === "\n") this.i++;
      this.fix("escapes", "Escapes inválidos em strings corrigidos");
      return "";
    }
    this.fix("escapes", "Escapes inválidos em strings corrigidos");
    if (e === "v") return "\v";
    if (e === "0") return "\0";
    if (e === "a") return "\x07";
    return e; // \' \$ \. etc.
  }

  number() {
    const s = this.s;
    const start = this.i;
    NUM_RE.lastIndex = start;
    const m = NUM_RE.exec(s);
    const next = m ? s[start + m[0].length] : undefined;
    // "Infinity", "-Infinity", "+NaN"
    if ((!m || m[0] === "-" || m[0] === "+") && /^[+-]?(Infinity|NaN)/.test(s.slice(start, start + 10))) {
      this.i += /^[+-]?(Infinity|NaN)/.exec(s.slice(start))[0].length;
      this.fix("nan", "NaN/Infinity convertidos em null");
      return { t: "z" };
    }
    if (!m || m[0] === "-" || m[0] === "+" || m[0] === "." || (next !== undefined && !/[\s,}\]/#\\;)]/.test(next))) {
      // Ex.: 2024-01-01, 12px, 1.2.3, 10:30 → string sem aspas
      return this.bare();
    }
    this.i += m[0].length;
    let raw = m[0].replace(/_/g, "");
    let sign = "";
    if (raw[0] === "+" || raw[0] === "-") {
      sign = raw[0] === "-" ? "-" : "";
      if (raw[0] === "+") this.fix("numbers", "Números fora do padrão normalizados (+1, .5, 0x1F, 007)");
      raw = raw.slice(1);
    }
    if (/^0[xXbBoO]/.test(raw)) {
      this.fix("numbers", "Números fora do padrão normalizados (+1, .5, 0x1F, 007)");
      try {
        return { t: "n", v: sign + BigInt(raw).toString() };
      } catch {
        return { t: "s", v: sign + raw };
      }
    }
    let norm = raw;
    if (norm.startsWith(".")) norm = "0" + norm;
    norm = norm.replace(/\.(?=$|[eE])/, "");
    norm = norm.replace(/^0+(?=\d)/, "");
    if (norm !== raw) this.fix("numbers", "Números fora do padrão normalizados (+1, .5, 0x1F, 007)");
    return { t: "n", v: sign + norm };
  }

  word() {
    const s = this.s;
    const m = /[A-Za-z_$][\w$]*/y;
    m.lastIndex = this.i;
    const r = m.exec(s);
    if (!r) return this.bare();
    const w = r[0];
    const after = s[this.i + w.length];

    // Prefixos de string Python: u'..', b'..', r"..", f"..."
    if (/^[ubrfUBRF]{1,2}$/.test(w) && (after === "'" || after === '"')) {
      this.i += w.length;
      this.fix("python", "Sintaxe Python convertida (True/False/None, u'', b'')");
      return { t: "s", v: this.string() };
    }
    // Chamadas tipo Mongo shell / JS: ObjectId("..."), ISODate("..."), NumberLong(5), new Date(...)
    if (w === "new") {
      this.i += 3;
      this.ws();
      return this.word();
    }
    const j = this.i + w.length;
    if (s[j] === "(") {
      this.i = j + 1;
      this.ws();
      let inner = { t: "z" };
      if (s[this.i] !== ")") inner = this.value();
      // Ignora argumentos extras até o ")".
      let depth = 0;
      while (this.i < s.length) {
        const ch = s[this.i++];
        if (ch === "(") depth++;
        else if (ch === ")") {
          if (depth-- === 0) break;
        }
      }
      this.fix("calls", `Chamadas de função convertidas (${w}(...) → valor)`);
      return inner;
    }

    if (w in WORDS && !/[\w$-]/.test(after || "")) {
      this.i += w.length;
      const v = WORDS[w];
      if (w !== "true" && w !== "false" && w !== "null") {
        if (/^(True|False|None)$/.test(w)) this.fix("python", "Sintaxe Python convertida (True/False/None, u'', b'')");
        else if (w === "undefined") this.fix("undefined", "undefined convertido em null");
        else this.fix("literals", "Literais fora do padrão normalizados (TRUE, nil, NULL)");
      }
      return v === null ? { t: "z" } : { t: "b", v };
    }
    if ((w === "NaN" || w === "Infinity") && !/[\w$]/.test(after || "")) {
      this.i += w.length;
      this.fix("nan", "NaN/Infinity convertidos em null");
      return { t: "z" };
    }
    return this.bare();
  }

  /** String sem aspas: lê até , } ] ou fim da linha. */
  bare() {
    const s = this.s;
    const start = this.i;
    let depthP = 0;
    while (this.i < s.length) {
      const ch = s[this.i];
      if (ch === "(") depthP++;
      else if (ch === ")") {
        if (depthP === 0) break;
        depthP--;
      } else if (depthP === 0 && (ch === "," || ch === "}" || ch === "]" || ch === "\n" || ch === "\r")) break;
      this.i++;
    }
    if (this.i === start) {
      // Nada consumível (ex.: ")" solto): pula para não travar.
      this.i++;
      this.fix("unexpected", "Caracteres inesperados ignorados");
      return { t: "z" };
    }
    this.fix("unquoted-values", "Valores sem aspas convertidos em strings");
    return { t: "s", v: s.slice(start, this.i).trim() };
  }
}

// ---------- AST ----------

/** Conteúdo de uma string que é, ele próprio, JSON serializado (uma camada a mais). */
function looksLikeJsonText(v) {
  const t = v.trim();
  return (
    /^[[{][\s\S]*[\]}]$/.test(t) ||
    /^[[{]\s*(\\*["'[{\]}]|$)/.test(t) ||
    (/^"\s*(\\*"|[[{])/.test(t) && t.endsWith('"'))
  );
}

/** AST do conteúdo de uma string quando ele é um objeto/array JSON válido (sem reparos). */
function nestedJson(v) {
  if (v.length < 2 || !/^\s*[[{]/.test(v) || !/[\]}]\s*$/.test(v)) return null;
  const sub = new Steps();
  try {
    const parsed = new Parser(v, sub).parseTop();
    const clean = sub.list.every((st) => st.kind === "info" || st.id === "nbsp");
    return parsed && (parsed.t === "o" || parsed.t === "a") && clean ? parsed : null;
  } catch {
    return null;
  }
}

/** Strings cujo conteúdo é JSON válido viram objetos (opcional). */
function expandNested(node, steps) {
  if (node.t === "o") node.e.forEach((pair) => (pair[1] = expandNested(pair[1], steps)));
  else if (node.t === "a") node.e = node.e.map((n) => expandNested(n, steps));
  else if (node.t === "s") {
    const parsed = nestedJson(node.v);
    if (parsed) {
      steps.add("nested", "Strings com JSON dentro foram expandidas", "info");
      return expandNested(parsed, steps);
    }
  }
  return node;
}

function countNested(node) {
  let n = 0;
  const walk = (x) => {
    if (x.t === "o") x.e.forEach((p) => walk(p[1]));
    else if (x.t === "a") x.e.forEach(walk);
    else if (x.t === "s" && nestedJson(x.v)) n++;
  };
  walk(node);
  return n;
}

const keyCompare = new Intl.Collator("en", { numeric: true }).compare;

/** Serializa a AST. indent = "" gera a versão minificada. */
export function serialize(node, indent = "  ", sortKeys = false) {
  const pretty = indent !== "";
  const colon = pretty ? ": " : ":";
  const nl = []; // "\n" + recuo de cada nível, em cache
  const lineAt = (d) => nl[d] ?? (nl[d] = pretty ? "\n" + indent.repeat(d) : "");
  const write = (n, d) => {
    switch (n.t) {
      case "o": {
        const len = n.e.length;
        if (!len) return "{}";
        const entries = sortKeys ? [...n.e].sort((a, b) => keyCompare(a[0], b[0])) : n.e;
        const inner = lineAt(d + 1);
        let out = "{";
        for (let i = 0; i < len; i++) {
          const pair = entries[i];
          out += (i ? "," : "") + inner + JSON.stringify(pair[0]) + colon + write(pair[1], d + 1);
        }
        return out + lineAt(d) + "}";
      }
      case "a": {
        const len = n.e.length;
        if (!len) return "[]";
        const inner = lineAt(d + 1);
        let out = "[";
        for (let i = 0; i < len; i++) out += (i ? "," : "") + inner + write(n.e[i], d + 1);
        return out + lineAt(d) + "]";
      }
      case "s":
        return JSON.stringify(n.v);
      case "n":
        return n.v;
      case "b":
        return n.v ? "true" : "false";
      default:
        return "null";
    }
  };
  return write(node, 0);
}

function stats(node) {
  let keys = 0;
  let values = 0;
  let maxDepth = 0;
  const walk = (n, d) => {
    values++;
    if (d > maxDepth) maxDepth = d;
    if (n.t === "o") {
      keys += n.e.length;
      n.e.forEach((p) => walk(p[1], d + 1));
    } else if (n.t === "a") n.e.forEach((x) => walk(x, d + 1));
  };
  walk(node, 0);
  return { keys, values, depth: maxDepth, root: node.t === "o" ? "objeto" : node.t === "a" ? "array" : "valor" };
}

// ---------- Pipeline ----------

/**
 * Diagnostica e repara `input`, devolvendo a AST e os passos aplicados.
 * Retorna { ok, ast, steps, layers, error? }.
 */
export function analyzeJson(input, { expand = false } = {}) {
  const steps = new Steps();
  if (!input || !input.trim()) return { ok: false, steps: steps.list, error: "Cole um JSON no campo acima." };

  let s = input;
  let layers = 0;
  let ast = null;
  const original = input.trim();

  for (let layer = 0; layer <= MAX_LAYERS; layer++) {
    s = cleanText(s, steps);
    s = unwrap(s, steps);
    s = cutPrefix(s, steps);

    let unesc = 0;
    while (unesc < MAX_LAYERS && looksEscaped(s)) {
      s = unescapeOnce(s);
      unesc++;
    }
    if (unesc) layers += unesc;

    try {
      ast = new Parser(s, steps).parseTop();
    } catch (e) {
      return { ok: false, steps: steps.list, error: e.message || String(e) };
    }
    if (!ast) return { ok: false, steps: steps.list, error: "Nenhum conteúdo JSON encontrado." };

    // String cujo conteúdo é JSON: desce mais uma camada.
    if (ast.t === "s" && looksLikeJsonText(ast.v)) {
      layers++;
      s = ast.v;
      continue;
    }
    break;
  }

  if (ast.t === "s" && /^\s*[^"'“]/.test(original) && steps.has("unquoted-values")) {
    return { ok: false, steps: steps.list.filter((st) => st.id !== "unquoted-values"), error: "Nenhum objeto ou array JSON encontrado no texto." };
  }

  if (layers) {
    steps.list.unshift({ id: "escaped", label: layers > 1 ? `JSON escapado em ${layers} camadas (string dentro de string)` : "JSON escapado / serializado como string", kind: "info", count: 1 });
  }

  if (expand) ast = expandNested(ast, steps);
  else {
    const nested = countNested(ast);
    if (nested) steps.add("nested-hint", `${nested} string${nested > 1 ? "s contêm" : " contém"} JSON — ative “Expandir JSON em strings”`, "warn");
  }

  return { ok: true, ast, steps: steps.list, layers };
}

/** Rótulo curto do estado em que o texto chegou. */
export function describeInput(input, result) {
  if (!result.ok) return { label: "Inválido", tone: "bad" };
  const fixes = result.steps.filter((s) => s.kind === "fix" || s.kind === "warn").length;
  if (result.layers) return { label: fixes ? "Escapado + reparado" : "Escapado", tone: fixes ? "warn" : "info" };
  if (fixes) return { label: "Reparado", tone: "warn" };
  if (result.steps.some((s) => s.kind === "info")) return { label: "Decodificado", tone: "info" };
  const t = input.trim();
  if (!/\n/.test(t) && t.length > 2) return { label: "Válido · minificado", tone: "ok" };
  return { label: "Válido", tone: "ok" };
}

export function formatJson(input, { indent = "  ", sortKeys = false, expand = false } = {}) {
  const result = analyzeJson(input, { expand });
  if (!result.ok) return { ...result, state: describeInput(input, result) };
  let minified = null;
  return {
    ...result,
    state: describeInput(input, result),
    pretty: serialize(result.ast, indent, sortKeys),
    // Só é gerado quando alguém pede (copiar minificado).
    get minified() {
      return (minified ??= serialize(result.ast, "", sortKeys));
    },
    stats: stats(result.ast),
  };
}
