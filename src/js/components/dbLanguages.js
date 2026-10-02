import { isMongo } from "../utils/dbModel.js";
import { splitBatches, statementAt, isReadOnlyQuery, isWriteStatement } from "../utils/sqlSplit.js";
import { parseCommand, splitMongo, mongoStatementAt, MongoSyntaxError } from "../utils/mongoShell.js";
import { attachSqlComplete, attachMongoComplete } from "./sqlComplete.js";

// Linguagem do console por tipo de conexão. O console (dbConsole.js) só conhece esta interface:
//   units(text, selStart, selEnd, mode) → [{ payload, display, start?, end?, repeat, write, readOnly, local?, error? }]
//   attachComplete(editor, { getSource, dialect }) → { isOpen(), destroy() }
// payload = texto enviado ao backend; display = o que aparece na Saída e no log.

export const sqlLanguage = {
  id: "sql",
  editorLang: "sql",
  logLang: "sql",
  indent: "    ",
  placeholder: "SELECT * FROM ...   (Ctrl+Enter executa o comando sob o cursor)",
  supportsTx: true,
  rowsWord: "linha(s)",
  units(text, s, e, mode) {
    const toUnit = (b) => ({ payload: b.sql, display: b.sql, start: b.start, end: b.end, repeat: b.repeat || 1, write: isWriteStatement(b.sql), readOnly: isReadOnlyQuery(b.sql) });
    if (s !== e) return splitBatches(text.slice(s, e)).map((b) => ({ ...toUnit(b), start: undefined, end: undefined }));
    if (mode === "all") return splitBatches(text).map(toUnit);
    const st = statementAt(text, s);
    return st ? [toUnit({ ...st, repeat: 1 })] : [];
  },
  attachComplete: (editor, opts) => attachSqlComplete(editor, opts),
};

const READ_OPS = new Set(["find", "aggregate", "countDocuments", "estimatedDocumentCount", "distinct", "getIndexes", "listCollections", "listDatabases"]);

/** Linha:coluna de uma posição, para mensagens de erro de sintaxe. */
function lineCol(text, pos) {
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  return `linha ${line}, coluna ${pos - before.lastIndexOf("\n")}`;
}

export const mongoLanguage = {
  id: "mongo",
  editorLang: "javascript",
  logLang: "javascript",
  indent: "  ",
  placeholder: "db.colecao.find({ status: 'ativo' }).sort({ criado: -1 })   (Ctrl+Enter executa o comando sob o cursor)",
  supportsTx: false,
  rowsWord: "documento(s)",
  units(text, s, e, mode) {
    const toUnit = (st, offset = 0) => {
      const base = { display: st.text, start: offset ? undefined : st.start, end: offset ? undefined : st.end, repeat: 1 };
      try {
        const cmd = parseCommand(st.text);
        if (cmd.kind === "use") return { ...base, local: { use: cmd.db }, write: false, readOnly: true };
        return { ...base, payload: JSON.stringify(cmd.op), write: cmd.write, readOnly: READ_OPS.has(cmd.op.op) && !cmd.write, op: cmd.op };
      } catch (err) {
        const where = err instanceof MongoSyntaxError ? ` (${lineCol(st.text, err.pos)})` : "";
        return { ...base, error: `${err.message}${where}` };
      }
    };
    if (s !== e) return splitMongo(text.slice(s, e)).map((st) => toUnit(st, 1));
    if (mode === "all") return splitMongo(text).map((st) => toUnit(st));
    const st = mongoStatementAt(text, s);
    return st ? [toUnit(st)] : [];
  },
  attachComplete: (editor, opts) => attachMongoComplete(editor, opts),
};

export const languageFor = (conn) => (isMongo(conn) ? mongoLanguage : sqlLanguage);
