export function getTodayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateLabel(dateStr) {
  if (!dateStr) return "";
  const today = getTodayStr();
  const tomorrow = getTomorrowStr();
  if (dateStr === today) return "Hoje";
  if (dateStr === tomorrow) return "Amanhã";

  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function daysAgo(ts) {
  return Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY_MS);
}

/** Data curta da lista de notas, como no app Notas: "16:40", "Ontem", "segunda-feira", "01/10/2026". */
export function formatNoteListDate(ts) {
  const diff = daysAgo(ts);
  const d = new Date(ts);
  if (diff <= 0) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return "Ontem";
  if (diff < 7) return d.toLocaleDateString("pt-BR", { weekday: "long" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Data exibida no topo do editor: "1 de outubro de 2026 às 16:40". */
export function formatNoteFullDate(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} às ${time}`;
}

/** Seção da lista de notas: "Hoje", "Ontem", "7 Dias Anteriores", "30 Dias Anteriores", "outubro de 2026"... */
export function noteGroupLabel(ts) {
  const diff = daysAgo(ts);
  if (diff <= 0) return "Hoje";
  if (diff === 1) return "Ontem";
  if (diff < 7) return "7 Dias Anteriores";
  if (diff < 30) return "30 Dias Anteriores";
  const d = new Date(ts);
  if (d.getFullYear() === new Date().getFullYear()) {
    const month = d.toLocaleDateString("pt-BR", { month: "long" });
    return month.charAt(0).toUpperCase() + month.slice(1);
  }
  return String(d.getFullYear());
}

/** "YYYY-MM-DD" → Date local (meia-noite). */
export function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Soma `n` dias a uma data "YYYY-MM-DD". */
export function addDays(dateStr, n) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** "Hoje", "Amanhã", "Ontem" ou "sex., 10 de out." (com ano se não for o atual). */
export function formatDayLabel(dateStr) {
  const today = getTodayStr();
  if (dateStr === today) return "Hoje";
  if (dateStr === addDays(today, 1)) return "Amanhã";
  if (dateStr === addDays(today, -1)) return "Ontem";
  const d = parseDateStr(dateStr);
  const opts = { weekday: "short", day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  const label = d.toLocaleDateString("pt-BR", opts);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "quinta-feira, 2 de outubro" */
export function formatLongDate(dateStr) {
  const label = parseDateStr(dateStr).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
