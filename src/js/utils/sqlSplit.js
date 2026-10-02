// Divisão de scripts SQL (T-SQL) em lotes (GO) e comandos, ignorando strings, comentários
// e identificadores delimitados. Usado pelo console: Ctrl+Enter executa o comando sob o cursor.

const STATEMENT_START = new Set([
  "SELECT", "WITH", "INSERT", "UPDATE", "DELETE", "MERGE", "EXEC", "EXECUTE", "CREATE", "ALTER", "DROP",
  "DECLARE", "SET", "TRUNCATE", "USE", "PRINT", "IF", "WHILE", "GRANT", "REVOKE", "DENY", "BEGIN",
  "COMMIT", "ROLLBACK", "SAVE", "RAISERROR", "THROW", "DBCC", "BACKUP", "RESTORE", "OPEN", "FETCH",
  "CLOSE", "DEALLOCATE", "WAITFOR", "RETURN", "BULK", "CHECKPOINT", "KILL", "SHUTDOWN", "UPDATE",
]);

/** Corpo inteiro até o próximo GO (não dá para dividir por ";"). */
const MODULE_KINDS = new Set(["PROC", "PROCEDURE", "FUNCTION", "TRIGGER", "VIEW"]);

const isWordChar = (c) => /[\p{L}\p{N}_@#$]/u.test(c);

/**
 * Percorre o texto e devolve os tokens relevantes para a divisão:
 * palavras (fora de strings/comentários), ";" , "(" , ")", linhas GO e linhas em branco.
 */
function scan(text) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  let lineStart = true; // só espaços desde o início da linha
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "\n") {
      // Linha em branco: \n seguido de espaços e outro \n.
      let j = i + 1;
      while (j < n && (text[j] === " " || text[j] === "\t" || text[j] === "\r")) j++;
      if (text[j] === "\n") tokens.push({ t: "blank", pos: i });
      lineStart = true;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "-" && next === "-") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth) {
        if (text[i] === "/" && text[i + 1] === "*") (depth++, (i += 2));
        else if (text[i] === "*" && text[i + 1] === "/") (depth--, (i += 2));
        else i++;
      }
      lineStart = false;
      continue;
    }
    if (lineStart && (c === "G" || c === "g") && (next === "O" || next === "o")) {
      const m = /^GO(?:[ \t]+(\d+))?[ \t]*(?:--[^\n]*)?(?=\r?\n|$)/i.exec(text.slice(i, i + 64));
      if (m) {
        const end = text.indexOf("\n", i);
        tokens.push({ t: "go", pos: i, end: end === -1 ? n : end, repeat: m[1] ? Number(m[1]) : 1 });
        i = end === -1 ? n : end;
        continue;
      }
    }
    lineStart = false;
    if (c === "'" || c === '"' || c === "[") {
      const close = c === "[" ? "]" : c;
      const start = i;
      i++;
      while (i < n) {
        if (text[i] === close) {
          if (text[i + 1] === close) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      tokens.push({ t: "lit", pos: start });
      continue;
    }
    if (c === "N" && next === "'") {
      i++;
      continue;
    }
    if (isWordChar(c)) {
      const start = i;
      while (i < n && isWordChar(text[i])) i++;
      tokens.push({ t: "word", pos: start, w: text.slice(start, i).toUpperCase() });
      continue;
    }
    if (c === ";" || c === "(" || c === ")") tokens.push({ t: c, pos: i });
    i++;
  }
  return tokens;
}

/** Lotes separados por linhas "GO [n]". */
export function splitBatches(text) {
  const out = [];
  let start = 0;
  for (const tk of scan(text)) {
    if (tk.t !== "go") continue;
    pushRange(out, text, start, tk.pos, tk.repeat);
    start = tk.end;
  }
  pushRange(out, text, start, text.length, 1);
  return out;
}

function pushRange(out, text, start, end, repeat = 1) {
  const raw = text.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  const sql = raw.trim();
  if (!sql || isOnlyComments(sql)) return;
  out.push({ sql: stripTrailingSemicolon(sql), start: start + lead, end: start + lead + sql.length, repeat });
}

function isOnlyComments(sql) {
  return !scan(sql).some((t) => t.t === "word" || t.t === "lit" || t.t === "(");
}

function stripTrailingSemicolon(sql) {
  return sql.replace(/;\s*$/, "");
}

