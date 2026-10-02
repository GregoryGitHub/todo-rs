// Interpreta a sintaxe do mongosh e gera a operação que o backend executa (src-tauri/src/db/mongo.rs).
//
//   db.users.find({ age: { $gt: 18 } }, { name: 1 }).sort({ name: 1 }).limit(10)
//   db.getCollection("x").aggregate([...]) · db.runCommand({...}) · show collections · use loja
//
// Valores viram Extended JSON: ObjectId('…') → {$oid}, ISODate('…') → {$date}, NumberLong → {$numberLong},
// NumberDecimal → {$numberDecimal}, UUID → {$binary subType 04}, /re/i → {$regularExpression}.
// Não é um interpretador JavaScript: variáveis, funções e laços não são suportados.

export class MongoSyntaxError extends Error {
  constructor(message, pos) {
    super(message);
    this.pos = pos;
  }
}

/** ObjectId novo (timestamp + aleatório), para ObjectId() sem argumentos. */
export function newObjectId() {
  const ts = Math.floor(Date.now() / 1000).toString(16).padStart(8, "0");
  let rnd = "";
  for (let i = 0; i < 16; i++) rnd += Math.floor(Math.random() * 16).toString(16);
  return ts + rnd;
}

function bytesToB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function uuidToBinary(uuid) {
  const hex = String(uuid).replace(/[{}-]/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`UUID inválido: ${uuid}`);
  const bytes = hex.match(/../g).map((h) => parseInt(h, 16));
  return { $binary: { base64: bytesToB64(bytes), subType: "04" } };
}

function dateEjson(arg) {
  if (arg === undefined) return { $date: new Date().toISOString() };
  const d = typeof arg === "number" ? new Date(arg) : new Date(String(arg).trim().replace(" ", "T"));
  if (Number.isNaN(d.getTime())) throw new Error(`Data inválida: ${arg}`);
  const ms = d.getTime();
  // Fora de 1970–9999 o formato relaxado não vale: usa a forma canônica.
  return ms >= 0 && ms < 253402300800000 ? { $date: d.toISOString() } : { $date: { $numberLong: String(ms) } };
}

const plain = (v) => (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 ? null : v);

/** Construtores do shell → Extended JSON. */
const CONSTRUCTORS = {
  ObjectId: (a) => {
    if (a === undefined) return { $oid: newObjectId() };
    const s = String(a);
    if (!/^[0-9a-fA-F]{24}$/.test(s)) throw new Error(`ObjectId inválido: "${s}" (24 caracteres hexadecimais)`);
    return { $oid: s.toLowerCase() };
  },
  ISODate: dateEjson,
  Date: dateEjson,
  NumberLong: (a) => ({ $numberLong: intString(a) }),
  Long: (a) => ({ $numberLong: intString(a) }),
  NumberInt: (a) => ({ $numberInt: intString(a) }),
  Int32: (a) => ({ $numberInt: intString(a) }),
  NumberDecimal: (a) => ({ $numberDecimal: numString(a) }),
  Decimal128: (a) => ({ $numberDecimal: numString(a) }),
  Double: (a) => ({ $numberDouble: numString(a) }),
  UUID: (a) => uuidToBinary(a ?? crypto.randomUUID()),
  BinData: (sub, b64) => ({ $binary: { base64: String(b64), subType: Number(sub).toString(16).padStart(2, "0") } }),
  Timestamp: (t, i) => (t && typeof t === "object" ? { $timestamp: { t: Number(t.t), i: Number(t.i) } } : { $timestamp: { t: Number(t ?? 0), i: Number(i ?? 0) } }),
  MinKey: () => ({ $minKey: 1 }),
  MaxKey: () => ({ $maxKey: 1 }),
  RegExp: (p, f = "") => ({ $regularExpression: { pattern: String(p), options: sortFlags(f) } }),
};

function intString(a) {
  const s = String(plain(a) ?? a).trim();
  if (!/^[+-]?\d+$/.test(s)) throw new Error(`Inteiro inválido: ${s}`);
  return s.replace(/^\+/, "");
}

function numString(a) {
  const s = String(plain(a) ?? a).trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$|^[+-]?(Infinity|NaN)$/.test(s)) throw new Error(`Número inválido: ${s}`);
  return s;
}

function sortFlags(f) {
  return [...String(f)].sort().join("");
}

// ---------- Parser de valores ----------

class Parser {
  constructor(text) {
    this.s = text;
    this.i = 0;
  }

  fail(msg, at = this.i) {
    throw new MongoSyntaxError(msg, at);
  }

