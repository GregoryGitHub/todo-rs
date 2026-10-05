import { el, icon } from "../utils/dom.js";
import { escapeHtml } from "../utils/noteContent.js";
import { NULL_KEY } from "../utils/gridModel.js";

// Popup "Filtro local" de uma coluna do DataGrid (como o "Local Filter" do DataGrip):
// valores distintos com contagem, busca e caixas de seleção. Aplica a cada clique.
// Como no DataGrip: nada marcado (o padrão) ou tudo marcado = sem filtro; marcar valores filtra por eles.
// Só enxerga as linhas carregadas: com `server`, o texto buscado também pode virar um filtro no
// servidor (WHERE / filtro do MongoDB), para achar valores fora da página atual.

const ITEM_H = 22;
const LIST_H = 264;

/**
 * items: [{ key, value, count }] (GridModel.distinct); selected: Set de chaves ou null (sem filtro: nada marcado).
 * onChange(Set | null) aplica o filtro e devolve o total de linhas visíveis.
 * server: { run(text, mode: "eq" | "contains") } busca o texto no servidor (fecha o popup).
 */
export function openFilterPopup({ host, x, y, title, items, selected, onChange, server = null }) {
  const allKeys = items.map((i) => i.key);
  let checked = new Set(selected ?? []);
  let shown = items;
  let matches = 0;

  const search = el("input.dg-pop-search", { type: "search", placeholder: "Buscar valores", autocomplete: "off", spellcheck: false });
  const allBox = el("input", { type: "checkbox" });
  const list = el("div.dg-pop-list", { style: `height:${LIST_H}px` });
  const sizer = el("div.dg-pop-sizer");
  const win = el("div.dg-pop-win");
  sizer.append(win);
  list.append(sizer);
  const footer = el("span.dg-pop-count");
  const clearBtn = el("button.dg-pop-link", { type: "button", onclick: () => setChecked(new Set()) }, "Limpar filtro");
  const empty = el("div.dg-pop-empty", { hidden: true });
  const eqBtn = el("button.dg-pop-server-btn", { type: "button", onclick: () => runServer("eq") });
  const likeBtn = el("button.dg-pop-server-btn", { type: "button", onclick: () => runServer("contains") });
  const serverBox = el(
    "div.dg-pop-server",
    { hidden: true },
    el("span.dg-pop-server-label", {}, icon("fa-solid fa-server"), "Buscar no servidor"),
    eqBtn,
    likeBtn,
  );

  const pop = el(
    "div.dg-pop.dg-filter",
    { role: "dialog" },
    el("div.dg-pop-title", {}, title),
    el("label.dg-pop-searchbox", {}, icon("fa-solid fa-magnifying-glass"), search),
    serverBox,
    el("div.dg-pop-head", {}, el("label", {}, allBox, el("span", {}, "Valor")), el("span", {}, "Qtde")),
    list,
    empty,
    el("div.dg-pop-foot", {}, footer, clearBtn),
  );

  function label(item) {
    if (item.key === NULL_KEY) return '<span class="dg-null">&lt;null&gt;</span>';
    const s = item.key.length > 200 ? item.key.slice(0, 200) + "…" : item.key;
    return s ? escapeHtml(s.replace(/\r?\n/g, " ↵ ")) : '<span class="dg-null">(vazio)</span>';
  }

  function paint() {
    sizer.style.height = `${shown.length * ITEM_H}px`;
    const first = Math.max(0, Math.floor(list.scrollTop / ITEM_H) - 5);
    const last = Math.min(shown.length, Math.ceil((list.scrollTop + LIST_H) / ITEM_H) + 5);
    win.style.transform = `translateY(${first * ITEM_H}px)`;
    let html = "";
    for (let i = first; i < last; i++) {
      const it = shown[i];
      html += `<label class="dg-pop-item" data-i="${i}"><input type="checkbox"${checked.has(it.key) ? " checked" : ""}><span class="dg-pop-val">${label(it)}</span><span class="dg-pop-n">${it.count}</span></label>`;
    }
    win.innerHTML = html;
    const shownChecked = shown.filter((i) => checked.has(i.key)).length;
    allBox.checked = shown.length > 0 && shownChecked === shown.length;
    allBox.indeterminate = shownChecked > 0 && shownChecked < shown.length;
    footer.textContent = `Linhas visíveis: ${matches.toLocaleString("pt-BR")}`;
    clearBtn.hidden = checked.size === 0 || checked.size === allKeys.length;
    paintServer();
  }

  function paintServer() {
    const q = search.value.trim();
    const none = !!q && !shown.length;
    list.hidden = none;
    empty.hidden = !none;
    empty.textContent = server
      ? "Nenhum valor nas linhas carregadas. Enter busca no servidor."
      : "Nenhum valor nas linhas carregadas.";
    serverBox.hidden = !server || !q;
    if (serverBox.hidden) return;
    const short = q.length > 28 ? q.slice(0, 28) + "…" : q;
    eqBtn.textContent = `= "${short}"`;
    eqBtn.title = `Filtrar no servidor: igual a "${q}"${none ? " (Enter)" : ""}`;
    likeBtn.textContent = `contém "${short}"`;
    likeBtn.title = `Filtrar no servidor: contém "${q}"`;
    eqBtn.classList.toggle("primary", none);
  }

  function runServer(mode) {
    const q = search.value.trim();
    if (!server || !q) return;
    close();
    server.run(q, mode);
  }

  function setChecked(next) {
    checked = next;
    const all = checked.size === 0 || checked.size === allKeys.length;
    matches = onChange(all ? null : new Set(checked));
    paint();
  }

  list.addEventListener("scroll", paint, { passive: true });
  win.addEventListener("click", (e) => {
    const row = e.target.closest(".dg-pop-item");
    if (!row) return;
    e.preventDefault();
    const it = shown[Number(row.dataset.i)];
    const next = new Set(checked);
    // Alt+clique: só este valor.
    if (e.altKey) setChecked(new Set([it.key]));
    else {
      if (next.has(it.key)) next.delete(it.key);
      else next.add(it.key);
      setChecked(next);
    }
  });
  allBox.addEventListener("change", () => {
    const next = new Set(checked);
    for (const it of shown) {
      if (allBox.checked) next.add(it.key);
      else next.delete(it.key);
    }
    setChecked(next);
  });
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    shown = q ? items.filter((i) => (i.key === NULL_KEY ? "<null>" : i.key).toLowerCase().includes(q)) : items;
    list.scrollTop = 0;
    paint();
  });
  search.addEventListener("keydown", (e) => {
    // Enter com busca: mantém só os valores encontrados; sem nenhum, busca no servidor.
    if (e.key !== "Enter" || !search.value.trim()) return;
    if (shown.length) setChecked(new Set(shown.map((i) => i.key)));
    else runServer("eq");
  });

  host.append(pop);
  const hostRect = host.getBoundingClientRect();
  const left = Math.min(x - hostRect.left, hostRect.width - pop.offsetWidth - 8);
  const top = Math.min(y - hostRect.top, hostRect.height - pop.offsetHeight - 8);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${Math.max(8, top)}px`;

  matches = onChange(selected ? new Set(selected) : null);
  paint();
  search.focus();

  function close() {
    pop.remove();
    document.removeEventListener("mousedown", outside, true);
    document.removeEventListener("keydown", onKey, true);
  }
  function outside(e) {
    if (!pop.contains(e.target)) close();
  }
  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }
  document.addEventListener("mousedown", outside, true);
  document.addEventListener("keydown", onKey, true);
  return close;
}
