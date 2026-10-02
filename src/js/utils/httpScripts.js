// Pre-request and test scripts with a subset of Postman's `pm` API.
// Scripts are trusted (written by the user on their own machine) and run in the page.

import { kv, resolveVars, buildScope, headerValue } from "./httpModel.js";

// ---------- pm.expect (Chai-like) ----------

class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssertionError";
  }
}

const fmt = (v) => {
  try {
    return typeof v === "string" ? `'${v}'` : JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

const CHAIN_WORDS = ["to", "be", "been", "is", "that", "which", "and", "has", "have", "with", "at", "of", "same", "but", "does", "still"];

function expect(actual, message) {
  const flags = { negate: false, deep: false };
  const a = {};
  const check = (ok, msgPos, msgNeg) => {
    if (flags.negate ? ok : !ok) throw new AssertionError(`${message ? `${message}: ` : ""}${flags.negate ? msgNeg : msgPos}`);
    return a;
  };
  const getter = (name, fn) => Object.defineProperty(a, name, { get: fn, enumerable: false });

  for (const w of CHAIN_WORDS) getter(w, () => a);
  getter("not", () => ((flags.negate = !flags.negate), a));
  getter("deep", () => ((flags.deep = true), a));
  getter("ok", () => check(!!actual, `expected ${fmt(actual)} to be truthy`, `expected ${fmt(actual)} to be falsy`));
  getter("true", () => check(actual === true, `expected ${fmt(actual)} to be true`, `expected ${fmt(actual)} not to be true`));
  getter("false", () => check(actual === false, `expected ${fmt(actual)} to be false`, `expected ${fmt(actual)} not to be false`));
  getter("null", () => check(actual === null, `expected ${fmt(actual)} to be null`, `expected ${fmt(actual)} not to be null`));
  getter("undefined", () => check(actual === undefined, `expected ${fmt(actual)} to be undefined`, `expected ${fmt(actual)} not to be undefined`));
  getter("NaN", () => check(Number.isNaN(actual), `expected ${fmt(actual)} to be NaN`, `expected ${fmt(actual)} not to be NaN`));
  getter("exist", () => check(actual !== null && actual !== undefined, `expected ${fmt(actual)} to exist`, `expected ${fmt(actual)} not to exist`));
  getter("empty", () => {
    const len = typeof actual === "string" || Array.isArray(actual) ? actual.length : actual && typeof actual === "object" ? Object.keys(actual).length : NaN;
    return check(len === 0, `expected ${fmt(actual)} to be empty`, `expected ${fmt(actual)} not to be empty`);
  });

  Object.assign(a, {
    equal(v) {
      const ok = flags.deep ? deepEqual(actual, v) : actual === v;
      return check(ok, `expected ${fmt(actual)} to equal ${fmt(v)}`, `expected ${fmt(actual)} to not equal ${fmt(v)}`);
    },
    eql(v) {
      return check(deepEqual(actual, v), `expected ${fmt(actual)} to deeply equal ${fmt(v)}`, `expected ${fmt(actual)} to not deeply equal ${fmt(v)}`);
    },
    above(n) {
      return check(actual > n, `expected ${fmt(actual)} to be above ${n}`, `expected ${fmt(actual)} to be at most ${n}`);
    },
    below(n) {
      return check(actual < n, `expected ${fmt(actual)} to be below ${n}`, `expected ${fmt(actual)} to be at least ${n}`);
    },
    least(n) {
      return check(actual >= n, `expected ${fmt(actual)} to be at least ${n}`, `expected ${fmt(actual)} to be below ${n}`);
    },
    most(n) {
      return check(actual <= n, `expected ${fmt(actual)} to be at most ${n}`, `expected ${fmt(actual)} to be above ${n}`);
    },
    within(lo, hi) {
      return check(actual >= lo && actual <= hi, `expected ${fmt(actual)} to be within ${lo}..${hi}`, `expected ${fmt(actual)} to not be within ${lo}..${hi}`);
    },
    a(type) {
      const t = typeOf(actual);
      return check(t === type.toLowerCase(), `expected ${fmt(actual)} to be a ${type}`, `expected ${fmt(actual)} not to be a ${type}`);
    },
    include(v) {
      let ok;
      if (typeof actual === "string") ok = actual.includes(v);
      else if (Array.isArray(actual)) ok = actual.some((x) => (flags.deep || typeof v === "object" ? deepEqual(x, v) : x === v));
      else if (actual && typeof actual === "object") ok = Object.entries(v || {}).every(([k, val]) => deepEqual(actual[k], val));
      else ok = false;
      return check(ok, `expected ${fmt(actual)} to include ${fmt(v)}`, `expected ${fmt(actual)} to not include ${fmt(v)}`);
    },
    property(name, ...val) {
      const has = actual != null && Object.prototype.hasOwnProperty.call(Object(actual), name);
      if (!val.length) check(has, `expected ${fmt(actual)} to have property '${name}'`, `expected ${fmt(actual)} to not have property '${name}'`);
      else {
        const ok = has && (flags.deep ? deepEqual(actual[name], val[0]) : actual[name] === val[0]);
        check(ok, `expected property '${name}' to equal ${fmt(val[0])}, got ${fmt(actual?.[name])}`, `expected property '${name}' to not equal ${fmt(val[0])}`);
      }
      // Like Chai, the chain continues on the property value: .property("a").that.equals(1)
      return flags.negate ? a : expect(actual[name], message);
    },
    keys(...keys) {
      const list = keys.flat();
      const ok = actual && list.every((k) => Object.prototype.hasOwnProperty.call(actual, k));
      return check(ok, `expected ${fmt(actual)} to have keys ${fmt(list)}`, `expected ${fmt(actual)} to not have keys ${fmt(list)}`);
    },
    lengthOf(n) {
      const len = actual?.length;
      return check(len === n, `expected length ${n}, got ${len}`, `expected length to not be ${n}`);
    },
    match(re) {
      return check(re.test(String(actual)), `expected ${fmt(actual)} to match ${re}`, `expected ${fmt(actual)} not to match ${re}`);
    },
    oneOf(list) {
      return check(list.some((x) => deepEqual(x, actual)), `expected ${fmt(actual)} to be one of ${fmt(list)}`, `expected ${fmt(actual)} to not be one of ${fmt(list)}`);
    },
    throw() {
      let threw = false;
      try {
        actual();
      } catch {
        threw = true;
      }
      return check(threw, "expected function to throw", "expected function not to throw");
    },
  });
  a.an = a.a;
  a.contain = a.contains = a.includes = a.include;
  a.equals = a.eq = a.equal;
  a.eqls = a.eql;
  a.gt = a.greaterThan = a.above;
  a.lt = a.lessThan = a.below;
  a.gte = a.least;
  a.lte = a.most;
  a.length = a.lengthOf;
  a.members = (list) => check(Array.isArray(actual) && list.length === actual.length && list.every((x) => actual.some((y) => deepEqual(x, y))), `expected ${fmt(actual)} to have members ${fmt(list)}`, `expected ${fmt(actual)} to not have members ${fmt(list)}`);
  return a;
}
expect.fail = (msg) => {
  throw new AssertionError(msg || "expect.fail()");
};

// ---------- Variable scopes ----------

function varList(list, onChange) {
  const find = (k) => list.find((v) => v.key === k);
  return {
    get: (k) => {
      const v = find(k);
      return v && v.enabled !== false ? v.value : undefined;
    },
    has: (k) => !!find(k),
    set: (k, value) => {
      const str = typeof value === "string" ? value : JSON.stringify(value);
      const v = find(k);
      if (v) {
        v.value = str;
        v.enabled = true;
      } else list.push(kv(String(k), str));
      onChange();
    },
    unset: (k) => {
      const idx = list.findIndex((v) => v.key === k);
      if (idx >= 0) list.splice(idx, 1);
      onChange();
    },
    clear: () => {
      list.splice(0, list.length);
      onChange();
    },
    toObject: () => Object.fromEntries(list.filter((v) => v.enabled !== false).map((v) => [v.key, v.value])),
  };
}

// ---------- pm.request / pm.response ----------

function headerList(headers) {
  const idx = (k) => headers.findIndex((h) => h.key.toLowerCase() === String(k).toLowerCase());
  return {
    get: (k) => {
      const h = headers[idx(k)];
      return h && h.enabled !== false ? h.value : undefined;
    },
    has: (k) => idx(k) >= 0,
    add: ({ key, value }) => headers.push(kv(String(key), String(value))),
    upsert: ({ key, value }) => {
      const i = idx(key);
      if (i >= 0) Object.assign(headers[i], { value: String(value), enabled: true });
      else headers.push(kv(String(key), String(value)));
    },
    remove: (k) => {
      const i = idx(k);
      if (i >= 0) headers.splice(i, 1);
    },
    toObject: () => Object.fromEntries(headers.filter((h) => h.enabled !== false).map((h) => [h.key, h.value])),
    all: () => headers.map((h) => ({ key: h.key, value: h.value })),
  };
}

function requestApi(req) {
  return {
    get url() {
      return { toString: () => req.url, raw: req.url };
    },
    set url(v) {
      req.url = String(v);
    },
    get method() {
      return req.method;
    },
    set method(v) {
      req.method = String(v).toUpperCase();
    },
    headers: headerList(req.headers),
    body: {
      get raw() {
        return req.body.raw;
      },
      set raw(v) {
        req.body.raw = typeof v === "string" ? v : JSON.stringify(v);
      },
      get mode() {
        return req.body.mode;
      },
    },
    get name() {
      return req.name;
    },
  };
}

function responseApi(res) {
  let cachedJson;
  const api = {
    code: res.status,
    status: res.status_text,
    responseTime: res.time_ms,
    responseSize: res.body_size,
    headers: {
      get: (k) => headerValue(res.headers, k) ?? undefined,
      has: (k) => headerValue(res.headers, k) !== null,
      toObject: () => Object.fromEntries(res.headers),
      all: () => res.headers.map(([key, value]) => ({ key, value })),
    },
    text: () => res.body,
    json: () => {
      if (cachedJson === undefined) cachedJson = JSON.parse(res.body);
      return cachedJson;
    },
  };
  const fail = (msg) => {
    throw new AssertionError(msg);
  };
  const to = {
    have: {
      status: (s) =>
        typeof s === "number"
          ? res.status !== s && fail(`expected response to have status code ${s} but got ${res.status}`)
          : res.status_text !== s && fail(`expected response to have status reason '${s}' but got '${res.status_text}'`),
      header: (k, v) => {
        const got = headerValue(res.headers, k);
        if (got === null) fail(`expected response to have header '${k}'`);
        if (v !== undefined && got !== v) fail(`expected header '${k}' to be '${v}' but got '${got}'`);
      },
      body: (v) => {
        if (v === undefined) return !res.body && fail("expected response to have a body");
        if (v instanceof RegExp ? !v.test(res.body) : res.body !== v) fail(`expected response body to match ${fmt(v)}`);
      },
      jsonBody: (path) => {
        let obj;
        try {
          obj = api.json();
        } catch {
          fail("expected response body to be valid JSON");
        }
        if (path && path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj) === undefined) fail(`expected JSON body to have '${path}'`);
      },
    },
    be: {},
  };
  const statusGetter = (name, test, label) =>
    Object.defineProperty(to.be, name, { get: () => !test(res.status) && fail(`expected response to be ${label} but got ${res.status}`) });
  statusGetter("ok", (s) => s === 200, "200 OK");
  statusGetter("success", (s) => s >= 200 && s < 300, "2XX");
  statusGetter("redirection", (s) => s >= 300 && s < 400, "3XX");
  statusGetter("clientError", (s) => s >= 400 && s < 500, "4XX");
  statusGetter("serverError", (s) => s >= 500, "5XX");
  statusGetter("error", (s) => s >= 400, "4XX/5XX");
  statusGetter("notFound", (s) => s === 404, "404");
  Object.defineProperty(to.be, "json", { get: () => to.have.jsonBody() });
  api.to = to;
  return api;
}

// ---------- Runner ----------

const formatArg = (v) => {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

/**
 * Runs one script. `ctx`:
 *  - request: mutable request model (pre-request scripts may change it)
 *  - response: response from Rust (tests only)
 *  - environment / collection / globals: live objects, mutated by `set`
 *  - locals: Map for pm.variables.set
 *  - sendRequest(model): Promise<response> for pm.sendRequest
 * Returns { tests: [{name, passed, error}], logs: [{level, text}], error, changed }.
 */
export async function runScript(code, ctx, { eventName = "test", logs = [], tests = [] } = {}) {
  const result = { tests, logs, error: null, changed: false };
  if (!code || !code.trim()) return result;

  const changed = () => (result.changed = true);
  const envList = ctx.environment ? ctx.environment.values : [];
  const pending = [];
  const log = (level) => (...args) => logs.push({ level, text: args.map(formatArg).join(" ") });
  const consoleApi = { log: log("log"), info: log("info"), warn: log("warn"), error: log("error"), debug: log("log") };

  const scope = () => buildScope({ globals: ctx.globals, collection: ctx.collection, environment: ctx.environment, locals: ctx.locals });
  const environment = varList(envList, changed);
  if (!ctx.environment) {
    environment.set = (k) => consoleApi.warn(`pm.environment.set("${k}") ignorado: nenhum ambiente selecionado.`);
  }

  const pm = {
    info: { eventName, requestName: ctx.request?.name || "", iteration: ctx.iteration || 0 },
    environment: Object.assign(environment, { name: ctx.environment?.name || "" }),
    collectionVariables: varList(ctx.collection ? ctx.collection.variables : [], changed),
    globals: varList(ctx.globals || [], changed),
    variables: {
      get: (k) => scope().get(k)?.value,
      has: (k) => scope().has(k),
      set: (k, v) => ctx.locals.set(String(k), typeof v === "string" ? v : JSON.stringify(v)),
      unset: (k) => ctx.locals.delete(k),
      replaceIn: (s) => resolveVars(String(s), scope()),
      toObject: () => Object.fromEntries([...scope()].map(([k, v]) => [k, v.value])),
    },
    request: requestApi(ctx.request),
    response: ctx.response ? responseApi(ctx.response) : undefined,
    expect,
    test(name, fn) {
      const record = { name: String(name), passed: true, error: null };
      tests.push(record);
      try {
        const r = fn?.();
        if (r && typeof r.then === "function") {
          pending.push(
            r.catch((e) => {
              record.passed = false;
              record.error = e?.message || String(e);
            }),
          );
        }
      } catch (e) {
        record.passed = false;
        record.error = e?.message || String(e);
      }
    },
    sendRequest(req, callback) {
      const p = ctx.sendRequest(typeof req === "string" ? { url: req, method: "GET" } : req).then(
        (res) => {
          const api = responseApi(res);
          callback?.(null, api);
          return api;
        },
        (err) => {
          callback?.(err, null);
          throw err;
        },
      );
      pending.push(p.catch(() => {}));
      return p;
    },
  };
  pm.test.skip = (name) => tests.push({ name: String(name), passed: true, skipped: true, error: null });

  // Legacy Postman sandbox globals still common in old collections.
  const postman = {
    setEnvironmentVariable: (k, v) => pm.environment.set(k, v),
    getEnvironmentVariable: (k) => pm.environment.get(k),
    setGlobalVariable: (k, v) => pm.globals.set(k, v),
    getGlobalVariable: (k) => pm.globals.get(k),
  };

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("pm", "console", "postman", "expect", `"use strict";\nreturn (async () => {\n${code}\n})();`);
    await fn(pm, consoleApi, postman, expect);
    await Promise.all(pending);
  } catch (e) {
    result.error = `${e?.name || "Error"}: ${e?.message || e}`;
    logs.push({ level: "error", text: `Erro no script (${eventName === "prerequest" ? "pre-request" : "tests"}): ${result.error}` });
  }
  return result;
}

/** Ready-made snippets shown beside the script editor, like Postman's sidebar. */
export const SCRIPT_SNIPPETS = {
  pre: [
    { label: "Definir variável de ambiente", code: 'pm.environment.set("variavel", "valor");' },
    { label: "Definir variável da coleção", code: 'pm.collectionVariables.set("variavel", "valor");' },
    { label: "Timestamp atual", code: 'pm.variables.set("agora", Date.now().toString());' },
    { label: "Adicionar cabeçalho", code: 'pm.request.headers.upsert({ key: "X-Request-Id", value: crypto.randomUUID() });' },
    {
      label: "Buscar token antes",
      code: `const res = await pm.sendRequest({
  url: pm.variables.replaceIn("{{baseUrl}}/auth/token"),
  method: "POST",
  header: { "Content-Type": "application/json" },
  body: { mode: "raw", raw: JSON.stringify({ user: "admin", password: "123" }) },
});
pm.environment.set("token", res.json().access_token);`,
    },
  ],
  test: [
    { label: "Status code é 200", code: 'pm.test("Status code é 200", () => {\n  pm.response.to.have.status(200);\n});' },
    { label: "Tempo de resposta < 500ms", code: 'pm.test("Tempo de resposta < 500ms", () => {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});' },
    { label: "Corpo contém texto", code: 'pm.test("Corpo contém texto", () => {\n  pm.expect(pm.response.text()).to.include("texto");\n});' },
    { label: "Verificar valor no JSON", code: 'pm.test("Valor do JSON", () => {\n  const json = pm.response.json();\n  pm.expect(json.id).to.eql(1);\n});' },
    { label: "Cabeçalho Content-Type", code: 'pm.test("Content-Type presente", () => {\n  pm.response.to.have.header("Content-Type");\n});' },
    { label: "Salvar valor do JSON em variável", code: 'const json = pm.response.json();\npm.environment.set("token", json.token);' },
    { label: "Status 2XX", code: 'pm.test("Requisição bem-sucedida", () => {\n  pm.response.to.be.success;\n});' },
  ],
};