  ws() {
    const s = this.s;
    for (;;) {
      while (this.i < s.length && /\s/.test(s[this.i])) this.i++;
      if (s.startsWith("//", this.i)) {
        while (this.i < s.length && s[this.i] !== "\n") this.i++;
      } else if (s.startsWith("/*", this.i)) {
        const end = s.indexOf("*/", this.i + 2);
        this.i = end < 0 ? s.length : end + 2;
      } else return;
    }
  }

  peek() {
    this.ws();
    return this.s[this.i];
  }

  eat(ch) {
    if (this.peek() === ch) {
      this.i++;
      return true;
    }
    return false;
  }

  expect(ch) {
    if (!this.eat(ch)) this.fail(`Esperava "${ch}"${this.i < this.s.length ? ` e encontrei "${this.s[this.i]}"` : " antes do fim"}`);
  }

  ident() {
    this.ws();
    const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    return m[0];
  }

  string() {
    const q = this.s[this.i];
    const start = this.i++;
    let out = "";
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === q) return out;
      if (c === "\\") {
        const e = this.s[this.i++];
        if (e === "n") out += "\n";
        else if (e === "t") out += "\t";
        else if (e === "r") out += "\r";
        else if (e === "b") out += "\b";
        else if (e === "f") out += "\f";
        else if (e === "0") out += "\0";
        else if (e === "u") {
          out += String.fromCharCode(parseInt(this.s.slice(this.i, this.i + 4), 16));
          this.i += 4;
        } else if (e === "x") {
          out += String.fromCharCode(parseInt(this.s.slice(this.i, this.i + 2), 16));
          this.i += 2;
        } else out += e;
      } else out += c;
    }
    this.fail("String sem fechamento", start);
  }

  number() {
    const m = /^[+-]?(0[xX][\da-fA-F]+|(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?|Infinity|NaN)/.exec(this.s.slice(this.i));
    if (!m) this.fail("Número inválido");
    this.i += m[0].length;
    const text = m[0];
    const n = Number(text);
    if (!Number.isFinite(n)) return { $numberDouble: text.replace(/^\+/, "") };
    // Inteiros grandes não cabem em number: vão como long sem perder dígitos.
    if (/^[+-]?\d+$/.test(text) && !Number.isSafeInteger(n)) return { $numberLong: text.replace(/^\+/, "") };
    return n;
  }

  regex() {
    const start = this.i++;
    let pattern = "";
    let inClass = false;
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === "\\") {
        pattern += c + (this.s[this.i++] ?? "");
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        const flags = /^[a-z]*/.exec(this.s.slice(this.i))[0];
        this.i += flags.length;
        return { $regularExpression: { pattern, options: sortFlags(flags) } };
      } else if (c === "\n") break;
      pattern += c;
    }
    this.fail("Expressão regular sem fechamento", start);
  }

  value() {
    const c = this.peek();
    if (c === undefined) this.fail("Valor esperado antes do fim");
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"' || c === "'" || c === "`") return this.string();
    if (c === "/") return this.regex();
    if (/[\d.+-]/.test(c)) return this.number();
    const start = this.i;
    let name = this.ident();
    if (!name) this.fail(`Caractere inesperado "${c}"`);
    if (name === "true") return true;
    if (name === "false") return false;
    if (name === "null" || name === "undefined") return null;
    if (name === "Infinity" || name === "NaN") return { $numberDouble: name };
    if (name === "new") {
      name = this.ident();
      if (!name) this.fail("Construtor esperado depois de new");
    }
    const ctor = CONSTRUCTORS[name];
    if (!ctor) this.fail(`"${name}" não é suportado aqui (use valores literais, ObjectId(), ISODate(), NumberLong()…)`, start);
    const args = this.peek() === "(" ? this.args() : [];
    try {
      // Date() sem new no shell devolve string; aqui tratamos como data, que é o que se quer numa consulta.
      return ctor(...args.map(unwrapScalar));
    } catch (e) {
      this.fail(e.message, start);
    }
  }

  object() {
    this.expect("{");
    const out = {};
    while (!this.eat("}")) {
      const c = this.peek();
      let key;
      if (c === '"' || c === "'" || c === "`") key = this.string();
      else if (c !== undefined && /[\d]/.test(c)) key = String(this.number());
      else key = this.ident();
      if (key === null || key === undefined) this.fail("Nome de campo esperado");
      this.expect(":");
      out[key] = this.value();
      if (!this.eat(",")) {
        this.expect("}");
        break;
      }
    }
    return out;
  }

  array() {
    this.expect("[");
    const out = [];
    while (!this.eat("]")) {
      out.push(this.value());
      if (!this.eat(",")) {
        this.expect("]");
        break;
      }
    }
    return out;
  }

  args() {
    this.expect("(");
    const out = [];
    while (!this.eat(")")) {
      out.push(this.value());
      if (!this.eat(",")) {
        this.expect(")");
        break;
      }
    }
    return out;
  }

  end() {
    this.ws();
    this.eat(";");
    this.ws();
    if (this.i < this.s.length) this.fail(`Texto inesperado: "${this.s.slice(this.i, this.i + 20)}"`);
  }
}

