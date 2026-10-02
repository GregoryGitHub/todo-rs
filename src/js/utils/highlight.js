// Realce de sintaxe leve (regex, sem dependências) para JSON, JavaScript, XML/HTML, GraphQL e SQL.
// Gera HTML com <span class="tok-*">; as cores vêm das variáveis --syn-* de theme.css.
// Com `vars`, trechos {{nome}} viram <span class="hx-var known|unknown"> (variáveis do cliente HTTP).

import { escapeHtml } from "./noteContent.js";

const VAR = String.raw`\{\{[^{}\n]*\}\}`;
const VAR_SPLIT = new RegExp(`(${VAR})`);

/** Escapa um trecho e realça as {{variáveis}} dentro dele. */
function textWithVars(s, opts) {
  if (!opts.vars || !s.includes("{{")) return escapeHtml(s);
  return s
    .split(VAR_SPLIT)
    .map((part, i) => (i % 2 ? varSpan(part, opts) : escapeHtml(part)))
    .join("");
}

function varSpan(token, opts) {
  const state = opts.varState?.(token.slice(2, -2).trim());
  return `<span class="hx-var${state ? ` ${state}` : ""}">${escapeHtml(token)}</span>`;
}

const tok = (cls, s, opts) => `<span class="tok-${cls}">${textWithVars(s, opts)}</span>`;

/** Percorre `text` com uma regex global; `paint(match)` devolve o HTML de cada token. */
function run(text, re, paint, opts) {
  let out = "";
  let last = 0;
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out += textWithVars(text.slice(last, m.index), opts);
    out += paint(m);
    last = m.index + m[0].length;
  }
  return out + textWithVars(text.slice(last), opts);
}

// ---------- JSON ----------

const JSON_RE = new RegExp(
  String.raw`(${VAR})|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)(\s*:)?|(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|\b(true|false)\b|\b(null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([{}[\],:])`,
  "g",
);

function json(text, opts) {
  return run(text, JSON_RE, (m) => {
    if (m[1]) return varSpan(m[1], opts);
    if (m[2]) return m[3] ? tok("key", m[2], opts) + escapeHtml(m[3]) : tok("str", m[2], opts);
    if (m[4]) return tok("comment", m[4], opts);
    if (m[5]) return tok("bool", m[5], opts);
    if (m[6]) return tok("null", m[6], opts);
    if (m[7]) return tok("num", m[7], opts);
    return tok("punc", m[8], opts);
  }, opts);
}

// ---------- JavaScript ----------

const JS_KEYWORDS =
  "await|async|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|yield";
const JS_RE = new RegExp(
  String.raw`(${VAR})|(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|` +
    "`(?:[^`\\\\]|\\\\[\\s\\S])*`?" +
    String.raw`)|\b(${JS_KEYWORDS})\b|\b(true|false|null|undefined|NaN|Infinity)\b|(\b0[xX][\da-fA-F]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(pm|console|JSON|Math|Date|Object|Array|String|Number|Promise|xml2Json|require)\b|([A-Za-z_$][\w$]*)(?=\s*\()|([{}()[\];,.:?=+\-*/%<>!&|^~])`,
  "g",
);

function javascript(text, opts) {
  return run(text, JS_RE, (m) => {
    if (m[1]) return varSpan(m[1], opts);
    if (m[2]) return tok("comment", m[2], opts);
    if (m[3]) return tok("str", m[3], opts);
    if (m[4]) return tok("keyword", m[4], opts);
    if (m[5]) return tok("bool", m[5], opts);
    if (m[6]) return tok("num", m[6], opts);
    if (m[7]) return tok("builtin", m[7], opts);
    if (m[8]) return tok("fn", m[8], opts);
    return tok("punc", m[9], opts);
  }, opts);
}

// ---------- XML / HTML ----------

