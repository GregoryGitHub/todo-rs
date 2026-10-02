// Dialetos SQL usados pelo cliente de banco (quoting, literais, paginação).
// O backend informa o dialeto da conexão (ServerInfo.dialect); um banco novo só precisa de
// um objeto com a mesma interface aqui e de um driver em src-tauri/src/db/.

/** Marcadores de célula sem valor literal (linhas novas do grid). */
export const DEFAULT = Object.freeze({ toString: () => "<default>", __db: "default" });
export const GENERATED = Object.freeze({ toString: () => "<generated>", __db: "generated" });
export const isMarker = (v) => v === DEFAULT || v === GENERATED;

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const HEX_RE = /^0x[0-9a-fA-F]*$/;

export const mssql = {
  name: "mssql",

  quote(ident) {
    return `[${String(ident).replace(/]/g, "]]")}]`;
  },

  qualified(schema, name) {
    return schema ? `${this.quote(schema)}.${this.quote(name)}` : this.quote(name);
  },

  string(s) {
    return `N'${String(s).replace(/'/g, "''")}'`;
  },

  /** Literal SQL para um valor do grid conforme a classe da coluna (ColumnMeta.kind). */
  literal(value, kind = "str") {
    if (value === null || value === undefined) return "NULL";
    if (value === DEFAULT) return "DEFAULT";
    if (typeof value === "boolean") return value ? "1" : "0";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
    const s = String(value);
    switch (kind) {
      case "int":
      case "num":
      case "dec":
        return NUMBER_RE.test(s.trim()) ? s.trim() : this.string(s);
      case "bool":
        if (/^(1|true)$/i.test(s.trim())) return "1";
        if (/^(0|false)$/i.test(s.trim())) return "0";
        return this.string(s);
      case "bin":
        return HEX_RE.test(s.trim()) ? s.trim() : this.string(s);
      case "date":
      case "time":
      case "datetime":
      case "guid":
        return `'${s.replace(/'/g, "''")}'`;
      default:
        return this.string(s);
    }
  },

  /** SELECT paginado de uma tabela, no formato que o DataGrip registra no log. */
  selectPage({ schema, name, where = "", orderBy = "", offset = 0, limit = 500 }) {
    const lines = [`SELECT t.*`, `FROM ${this.qualified(schema, name)} t`];
    if (where.trim()) lines.push(`WHERE ${where.trim()}`);
    lines.push(`ORDER BY ${orderBy.trim() || "( SELECT NULL )"}`);
    lines.push(`OFFSET ${offset} ROWS FETCH NEXT ${limit + 1} ROWS ONLY`);
    return lines.join("\n");
  },

  count({ schema, name, where = "" }) {
    return `SELECT COUNT_BIG(*) FROM ${this.qualified(schema, name)} t${where.trim() ? ` WHERE ${where.trim()}` : ""}`;
  },

  selectTop({ schema, name, limit = 1000 }) {
    return `SELECT TOP (${limit}) *\nFROM ${this.qualified(schema, name)}`;
  },

  /** Comando para executar uma procedure com os parâmetros listados. */
  execProcedure({ schema, name, params = [] }) {
    const args = params.filter((p) => p.name.startsWith("@")).map((p) => `${p.name} = NULL${/OUTPUT/.test(p.detail) ? " OUTPUT" : ""}`);
    return `EXEC ${this.qualified(schema, name)}${args.length ? "\n    " + args.join(",\n    ") : ""}`;
  },
};

const DIALECTS = { mssql };

export function dialectFor(name) {
  return DIALECTS[name] || mssql;
}