/** Números passados a construtores (NumberLong(5)) chegam como number ou {$numberLong}. */
function unwrapScalar(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const k = Object.keys(v);
    if (k.length === 1 && ["$numberLong", "$numberDouble", "$numberInt", "$numberDecimal"].includes(k[0])) return v[k[0]];
  }
  return v;
}

/** Um valor no formato do shell (filtros, documentos digitados no grid). */
export function parseShellValue(text) {
  const p = new Parser(String(text));
  const v = p.value();
  p.end();
  return v;
}

// ---------- Comandos ----------

const DB_METHODS = new Set(["runCommand", "adminCommand", "getCollectionNames", "getCollectionInfos", "createCollection", "getCollection", "getSiblingDB"]);

const COLLECTION_METHODS = [
  "find", "findOne", "aggregate", "countDocuments", "estimatedDocumentCount", "count", "distinct",
  "insertOne", "insertMany", "insert", "updateOne", "updateMany", "update", "replaceOne",
  "deleteOne", "deleteMany", "remove", "createIndex", "ensureIndex", "dropIndex", "getIndexes", "drop",
];
export const MONGO_COLLECTION_METHODS = COLLECTION_METHODS;
export const MONGO_DB_METHODS = ["getCollection", "runCommand", "adminCommand", "getCollectionNames", "createCollection"];
export const MONGO_CURSOR_METHODS = ["sort", "limit", "skip", "projection", "count", "toArray", "pretty"];
export const MONGO_OPERATORS = [
  "$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin", "$and", "$or", "$nor", "$not", "$exists", "$type", "$regex", "$options",
  "$elemMatch", "$size", "$all", "$expr", "$text", "$search", "$set", "$unset", "$inc", "$push", "$pull", "$addToSet", "$pop", "$rename",
  "$currentDate", "$setOnInsert", "$match", "$group", "$project", "$sort", "$limit", "$skip", "$lookup", "$unwind", "$addFields",
  "$count", "$facet", "$sum", "$avg", "$min", "$max", "$first", "$last", "$replaceRoot", "$out", "$merge", "$dateToString", "$toString",
];

const isDoc = (v) => v && typeof v === "object" && !Array.isArray(v);

function docArg(v, what) {
  if (v === undefined || v === null) return {};
  if (!isDoc(v)) throw new Error(`${what} deve ser um documento { … }`);
  return v;
}

/** Nome padrão de um índice ({a: 1, b: -1} → "a_1_b_-1"). */
export function indexName(keys) {
  return Object.entries(keys)
    .map(([k, v]) => `${k}_${typeof v === "object" ? Object.values(v)[0] : v}`)
    .join("_");
}

/**
 * Interpreta um comando. Devolve:
 *  { kind: "op", op, write, label } — operação para o backend
 *  { kind: "use", db }              — troca o banco do console
 */