/**
 * Comandos do script: separados por ";", GO e (fora de blocos/parênteses) por linha em branco
 * seguida de uma palavra que inicia comando. Corpos de CREATE PROC/FUNCTION/TRIGGER/VIEW
 * ficam inteiros até o GO.
 */
export function splitStatements(text) {
  const tokens = scan(text);
  const out = [];
  let start = 0;
  let depth = 0; // BEGIN/CASE ... END
  let parens = 0;
  let words = []; // primeiras palavras do comando atual
  let moduleBody = false;
  let pendingBlank = false;

  const cut = (end, next) => {
    pushRange(out, text, start, end);
    start = next;
    depth = 0;
    parens = 0;
    words = [];
    moduleBody = false;
    pendingBlank = false;
  };

  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t === "go") {
      cut(tk.pos, tk.end);
      continue;
    }
    if (tk.t === "blank") {
      if (depth === 0 && parens === 0 && !moduleBody && words.length) pendingBlank = true;
      continue;
    }
    if (tk.t === "word" && pendingBlank && STATEMENT_START.has(tk.w) && !continuesStatement(words, tk.w)) {
      cut(tk.pos, tk.pos);
    }
    pendingBlank = false;
    if (tk.t === "(") parens++;
    else if (tk.t === ")") parens = Math.max(0, parens - 1);
    else if (tk.t === ";") {
      if (depth === 0 && parens === 0 && !moduleBody) cut(tk.pos + 1, tk.pos + 1);
    } else if (tk.t === "word") {
      if (words.length < 4) {
        words.push(tk.w);
        if (isModuleHeader(words)) moduleBody = true;
      }
      if (tk.w === "CASE") depth++;
      else if (tk.w === "BEGIN") {
        const nx = tokens[k + 1]?.w;
        if (nx !== "TRAN" && nx !== "TRANSACTION" && nx !== "DISTRIBUTED" && nx !== "DIALOG" && nx !== "CONVERSATION") depth++;
      } else if (tk.w === "END") {
        const nx = tokens[k + 1]?.w;
        if (nx !== "CONVERSATION") depth = Math.max(0, depth - 1);
      }
    }
  }
  pushRange(out, text, start, text.length);
  return out;
}

/** Palavras que, depois de linha em branco, ainda fazem parte do comando anterior. */
function continuesStatement(words, w) {
  const first = words[0];
  if (w === "SELECT" && (first === "INSERT" || first === "WITH" || words.includes("AS"))) return true;
  if ((w === "UPDATE" || w === "DELETE" || w === "INSERT" || w === "MERGE") && first === "WITH") return true;
  return false;
}

function isModuleHeader(words) {
  let i = 0;
  if (words[i] !== "CREATE" && words[i] !== "ALTER") return false;
  i++;
  if (words[i] === "OR") i += 2; // CREATE OR ALTER
  return MODULE_KINDS.has(words[i]);
}

/** Comando que contém a posição `pos` (ou o mais próximo antes dela na mesma região). */
export function statementAt(text, pos) {
  const list = splitStatements(text);
  if (!list.length) return null;
  let best = null;
  for (const s of list) {
    if (pos >= s.start && pos <= s.end) return s;
    if (s.end <= pos) best = s;
  }
  // Cursor depois do último comando (na mesma linha ou em branco logo abaixo): usa o anterior.
  if (best) {
    const gap = text.slice(best.end, pos);
    if (!/\n\s*\n/.test(gap)) return best;
  }
  return list.find((s) => s.start >= pos) || best;
}

/** Primeira palavra do comando (fora de comentários). */
export function firstKeyword(sql) {
  return scan(sql).find((t) => t.t === "word")?.w || "";
}

/** Comando de leitura (pode ser reexecutado para buscar mais linhas sem efeitos colaterais). */
export function isReadOnlyQuery(sql) {
  const words = scan(sql).filter((t) => t.t === "word").map((t) => t.w);
  if (!words.length || !["SELECT", "WITH"].includes(words[0])) return false;
  return !words.some((w) => ["INSERT", "UPDATE", "DELETE", "MERGE", "INTO", "EXEC", "EXECUTE", "DROP", "ALTER", "CREATE", "TRUNCATE"].includes(w));
}

/** Comando que altera dados ou estrutura (pede confirmação em conexões somente leitura). */
export function isWriteStatement(sql) {
  const words = scan(sql).filter((t) => t.t === "word").map((t) => t.w);
  return words.some((w) => ["INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "ALTER", "CREATE", "TRUNCATE", "EXEC", "EXECUTE", "GRANT", "REVOKE", "DENY"].includes(w));
}