const XML_RE = new RegExp(
  String.raw`(${VAR})|(<!--[\s\S]*?(?:-->|$))|(<!\[CDATA\[[\s\S]*?(?:\]\]>|$))|(<[?!][^>]*>?)|(<\/?)([\w:.-]+)([^<>]*?)(\/?>|(?=<)|$)|(&[#\w]+;)`,
  "g",
);
const ATTR_RE = /([\w:.@-]+)(\s*=\s*)?("[^"]*"?|'[^']*'?|[^\s"'>]+)?/g;

function attrs(text, opts) {
  return run(text, ATTR_RE, (m) => tok("attr", m[1], opts) + (m[2] ? tok("punc", m[2], opts) : "") + (m[3] ? tok("str", m[3], opts) : ""), opts);
}

function xml(text, opts) {
  return run(text, XML_RE, (m) => {
    if (m[1]) return varSpan(m[1], opts);
    if (m[2]) return tok("comment", m[2], opts);
    if (m[3]) return tok("comment", m[3], opts);
    if (m[4]) return tok("keyword", m[4], opts);
    if (m[5]) return tok("punc", m[5], opts) + tok("tag", m[6], opts) + attrs(m[7], opts) + (m[8] ? tok("punc", m[8], opts) : "");
    return tok("entity", m[9], opts);
  }, opts);
}

// ---------- GraphQL ----------

const GQL_RE = new RegExp(
  String.raw`(${VAR})|(#[^\n]*)|("""[\s\S]*?(?:"""|$)|"(?:[^"\\\n]|\\.)*"?)|\b(query|mutation|subscription|fragment|on|type|input|enum|interface|union|scalar|schema|extend|directive|implements)\b|\b(true|false|null)\b|(\$\w+)|(@\w+)|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b([A-Z]\w*)\b|(\w+)(?=\s*[:(])|([{}()[\]:!=,|&]|\.\.\.)`,
  "g",
);

function graphql(text, opts) {
  return run(text, GQL_RE, (m) => {
    if (m[1]) return varSpan(m[1], opts);
    if (m[2]) return tok("comment", m[2], opts);
    if (m[3]) return tok("str", m[3], opts);
    if (m[4]) return tok("keyword", m[4], opts);
    if (m[5]) return tok("bool", m[5], opts);
    if (m[6]) return tok("var", m[6], opts);
    if (m[7]) return tok("builtin", m[7], opts);
    if (m[8]) return tok("num", m[8], opts);
    if (m[9]) return tok("type", m[9], opts);
    if (m[10]) return tok("key", m[10], opts);
    return tok("punc", m[11], opts);
  }, opts);
}

// ---------- SQL (T-SQL) ----------

export const SQL_KEYWORDS =
  "ADD|ALL|ALTER|AND|ANY|APPLY|AS|ASC|AUTHORIZATION|BACKUP|BEGIN|BETWEEN|BREAK|BY|CASCADE|CASE|CATCH|CHECK|CLOSE|CLUSTERED|COLLATE|COLUMN|COMMIT|CONSTRAINT|CONTINUE|CREATE|CROSS|CURSOR|DATABASE|DEALLOCATE|DECLARE|DEFAULT|DELETE|DENY|DESC|DISTINCT|DROP|ELSE|END|ESCAPE|EXCEPT|EXEC|EXECUTE|EXISTS|FETCH|FOR|FOREIGN|FROM|FULL|FUNCTION|GO|GOTO|GRANT|GROUP|HAVING|IDENTITY|IF|IN|INCLUDE|INDEX|INNER|INSERT|INTERSECT|INTO|IS|JOIN|KEY|LEFT|LIKE|MERGE|NEXT|NOCHECK|NOCOUNT|NONCLUSTERED|NOT|NULL|OF|OFF|OFFSET|ON|ONLY|OPEN|OPTION|OR|ORDER|OUTER|OUTPUT|OVER|PARTITION|PERCENT|PIVOT|PRIMARY|PRINT|PROC|PROCEDURE|RAISERROR|REFERENCES|RETURN|RETURNS|REVOKE|RIGHT|ROLLBACK|ROWS|ROW|SAVE|SCHEMA|SELECT|SET|TABLE|THEN|THROW|TIES|TOP|TRAN|TRANSACTION|TRIGGER|TRUNCATE|TRY|UNION|UNIQUE|UNPIVOT|UPDATE|USE|USING|VALUES|VIEW|WAITFOR|WHEN|WHERE|WHILE|WITH|NOLOCK|READUNCOMMITTED|MATCHED|TARGET|SOURCE";