export function parseCommand(text) {
  const p = new Parser(String(text).trim());
  const first = p.ident();
  if (first === "use") {
    const db = p.ident() ?? (p.peek() === '"' || p.peek() === "'" ? p.string() : null);
    if (!db) p.fail("Nome do banco esperado depois de use");
    p.end();
    return { kind: "use", db };
  }
  if (first === "show") {
    const what = p.ident();
    p.end();
    if (what === "dbs" || what === "databases") return op({ op: "listDatabases" }, false, "show dbs");
    if (what === "collections" || what === "tables") return op({ op: "listCollections" }, false, "show collections");
    p.fail(`show ${what ?? ""}: use "show dbs" ou "show collections"`);
  }
  if (first !== "db") p.fail('Comandos começam com "db.", "show" ou "use"', 0);

  // db.<coleção> | db["coleção"] | db.getCollection("coleção") | db.<método>(…)
  let collection = null;
  if (p.eat("[")) {
    collection = p.peek() === '"' || p.peek() === "'" ? p.string() : p.fail("Nome da coleção esperado");
    p.expect("]");
  } else {
    p.expect(".");
    const name = p.ident();
    if (!name) p.fail("Nome da coleção ou método esperado depois de db.");
    if (DB_METHODS.has(name) && p.peek() === "(") {
      const args = p.args();
      if (name === "getCollection") {
        collection = String(args[0] ?? "");
      } else if (name === "getSiblingDB") {
        p.fail("getSiblingDB não é suportado: use o seletor de banco do console ou \"use <banco>\"");
      } else {
        p.end();
        return dbMethod(name, args, p);
      }
    } else collection = name;
  }
  if (!collection) p.fail("Nome da coleção vazio");

  p.expect(".");
  const methodAt = p.i;
  const method = p.ident();
  if (!method) p.fail("Método da coleção esperado (find, aggregate, insertOne…)");
  if (p.peek() !== "(") p.fail(`Faltam os parênteses: ${method}(…)`);
  const args = p.args();
  const chain = [];
  while (p.eat(".")) {
    const at = p.i;
    const name = p.ident();
    if (!name) p.fail("Método esperado depois de \".\"");
    chain.push({ name, args: p.peek() === "(" ? p.args() : [], at });
  }
  p.end();
  try {
    return collectionMethod(collection, method, args, chain);
  } catch (e) {
    if (e instanceof MongoSyntaxError) throw e;
    throw new MongoSyntaxError(e.message, methodAt);
  }
}

function op(o, write, label) {
  return { kind: "op", op: o, write, label };
}

function dbMethod(name, args) {
  switch (name) {
    case "runCommand":
    case "adminCommand": {
      let cmd = args[0];
      if (typeof cmd === "string") cmd = { [cmd]: 1 };
      return op({ op: "runCommand", command: docArg(cmd, "O comando"), admin: name === "adminCommand" }, true, `db.${name}`);
    }
    case "getCollectionNames":
    case "getCollectionInfos":
      return op({ op: "listCollections" }, false, "db.getCollectionNames()");
    case "createCollection":
      return op({ op: "createCollection", name: String(args[0] ?? ""), options: args[1] ?? null }, true, `db.createCollection(${args[0]})`);
  }
  throw new Error(`db.${name} não é suportado`);
}

