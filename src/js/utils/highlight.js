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
const TS_KEYWORDS = `${JS_KEYWORDS}|interface|type|enum|implements|private|public|protected|readonly|declare|namespace|abstract|as|satisfies|keyof|infer|is|asserts|override|module|from|string|number|boolean|any|unknown|never|object|bigint|symbol`;

function jsRegex(keywords) {
  return new RegExp(
    String.raw`(${VAR})|(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|` +
      "`(?:[^`\\\\]|\\\\[\\s\\S])*`?" +
      String.raw`)|\b(${keywords})\b|\b(true|false|null|undefined|NaN|Infinity)\b|(\b0[xX][\da-fA-F]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(pm|console|JSON|Math|Date|Object|Array|String|Number|Promise|xml2Json|require)\b|([A-Za-z_$][\w$]*)(?=\s*\()|([{}()[\];,.:?=+\-*/%<>!&|^~])`,
    "g",
  );
}

function jsLike(re) {
  return (text, opts) =>
    run(text, re, (m) => {
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

const javascript = jsLike(jsRegex(JS_KEYWORDS));
const typescript = jsLike(jsRegex(TS_KEYWORDS));

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

// ---------- CSS / SCSS ----------

const CSS_RE = new RegExp(
  String.raw`(\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(@[\w-]+)|(?<=^|[{;\s])(-{0,2}[a-zA-Z][\w-]*)(?=\s*:(?!:)[^{\n]*(?:[;}\n]|$))|(#[\da-fA-F]{3,8}\b)|((?<![\w-])-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?)|(!important\b)|([\w-]+)(?=\()|((?<=[\w)\]*])::?[a-zA-Z-]+(?![^{\n]*;))|([.#][a-zA-Z_][\w-]*)|(\$[\w-]+|--[\w-]+)|([{}()[\];:,>+~*=])`,
  "g",
);

function css(text, opts) {
  return run(text, CSS_RE, (m) => {
    if (m[1]) return tok("comment", m[1], opts);
    if (m[2]) return tok("str", m[2], opts);
    if (m[3]) return tok("keyword", m[3], opts);
    if (m[4]) return tok("key", m[4], opts);
    if (m[5]) return tok("num", m[5], opts);
    if (m[6]) return tok("num", m[6], opts);
    if (m[7]) return tok("keyword", m[7], opts);
    if (m[8]) return tok("fn", m[8], opts);
    if (m[9]) return tok("builtin", m[9], opts);
    if (m[10]) return tok("tag", m[10], opts);
    if (m[11]) return tok("var", m[11], opts);
    return tok("punc", m[12], opts);
  }, opts);
}

// ---------- Python ----------

const PY_KEYWORDS = "and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|match|case|nonlocal|not|or|pass|raise|return|try|while|with|yield";
const PY_BUILTINS = "print|len|range|str|int|float|bool|list|dict|set|tuple|open|isinstance|super|self|cls|enumerate|zip|map|filter|sorted|any|all|type|object|Exception|min|max|sum|abs";
const PY_RE = new RegExp(
  String.raw`(#[^\n]*)|([rRbBfFuU]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?))|(@[\w.]+)|\b(${PY_KEYWORDS})\b|\b(True|False|None)\b|\b(${PY_BUILTINS})\b|(\b0[xXoObB][\da-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?j?\b)|([A-Za-z_]\w*)(?=\s*\()|([()[\]{}:;,.=+\-*/%<>!&|^~])`,
  "g",
);

function python(text, opts) {
  return run(text, PY_RE, (m) => {
    if (m[1]) return tok("comment", m[1], opts);
    if (m[2]) return tok("str", m[2], opts);
    if (m[3]) return tok("builtin", m[3], opts);
    if (m[4]) return tok("keyword", m[4], opts);
    if (m[5]) return tok("bool", m[5], opts);
    if (m[6]) return tok("builtin", m[6], opts);
    if (m[7]) return tok("num", m[7], opts);
    if (m[8]) return tok("fn", m[8], opts);
    return tok("punc", m[9], opts);
  }, opts);
}

// ---------- Shell (bash) ----------

const SH_RE = new RegExp(
  String.raw`((?<![\w$#])#[^\n]*)|("(?:[^"\\]|\\[\s\S])*"?|'[^']*'?)|(\$(?:\{[^}\n]*\}?|\w+|[@#?$!*0-9-]))|\b(if|then|else|elif|fi|for|while|until|do|done|case|esac|in|function|return|exit|export|local|readonly|declare|source|alias|unset|shift|set|break|continue|trap)\b|\b(echo|cd|sudo|printf|read|eval|exec|test|cat|grep|sed|awk|curl|git|docker|npm|cargo|ls|rm|cp|mv|mkdir|chmod|kill)\b|((?<=\s)--?[A-Za-z][\w-]*)|(\b\d+\b)|([|&;<>(){}[\]=])`,
  "g",
);

function shell(text, opts) {
  return run(text, SH_RE, (m) => {
    if (m[1]) return tok("comment", m[1], opts);
    if (m[2]) return tok("str", m[2], opts);
    if (m[3]) return tok("var", m[3], opts);
    if (m[4]) return tok("keyword", m[4], opts);
    if (m[5]) return tok("builtin", m[5], opts);
    if (m[6]) return tok("attr", m[6], opts);
    if (m[7]) return tok("num", m[7], opts);
    return tok("punc", m[8], opts);
  }, opts);
}

// ---------- PowerShell ----------

const PS_RE = new RegExp(
  String.raw`(<#[\s\S]*?(?:#>|$)|#[^\n]*)|(@"[\s\S]*?(?:"@|$)|@'[\s\S]*?(?:'@|$)|"(?:[^"` + "`" + String.raw`]|` + "`" + String.raw`.)*"?|'(?:[^']|'')*'?)|(\$(?:\{[^}\n]*\}?|[\w:]+))|\b(begin|break|catch|class|continue|data|do|dynamicparam|else|elseif|end|enum|exit|filter|finally|for|foreach|function|if|in|param|process|return|switch|throw|trap|try|until|using|while)\b|\b([A-Z][a-z]+-[A-Z]\w*)\b|((?<![\w$])-[A-Za-z]\w*)|(\[[\w.]+(?:\[\])?\])|(\b\d+(?:\.\d+)?\b)|([|&;(){}[\]=,.!<>+\-*/%])`,
  "g",
);

function powershell(text, opts) {
  return run(text, PS_RE, (m) => {
    if (m[1]) return tok("comment", m[1], opts);
    if (m[2]) return tok("str", m[2], opts);
    if (m[3]) return tok("var", m[3], opts);
    if (m[4]) return tok("keyword", m[4], opts);
    if (m[5]) return tok("fn", m[5], opts);
    if (m[6]) return tok("attr", m[6], opts);
    if (m[7]) return tok("type", m[7], opts);
    if (m[8]) return tok("num", m[8], opts);
    return tok("punc", m[9], opts);
  }, opts);
}

// ---------- Linguagens estilo C (C#, Java, Go, Rust, C/C++) ----------

function clike(keywords) {
  const re = new RegExp(
    String.raw`(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|([@$]{0,2}"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.){0,2}'?|` +
      "`[^`]*`?" +
      String.raw`)|\b(${keywords})\b|\b(true|false|null|nullptr|nil|None|Some)\b|(\b0[xXbB][\da-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[fFdDmMlLuU]*\b)|(^[ \t]*#[ \t]*\w+|#!?\[[^\]\n]*\]?|@\w+)|\b([A-Z]\w*)\b|([A-Za-z_]\w*!?)(?=\s*[(<])|([{}()[\];,.:?=+\-*/%<>!&|^~])`,
    "gm",
  );
  return (text, opts) =>
    run(text, re, (m) => {
      if (m[1]) return tok("comment", m[1], opts);
      if (m[2]) return tok("str", m[2], opts);
      if (m[3]) return tok("keyword", m[3], opts);
      if (m[4]) return tok("bool", m[4], opts);
      if (m[5]) return tok("num", m[5], opts);
      if (m[6]) return tok("builtin", m[6], opts);
      if (m[7]) return tok("type", m[7], opts);
      if (m[8]) return tok("fn", m[8], opts);
      return tok("punc", m[9], opts);
    }, opts);
}

const csharp = clike(
  "abstract|as|async|await|base|break|case|catch|checked|class|const|continue|default|delegate|do|else|enum|event|explicit|extern|finally|fixed|for|foreach|get|goto|if|implicit|in|init|interface|internal|is|lock|namespace|new|operator|out|override|params|partial|private|protected|public|readonly|record|ref|required|return|sealed|set|sizeof|stackalloc|static|struct|switch|this|throw|try|typeof|unchecked|unsafe|using|var|virtual|void|volatile|when|where|while|with|yield|bool|byte|char|decimal|double|float|int|long|object|sbyte|short|string|uint|ulong|ushort|dynamic|nameof",
);
const java = clike(
  "abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|record|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|var|void|volatile|while|yield|sealed|permits|fun|val|when|object|companion|data|override|open|internal|lateinit",
);
const go = clike(
  "break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|string|int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|uintptr|float32|float64|bool|byte|rune|error|any",
);
const rust = clike(
  "as|async|await|break|const|continue|crate|dyn|else|enum|extern|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|static|struct|super|trait|type|unsafe|use|where|while|i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64|bool|char|str",
);
const cpp = clike(
  "alignas|alignof|auto|bool|break|case|catch|char|class|const|constexpr|const_cast|continue|decltype|default|delete|do|double|dynamic_cast|else|enum|explicit|export|extern|float|for|friend|goto|if|inline|int|long|mutable|namespace|new|noexcept|operator|private|protected|public|register|reinterpret_cast|return|short|signed|sizeof|static|static_assert|static_cast|struct|switch|template|this|thread_local|throw|try|typedef|typeid|typename|union|unsigned|using|virtual|void|volatile|while",
);

// ---------- YAML ----------

const YAML_RE = new RegExp(
  String.raw`((?<=^|\s)#[^\n]*)|((?<=^[ \t]*(?:- )*)(?:"[^"\n]*"|'[^'\n]*'|[^\s#:"'\-[{][^:\n#]*?|-[^\s:\n][^:\n#]*?)(?=[ \t]*:(?:\s|$)))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\n]|'')*'?)|\b(true|false|yes|no|on|off|null)\b|((?<![\w.])-?\d+(?:\.\d+)?(?![\w.]))|([&*][\w-]+|![\w!]+)|(^---|^\.\.\.|(?<=^[ \t]*)-(?=\s)|:(?=\s|$)|[[\]{},]|[|>][-+]?$)`,
  "gm",
);

function yaml(text, opts) {
  return run(text, YAML_RE, (m) => {
    if (m[1]) return tok("comment", m[1], opts);
    if (m[2]) return tok("key", m[2], opts);
    if (m[3]) return tok("str", m[3], opts);
    if (m[4]) return tok("bool", m[4], opts);
    if (m[5]) return tok("num", m[5], opts);
    if (m[6]) return tok("var", m[6], opts);
    return tok("punc", m[7], opts);
  }, opts);
}

// ---------- diff ----------

const DIFF_RE = /^(?:(\+(?!\+\+ ).*)|(-(?!-- ).*)|(@@.*)|((?:diff |index |--- |\+\+\+ ).*))$/gm;

function diff(text, opts) {
  return run(text, DIFF_RE, (m) => {
    if (m[1] !== undefined) return tok("ins", m[1], opts);
    if (m[2] !== undefined) return tok("del", m[2], opts);
    if (m[3] !== undefined) return tok("keyword", m[3], opts);
    return tok("builtin", m[4], opts);
  }, opts);
}

// ---------- Mermaid ----------

const MERMAID_RE = new RegExp(
  String.raw`(%%[^\n]*)|("[^"\n]*"?|\|[^|\n]*\|)|\b(graph|flowchart|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|C4Container|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta|kanban|radar-beta)\b|\b(TB|TD|BT|RL|LR|subgraph|end|direction|participant|actor|as|loop|alt|else|opt|par|and|critical|break|rect|note|Note|over|left of|right of|activate|deactivate|autonumber|title|section|dateFormat|axisFormat|excludes|class|classDef|style|linkStyle|click|state|commit|branch|checkout|merge|accTitle|accDescr|showData)\b|(<{0,2}[-=.]{2,}[>xo)]{0,2}|-{1,2}>>?|-[x)])|(\b\d+(?:\.\d+)?\b)|([[\](){}:;,>])`,
  "g",
);

function mermaid(text, opts) {
  return run(text, MERMAID_RE, (m) => {
    if (m[1]) return tok("comment", m[1], opts);
    if (m[2]) return tok("str", m[2], opts);
    if (m[3]) return tok("keyword", m[3], opts);
    if (m[4]) return tok("builtin", m[4], opts);
    if (m[5]) return tok("fn", m[5], opts);
    if (m[6]) return tok("num", m[6], opts);
    return tok("punc", m[7], opts);
  }, opts);
}

const LANGS = {
  json, javascript, js: javascript, typescript, xml, html: xml, graphql, sql, css, python, bash: shell, powershell,
  csharp, java, go, rust, cpp, yaml, diff, mermaid,
};

// ---------- Linguagens dos blocos de código das Notas ----------

/** Linguagens oferecidas nos blocos de código (id salvo em <pre data-lang>). */
export const CODE_LANGS = [
  ["text", "Texto"], ["mermaid", "Mermaid"], ["json", "JSON"], ["javascript", "JavaScript"], ["typescript", "TypeScript"],
  ["html", "HTML"], ["xml", "XML"], ["css", "CSS"], ["sql", "SQL"], ["python", "Python"], ["bash", "Bash"],
  ["powershell", "PowerShell"], ["csharp", "C#"], ["java", "Java / Kotlin"], ["go", "Go"], ["rust", "Rust"],
  ["cpp", "C / C++"], ["yaml", "YAML"], ["graphql", "GraphQL"], ["diff", "Diff"], ["markdown", "Markdown"],
];

const LANG_ALIASES = {
  "": "text", plain: "text", plaintext: "text", txt: "text", mmd: "mermaid", js: "javascript", jsx: "javascript", mjs: "javascript",
  node: "javascript", ts: "typescript", tsx: "typescript", jsonc: "json", json5: "json", htm: "html", svg: "xml", xaml: "xml",
  scss: "css", less: "css", tsql: "sql", mssql: "sql", mysql: "sql", postgres: "sql", postgresql: "sql", plsql: "sql",
  sqlite: "sql", py: "python", python3: "python", sh: "bash", shell: "bash", zsh: "bash", console: "bash", ps1: "powershell",
  ps: "powershell", pwsh: "powershell", cs: "csharp", "c#": "csharp", dotnet: "csharp", kotlin: "java", kt: "java",
  golang: "go", rs: "rust", c: "cpp", "c++": "cpp", h: "cpp", hpp: "cpp", cc: "cpp", yml: "yaml", gql: "graphql",
  patch: "diff", md: "markdown",
};

/** Normaliza a linguagem de um bloco (aliases do Markdown); desconhecidas são mantidas (sem realce). */
export function normalizeCodeLang(lang) {
  const l = String(lang ?? "").trim().toLowerCase();
  if (l in LANG_ALIASES) return LANG_ALIASES[l];
  return /^[\w+#.-]{1,24}$/.test(l) ? l : "text";
}

/**
 * HTML realçado para `text`. lang: uma das chaves de LANGS (json, javascript, sql, css, mermaid...) ou text.
 * opts: { vars: boolean, varState: (name) => "known" | "unknown" | undefined }
 */
export function highlightCode(text, lang = "text", opts = {}) {
  const fn = LANGS[lang];
  return fn ? fn(text, opts) : textWithVars(text, opts);
}