export const SQL_FUNCTIONS =
  "ABS|AVG|CAST|CEILING|CHARINDEX|COALESCE|CONCAT|CONCAT_WS|CONVERT|COUNT|COUNT_BIG|CURRENT_TIMESTAMP|DATEADD|DATEDIFF|DATEFROMPARTS|DATENAME|DATEPART|DAY|DB_NAME|DENSE_RANK|EOMONTH|FLOOR|FORMAT|GETDATE|GETUTCDATE|HASHBYTES|IIF|ISJSON|ISNULL|JSON_QUERY|JSON_VALUE|LAG|LEAD|LEFT|LEN|LOWER|LTRIM|MAX|MIN|MONTH|NEWID|NTILE|NULLIF|OBJECT_ID|OPENJSON|PATINDEX|RANK|REPLACE|REPLICATE|REVERSE|ROUND|ROW_NUMBER|RTRIM|SCOPE_IDENTITY|STRING_AGG|STRING_SPLIT|STUFF|SUBSTRING|SUM|SYSDATETIME|SYSUTCDATETIME|TRIM|TRY_CAST|TRY_CONVERT|UPPER|YEAR|SUSER_SNAME|SERVERPROPERTY";
const SQL_TYPES =
  "BIGINT|BINARY|BIT|CHAR|DATE|DATETIME|DATETIME2|DATETIMEOFFSET|DECIMAL|FLOAT|IMAGE|INT|MONEY|NCHAR|NTEXT|NUMERIC|NVARCHAR|REAL|SMALLDATETIME|SMALLINT|SMALLMONEY|SQL_VARIANT|TEXT|TIME|TINYINT|UNIQUEIDENTIFIER|VARBINARY|VARCHAR|XML|MAX";

const SQL_RE = new RegExp(
  String.raw`(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(N?'(?:[^']|'')*'?)|(\[(?:[^\]]|\]\])*\]?|"(?:[^"]|"")*"?)|(@@?[\w$#]+)|\b(${SQL_KEYWORDS})\b|\b(${SQL_FUNCTIONS})\b(?=\s*\()|\b(${SQL_TYPES})\b|\b(TRUE|FALSE)\b|(\b0x[\da-fA-F]*\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([(),;.*=<>!+\-/%])`,
  "gi",
);

function sql(text, opts) {
  return run(text, SQL_RE, (m) => {
    if (m[1]) return tok("comment", m[1], opts);
    if (m[2]) return tok("str", m[2], opts);
    if (m[3]) return tok("key", m[3], opts);
    if (m[4]) return tok("var", m[4], opts);
    if (m[5]) return tok("keyword", m[5], opts);
    if (m[6]) return tok("fn", m[6], opts);
    if (m[7]) return tok("type", m[7], opts);
    if (m[8]) return tok("bool", m[8], opts);
    if (m[9]) return tok("num", m[9], opts);
    return tok("punc", m[10], opts);
  }, opts);
}

const LANGS = { json, javascript, js: javascript, xml, html: xml, graphql, sql };

/**
 * HTML realçado para `text`. lang: json | javascript | xml | html | graphql | sql | text.
 * opts: { vars: boolean, varState: (name) => "known" | "unknown" | undefined }
 */
export function highlightCode(text, lang = "text", opts = {}) {
  const fn = LANGS[lang];
  return fn ? fn(text, opts) : textWithVars(text, opts);
}