function collectionMethod(collection, method, args, chain) {
  const c = collection;
  const label = `db.${c}.${method}`;
  const noChain = () => {
    if (chain.length && !chain.every((x) => x.name === "pretty" || x.name === "toArray")) throw new Error(`${method}() não aceita .${chain[0].name}()`);
  };
  switch (method) {
    case "find":
    case "findOne": {
      const find = { op: "find", collection: c, filter: docArg(args[0], "O filtro"), projection: args[1] ?? null, sort: null, skip: null, limit: method === "findOne" ? 1 : null };
      for (const { name, args: a } of chain) {
        if (name === "sort") find.sort = docArg(a[0], "sort");
        else if (name === "limit") find.limit = toInt(a[0], "limit");
        else if (name === "skip") find.skip = toInt(a[0], "skip");
        else if (name === "projection" || name === "project") find.projection = docArg(a[0], "projection");
        else if (name === "count" || name === "itcount" || name === "size") return op({ op: "countDocuments", collection: c, filter: find.filter }, false, `${label}().count`);
        else if (["pretty", "toArray", "batchSize", "maxTimeMS", "hint", "collation", "comment", "allowDiskUse"].includes(name)) continue;
        else throw new Error(`.${name}() não é suportado depois de find (use sort, limit, skip, projection, count)`);
      }
      return op(find, false, label);
    }
    case "aggregate": {
      noChain();
      const pipeline = Array.isArray(args[0]) ? args[0] : args.filter(isDoc);
      if (!pipeline.every(isDoc)) throw new Error("O pipeline deve ser uma lista de estágios { $match: … }");
      const writes = pipeline.some((s) => "$out" in s || "$merge" in s);
      return op({ op: "aggregate", collection: c, pipeline }, writes, label);
    }
    case "countDocuments":
    case "count":
      noChain();
      return op({ op: "countDocuments", collection: c, filter: docArg(args[0], "O filtro") }, false, label);
    case "estimatedDocumentCount":
      noChain();
      return op({ op: "estimatedDocumentCount", collection: c }, false, label);
    case "distinct":
      noChain();
      if (typeof args[0] !== "string") throw new Error('distinct("campo", filtro)');
      return op({ op: "distinct", collection: c, field: args[0], filter: docArg(args[1], "O filtro") }, false, label);
    case "insertOne":
      noChain();
      return op({ op: "insertOne", collection: c, document: docArg(args[0], "O documento") }, true, label);
    case "insertMany":
      noChain();
      if (!Array.isArray(args[0])) throw new Error("insertMany([ {…}, {…} ])");
      return op({ op: "insertMany", collection: c, documents: args[0].map((d) => docArg(d, "Cada documento")) }, true, label);
    case "insert":
      noChain();
      return Array.isArray(args[0])
        ? op({ op: "insertMany", collection: c, documents: args[0].map((d) => docArg(d, "Cada documento")) }, true, label)
        : op({ op: "insertOne", collection: c, document: docArg(args[0], "O documento") }, true, label);
    case "updateOne":
    case "updateMany":
    case "update": {
      noChain();
      const opts = isDoc(args[2]) ? args[2] : {};
      const many = method === "updateMany" || (method === "update" && opts.multi === true);
      const update = Array.isArray(args[1]) ? args[1] : docArg(args[1], "A atualização");
      if (!Array.isArray(update) && !Object.keys(update).some((k) => k.startsWith("$"))) {
        throw new Error("A atualização precisa de operadores ($set, $inc…); para trocar o documento inteiro use replaceOne");
      }
      return op({ op: many ? "updateMany" : "updateOne", collection: c, filter: docArg(args[0], "O filtro"), update, upsert: !!opts.upsert }, true, label);
    }
    case "replaceOne": {
      noChain();
      const opts = isDoc(args[2]) ? args[2] : {};
      return op({ op: "replaceOne", collection: c, filter: docArg(args[0], "O filtro"), replacement: docArg(args[1], "O documento"), upsert: !!opts.upsert }, true, label);
    }
    case "deleteOne":
    case "deleteMany":
      noChain();
      return op({ op: method, collection: c, filter: docArg(args[0], "O filtro") }, true, label);
    case "remove": {
      noChain();
      const justOne = args[1] === true || (isDoc(args[1]) && args[1].justOne === true);
      return op({ op: justOne ? "deleteOne" : "deleteMany", collection: c, filter: docArg(args[0], "O filtro") }, true, label);
    }
    case "createIndex":
    case "ensureIndex":
      noChain();
      return op({ op: "createIndex", collection: c, keys: docArg(args[0], "As chaves do índice"), options: args[1] ?? null }, true, label);
    case "dropIndex":
      noChain();
      return op({ op: "dropIndex", collection: c, name: isDoc(args[0]) ? indexName(args[0]) : String(args[0] ?? "") }, true, label);
    case "getIndexes":
      noChain();
      return op({ op: "getIndexes", collection: c }, false, label);
    case "drop":
      noChain();
      return op({ op: "drop", collection: c }, true, label);
  }
  throw new Error(`${method}() não é suportado. Disponíveis: ${COLLECTION_METHODS.join(", ")}`);
}

function toInt(v, what) {
  const n = Number(unwrapScalar(v));
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} deve ser um inteiro ≥ 0`);
  return n;
}

// ---------- Divisão do script ----------

/**
 * Comandos do script: separados por ";" e por quebra de linha quando a próxima linha começa um
 * comando novo (db., show, use). Linhas que começam com "." continuam a cadeia anterior.
 */
export function splitMongo(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const n = text.length;
  const push = (end, next) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t && !/^(\/\/[^\n]*\s*|\/\*[\s\S]*?\*\/\s*)+$/.test(t)) out.push({ text: t.replace(/;\s*$/, ""), start: start + lead, end: start + lead + t.length });
    start = next;
  };
  while (i < n) {
    const c = text[i];
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      i++;
      while (i < n && text[i] !== q) i += text[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      push(i, i + 1);
    } else if (c === "\n" && depth === 0) {
      const rest = text.slice(i + 1);
      if (/^\s*(db\b|show\b|use\b)/.test(rest) && text.slice(start, i).trim()) push(i, i + 1);
    }
    i++;
  }
  push(n, n);
  return out;
}

/** Comando sob o cursor (ou o anterior mais próximo na mesma região). */
export function mongoStatementAt(text, pos) {
  const list = splitMongo(text);
  let best = null;
  for (const s of list) {
    if (pos >= s.start && pos <= s.end) return s;
    if (s.end <= pos) best = s;
  }
  if (best && !/\n\s*\n/.test(text.slice(best.end, pos))) return best;
  return list.find((s) => s.start >= pos) || best;
}
