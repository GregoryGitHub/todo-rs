import { state } from "../state.js";
import { getTodayStr, addDays, formatDayLabel, formatLongDate, formatTime } from "../utils/date.js";
import { saveTodosApi } from "../api.js";
import { el, icon } from "../utils/dom.js";
import { openPomodoroModal, pausePomodoroTimer } from "./pomodoro.js";
import { openRescheduleModal } from "./reschedule.js";
import { enterDesktopMode, exitDesktopMode, minimizeWindow, toggleMaximize } from "./windowMode.js";

// Tarefas no mesmo layout das Notas/HTTP:
//  - bandeja: lista (com seletor Meu Dia/Pendentes/Histórico) → detalhe, em pilha
//  - desktop: listas | tarefas | detalhe (o detalhe só aparece com uma tarefa selecionada)

const ui = state.tasksUI;

const SCOPES = [
  { id: "my_day", label: "Meu Dia", icon: "fa-solid fa-sun" },
  { id: "pending", label: "Pendentes", icon: "fa-solid fa-inbox" },
  { id: "all", label: "Histórico", icon: "fa-solid fa-clock-rotate-left" },
];

const appEl = document.getElementById("tasks-app");
const listEl = document.getElementById("tk-list");
const detailEl = document.getElementById("tk-detail");
const scopesEl = document.getElementById("tk-scopes");
const segEl = document.getElementById("tk-seg");
const formEl = document.getElementById("new-todo");
const inputEl = document.getElementById("input");
const searchEl = document.getElementById("tk-search");
const titleIconEl = document.getElementById("tk-title-icon");
const titleTextEl = document.getElementById("tk-title-text");
const subtitleEl = document.getElementById("tk-subtitle");
const tbTitleEl = document.getElementById("tk-tb-title");
const tbCountEl = document.getElementById("tk-tb-count");
const backLabelEl = document.getElementById("tk-back-label");
const toastEl = el("div.hx-toast", { hidden: true });
appEl.append(toastEl);

let saveTimer = null;
let toastTimer = null;
let poppedId = null; // tarefa recém-concluída (animação do círculo)

// ---------- Dados ----------

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

/** Grava agora o que estiver pendente (navegação, blur...). Sem edição pendente, não faz nada. */
function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  saveTodosApi(state.todos);
}

const scopeOf = (id) => SCOPES.find((s) => s.id === id) || SCOPES[0];
const selectedTodo = () => state.todos.find((t) => t.id === ui.selectedId) || null;
const isPomoRunning = (t) => state.pomoState.isRunning && state.pomoState.taskId === t.id;

/** Regras de negócio de cada lista (ver AGENTS.md). */
function inScope(t, scope, today) {
  if (scope === "my_day") {
    if (!t.done) return t.is_my_day || t.date === today;
    return t.date === today && (t.completed_date || t.date) === today;
  }
  if (scope === "pending") return !t.done;
  return true;
}

function scopeTodos(scope = state.currentView) {
  const today = getTodayStr();
  return state.todos.filter((t) => inScope(t, scope, today));
}

function visibleTodos() {
  const q = ui.query.trim().toLowerCase();
  const todos = scopeTodos();
  return q ? todos.filter((t) => t.text.toLowerCase().includes(q) || (t.note || "").toLowerCase().includes(q)) : todos;
}

const byDateThenId = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);

/** Grupos exibidos na lista para o escopo atual. */
function groups(todos) {
  const today = getTodayStr();
  const pending = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  if (state.currentView === "my_day") {
    return [
      { key: "pending", label: null, items: pending.sort(byDateThenId) },
      { key: "done", label: "Concluídas", items: done, collapsible: true },
    ];
  }

  if (state.currentView === "pending") {
    const out = [{ key: "overdue", label: "Atrasadas", tone: "danger", items: [] }];
    const byDate = new Map();
    for (const t of pending.sort(byDateThenId)) {
      if (t.date < today) out[0].items.push(t);
      else {
        if (!byDate.has(t.date)) byDate.set(t.date, []);
        byDate.get(t.date).push(t);
      }
    }
    for (const [date, items] of byDate) out.push({ key: date, label: formatDayLabel(date), items });
    return out;
  }

  // Histórico: por data agendada, mais recente primeiro; pendentes antes das concluídas.
  const byDate = new Map();
  for (const t of todos) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => ({
      key: date,
      label: formatDayLabel(date),
      items: items.sort((a, b) => a.done - b.done || a.id - b.id),
    }));
}

// ---------- Ações ----------

function toggleDone(todo) {
  todo.done = !todo.done;
  if (todo.done) {
    todo.completed_date = getTodayStr();
    if (state.pomoState.taskId === todo.id) pausePomodoroTimer();
    poppedId = todo.id;
  } else {
    delete todo.completed_date;
  }
  saveTodosApi(state.todos);
  renderTasks();
}

function deleteTodo(todo) {
  if (!todo) return;
  if (state.pomoState.taskId === todo.id) {
    pausePomodoroTimer();
    state.pomoState.taskId = null;
  }
  const index = state.todos.indexOf(todo);
  state.todos.splice(index, 1);
  if (ui.selectedId === todo.id) {
    ui.selectedId = null;
    ui.pane = "list";
  }
  saveTodosApi(state.todos);
  renderTasks();
  toast(`“${todo.text.length > 32 ? todo.text.slice(0, 32) + "…" : todo.text}” excluída`, {
    label: "Desfazer",
    run: () => {
      state.todos.splice(Math.min(index, state.todos.length), 0, todo);
      saveTodosApi(state.todos);
      renderTasks();
    },
  });
}

function addTodo(text) {
  const today = getTodayStr();
  const todo = { id: Date.now(), text, done: false, date: today, is_my_day: state.currentView === "my_day", note: "" };
  state.todos.push(todo);
  saveTodosApi(state.todos);
  renderTasks();
  listEl.querySelector(`.tk-item[data-id="${todo.id}"]`)?.scrollIntoView({ block: "nearest" });
}

function select(id, { open = true } = {}) {
  ui.selectedId = id;
  if (open && !state.desktopMode) ui.pane = "editor";
  renderTasks();
}

function setScope(scope) {
  if (state.currentView === scope) return;
  state.currentView = scope;
  if (state.desktopMode && ui.selectedId !== null && !visibleTodos().some((t) => t.id === ui.selectedId)) ui.selectedId = null;
  renderTasks();
  listEl.scrollTop = 0;
}

function toast(message, action = null) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = "";
  toastEl.append(el("span", {}, message));
  if (action) {
    toastEl.append(el("button", { type: "button", onclick: () => ((toastEl.hidden = true), action.run()) }, action.label));
  }
  toastEl.hidden = false;
  toastTimer = setTimeout(() => (toastEl.hidden = true), action ? 6000 : 2500);
}

/** Troca o texto da tarefa por um campo inline. Enter/blur salva, Esc cancela. */
function startEditing(todo, textEl) {
  const row = textEl.closest(".tk-item");
  if (row.classList.contains("editing")) return;
  row.classList.add("editing");
  const input = el("input.tk-edit-input", { type: "text", value: todo.text, maxLength: 200, "aria-label": "Editar tarefa" });
  textEl.replaceWith(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const text = input.value.trim();
    if (save && text && text !== todo.text) {
      todo.text = text;
      saveTodosApi(state.todos);
    }
    renderTasks();
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("blur", () => finish(true));
}

// ---------- Render: lista ----------

function checkButton(todo, big = false) {
  const btn = el(
    `button.tk-check${big ? ".big" : ""}${todo.done ? ".checked" : ""}${poppedId === todo.id ? ".pop" : ""}`,
    {
      type: "button",
      title: todo.done ? "Marcar como pendente" : "Concluir",
      "aria-label": todo.done ? "Marcar como pendente" : "Concluir",
      onclick: (e) => {
        e.stopPropagation();
        toggleDone(todo);
      },
    },
    el("span.tk-circle", {}, icon("fa-solid fa-check")),
  );
  return btn;
}

function pomoTimeText() {
  const label = state.pomoState.mode === "work" ? "Foco" : "Pausa";
  return `${label} · ${formatTime(state.pomoState.secondsRemaining)}`;
}

function itemMeta(todo, today) {
  const meta = [];
  const scope = state.currentView;
  if (isPomoRunning(todo)) meta.push(el("span.tk-meta.tk-meta-pomo", {}, icon("fa-solid fa-stopwatch"), el("span.tk-pomo-time", {}, pomoTimeText())));
  if (scope !== "my_day" && !todo.done && (todo.is_my_day || todo.date === today)) meta.push(el("span.tk-meta.tk-meta-sun", {}, icon("fa-solid fa-sun"), "Meu Dia"));
  const overdue = !todo.done && todo.date < today;
  const showDate = todo.date !== today && (scope === "my_day" || (scope === "pending" && overdue));
  if (showDate) meta.push(el(`span.tk-meta${overdue ? ".overdue" : ""}`, {}, icon("fa-regular fa-calendar"), formatDayLabel(todo.date)));
  if (todo.done && todo.completed_date && todo.completed_date !== todo.date && scope === "all") {
    meta.push(el("span.tk-meta", {}, icon("fa-solid fa-check-double"), `Concluída ${formatDayLabel(todo.completed_date).toLowerCase()}`));
  }
  if (todo.note?.trim()) meta.push(el("span.tk-meta", { title: todo.note }, icon("fa-regular fa-note-sticky"), "Anotação"));
  return meta;
}

function itemEl(todo, today) {
  const textEl = el("div.tk-item-text", { title: state.desktopMode ? "Clique duas vezes para editar" : null }, todo.text);
  textEl.addEventListener("dblclick", (e) => {
    if (!state.desktopMode) return;
    e.stopPropagation();
    startEditing(todo, textEl);
  });
  const meta = itemMeta(todo, today);
  const actions = el("div.tk-item-actions");
  if (!todo.done) {
    actions.append(
      el("button.tk-act" + (isPomoRunning(todo) ? ".active" : ""), {
        type: "button",
        title: "Timer Pomodoro",
        onclick: (e) => (e.stopPropagation(), openPomodoroModal(todo)),
      }, icon(isPomoRunning(todo) ? "fa-solid fa-stopwatch" : "fa-regular fa-clock")),
    );
  }
  actions.append(
    el("button.tk-act.danger.desktop-only", { type: "button", title: "Excluir tarefa", onclick: (e) => (e.stopPropagation(), deleteTodo(todo)) }, icon("fa-regular fa-trash-can")),
    el("i.fa-solid.fa-chevron-right.tk-chevron.compact-only"),
  );
  const row = el(
    "div.tk-item",
    { dataset: { id: todo.id }, onclick: () => select(todo.id) },
    checkButton(todo),
    el("div.tk-item-main", {}, textEl, meta.length ? el("div.tk-item-meta", {}, meta) : null),
    actions,
  );
  row.classList.toggle("done", todo.done);
  row.classList.toggle("selected", todo.id === ui.selectedId);
  row.classList.toggle("overdue", !todo.done && todo.date < today);
  return row;
}

const EMPTY = {
  my_day: { icon: "fa-solid fa-sun", text: "Sem tarefas para hoje. Bora produzir!" },
  pending: { icon: "fa-solid fa-mug-hot", text: "Tudo em dia! Nenhuma tarefa pendente." },
  all: { icon: "fa-solid fa-clock-rotate-left", text: "Nenhuma tarefa ainda." },
};

function renderList() {
  const today = getTodayStr();
  const todos = visibleTodos();
  listEl.innerHTML = "";

  if (!todos.length) {
    const empty = ui.query.trim() ? { icon: "fa-solid fa-magnifying-glass", text: "Nenhuma tarefa encontrada." } : EMPTY[state.currentView];
    listEl.append(el("div.tk-empty", {}, icon(empty.icon), el("span", {}, empty.text)));
  }

  for (const g of groups(todos)) {
    if (!g.items.length) continue;
    const collapsed = g.collapsible && ui.doneCollapsed;
    if (g.label) {
      const label = el(
        `div.nt-group-label.tk-group-label${g.tone ? `.tone-${g.tone}` : ""}${g.collapsible ? ".collapsible" : ""}`,
        { onclick: g.collapsible ? () => ((ui.doneCollapsed = !ui.doneCollapsed), renderList()) : null },
        g.collapsible ? icon(`fa-solid fa-chevron-${collapsed ? "right" : "down"} tk-group-caret`) : null,
        el("span", {}, g.label),
        el("span.tk-group-count", {}, g.items.length),
      );
      listEl.append(label);
    }
    if (collapsed) continue;
    const box = el("div.nt-group.tk-group");
    for (const t of g.items) box.append(itemEl(t, today));
    listEl.append(box);
  }
  poppedId = null;
}

// ---------- Render: chrome ----------

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function renderChrome() {
  const scope = scopeOf(state.currentView);
  const today = getTodayStr();
  const todos = scopeTodos();
  const pending = todos.filter((t) => !t.done).length;

  titleIconEl.className = scope.icon;
  titleTextEl.textContent = scope.label;
  backLabelEl.textContent = scope.label;
  tbTitleEl.textContent = scope.label;
  if (state.currentView === "my_day") subtitleEl.textContent = formatLongDate(today);
  else if (state.currentView === "pending") {
    const overdue = todos.filter((t) => t.date < today).length;
    subtitleEl.textContent = plural(pending, "pendente", "pendentes") + (overdue ? ` · ${plural(overdue, "atrasada", "atrasadas")}` : "");
  } else {
    subtitleEl.textContent = `${plural(todos.length, "tarefa", "tarefas")} · ${plural(todos.length - pending, "concluída", "concluídas")}`;
  }
  tbCountEl.textContent = state.currentView === "my_day" ? `${plural(pending, "pendente", "pendentes")} · ${formatLongDate(today)}` : subtitleEl.textContent;

  // Seletor (bandeja) e barra lateral (desktop)
  segEl.innerHTML = "";
  scopesEl.innerHTML = "";
  for (const s of SCOPES) {
    const count = scopeTodos(s.id).filter((t) => !t.done).length;
    const segBtn = el("button", { type: "button", onclick: () => setScope(s.id) }, icon(s.icon), el("span", {}, s.label));
    segBtn.classList.toggle("active", s.id === state.currentView);
    segEl.append(segBtn);

    const li = el(
      "li.nt-folder",
      { onclick: () => setScope(s.id) },
      el("i", { class: `${s.icon} nt-folder-icon` }),
      el("span.nt-folder-name", {}, s.label),
      el("span.nt-folder-count", {}, s.id === "all" ? scopeTodos("all").length : count || ""),
    );
    li.classList.toggle("active", s.id === state.currentView);
    scopesEl.append(li);
  }

  appEl.classList.toggle("sidebar-hidden", state.desktopMode && ui.sidebarHidden);
  appEl.dataset.pane = ui.pane;
  appEl.classList.toggle("has-detail", !!selectedTodo());
  document.body.classList.toggle("tasks-editing", !state.desktopMode && ui.pane === "editor" && state.activeMainView === "tasks");
}

// ---------- Render: detalhe ----------

function autoGrow(ta) {
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
}

function detailRow({ iconCls, label, sub = null, on = false, onclick, trailing = null, disabled = false, title = null }) {
  return el(
    `button.tk-d-row${on ? ".on" : ""}`,
    { type: "button", onclick, disabled, title },
    icon(`${iconCls} tk-d-row-icon`),
    el("span.tk-d-row-text", {}, el("span", {}, label), sub ? el("small", {}, sub) : null),
    trailing,
  );
}

function createdLabel(todo) {
  // ids são Date.now() da criação
  if (todo.id < 1e12) return null;
  return new Date(todo.id).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
}

function renderDetail() {
  const todo = selectedTodo();
  detailEl.innerHTML = "";
  delete detailEl.dataset.id;
  if (!todo) {
    if (!state.desktopMode && ui.pane === "editor") ui.pane = "list";
    return;
  }
  // Na bandeja o detalhe só é montado quando está na tela.
  if (!state.desktopMode && ui.pane !== "editor") return;
  detailEl.dataset.id = todo.id;
  const today = getTodayStr();

  // Título
  const title = el("textarea.tk-d-title", { rows: 1, maxLength: 200, spellcheck: true, "aria-label": "Título da tarefa" });
  title.value = todo.text;
  title.addEventListener("input", () => {
    autoGrow(title);
    const text = title.value.replace(/\n/g, " ").trim();
    if (text) {
      todo.text = text;
      saveSoon();
      const row = listEl.querySelector(`.tk-item[data-id="${todo.id}"] .tk-item-text`);
      if (row) row.textContent = text;
    }
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      title.blur();
    }
  });
  title.addEventListener("blur", () => {
    if (!title.value.trim()) title.value = todo.text;
    flushSave();
  });

  const head = el(
    "div.tk-d-head",
    {},
    checkButton(todo, true),
    title,
    el("button.nt-icon-btn.desktop-only", { type: "button", title: "Fechar detalhe (Esc)", onclick: () => select(null) }, icon("fa-solid fa-xmark")),
  );
  head.classList.toggle("done", todo.done);

  // Meu Dia
  const inMyDay = todo.is_my_day || todo.date === today;
  const myDay = detailRow({
    iconCls: "fa-solid fa-sun",
    label: inMyDay ? "Adicionada ao Meu Dia" : "Adicionar ao Meu Dia",
    sub: inMyDay && todo.date === today && !todo.is_my_day ? "Agendada para hoje" : null,
    on: inMyDay,
    disabled: todo.done,
    title: inMyDay && todo.date === today ? "Tarefas agendadas para hoje sempre aparecem no Meu Dia" : null,
    onclick: () => {
      if (inMyDay && todo.date === today) return;
      todo.is_my_day = !todo.is_my_day;
      saveTodosApi(state.todos);
      renderTasks();
    },
    trailing: inMyDay && todo.date !== today ? icon("fa-solid fa-xmark tk-d-row-end") : null,
  });

  // Data
  const dateInput = el("input.tk-d-date", { type: "date", value: todo.date, disabled: todo.done });
  dateInput.addEventListener("change", () => {
    if (!dateInput.value) return (dateInput.value = todo.date);
    todo.date = dateInput.value;
    saveTodosApi(state.todos);
    renderTasks();
  });
  const chip = (label, date) =>
    el(`button.tk-chip${todo.date === date ? ".active" : ""}`, {
      type: "button",
      disabled: todo.done,
      onclick: () => {
        todo.date = date;
        saveTodosApi(state.todos);
        renderTasks();
      },
    }, label);
  const overdue = !todo.done && todo.date < today;
  const dateCard = el(
    "div.tk-d-card",
    {},
    el(
      "label.tk-d-row.static",
      {},
      icon(`fa-regular fa-calendar tk-d-row-icon${overdue ? " overdue" : ""}`),
      el("span.tk-d-row-text", {}, el("span", {}, "Data"), el("small", { class: overdue ? "overdue" : "" }, overdue ? `Atrasada · ${formatDayLabel(todo.date)}` : formatDayLabel(todo.date))),
      dateInput,
    ),
    el("div.tk-chips", {}, chip("Hoje", today), chip("Amanhã", addDays(today, 1)), chip("Próx. semana", addDays(today, 7))),
  );

  // Pomodoro
  const running = isPomoRunning(todo);
  const pomo = todo.done
    ? null
    : el(
        "div.tk-d-card",
        {},
        detailRow({
          iconCls: running ? "fa-solid fa-stopwatch" : "fa-regular fa-clock",
          label: running ? "Pomodoro em andamento" : "Iniciar Pomodoro",
          sub: running ? pomoTimeText() : `${todo.pomoWorkMinutes || 25} min de foco · ${todo.pomoBreakMinutes || 5} min de pausa`,
          on: running,
          onclick: () => openPomodoroModal(todo),
          trailing: icon("fa-solid fa-chevron-right tk-d-row-end"),
        }),
      );
  pomo?.querySelector("small")?.classList.add("tk-pomo-time");

  // Anotação
  const note = el("textarea.tk-d-note", { placeholder: "Adicionar anotação", rows: 3, spellcheck: true });
  note.value = todo.note || "";
  note.addEventListener("input", () => {
    autoGrow(note);
    todo.note = note.value;
    saveSoon();
  });
  note.addEventListener("blur", () => {
    flushSave();
    renderList();
  });

  // Rodapé
  const created = createdLabel(todo);
  const info = [created ? `Criada em ${created}` : null, todo.done && todo.completed_date ? `Concluída ${formatDayLabel(todo.completed_date).toLowerCase()}` : null].filter(Boolean).join(" · ");
  const footer = el(
    "div.tk-d-footer",
    {},
    el("span", {}, info),
    el("button.tk-act.danger.desktop-only", { type: "button", title: "Excluir tarefa (Delete)", onclick: () => deleteTodo(todo) }, icon("fa-regular fa-trash-can")),
  );

  detailEl.append(head, el("div.tk-d-card", {}, myDay), dateCard, pomo, note, footer);
  requestAnimationFrame(() => {
    autoGrow(title);
    autoGrow(note);
  });
}

/** Re-renderiza lista, cabeçalhos e detalhe. */
export function renderTasks() {
  if (ui.selectedId !== null && !selectedTodo()) ui.selectedId = null;
  renderList();
  renderDetail(); // pode voltar o painel da bandeja para a lista
  renderChrome();
}

// ---------- Teclado ----------

function moveSelection(delta) {
  const ids = [...listEl.querySelectorAll(".tk-item")].map((r) => Number(r.dataset.id));
  if (!ids.length) return;
  const idx = ids.indexOf(ui.selectedId);
  const next = ids[idx < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, idx + delta))];
  select(next, { open: false });
  listEl.querySelector(`.tk-item[data-id="${next}"]`)?.scrollIntoView({ block: "nearest" });
}

function handleGlobalKeydown(e) {
  if (state.activeMainView !== "tasks" || !document.getElementById("modal-pomodoro").hidden || !document.getElementById("modal-reschedule").hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  const typing = e.target.closest?.("input, textarea, [contenteditable]");

  if (mod && e.key.toLowerCase() === "n") {
    e.preventDefault();
    inputEl.focus();
    return;
  }
  if (mod && e.key.toLowerCase() === "f" && state.desktopMode) {
    e.preventDefault();
    searchEl.focus();
    searchEl.select();
    return;
  }
  if (e.key === "Escape") {
    if (typing === searchEl && ui.query) {
      searchEl.value = ui.query = "";
      renderTasks();
      return;
    }
    if (typing) return typing.blur();
    if (!state.desktopMode && ui.pane === "editor") return actions["show-list"]();
    if (state.desktopMode && ui.selectedId !== null) return select(null);
    return;
  }
  if (typing || !state.desktopMode) return;

  const todo = selectedTodo();
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    moveSelection(e.key === "ArrowDown" ? 1 : -1);
  } else if (todo && e.key === " ") {
    e.preventDefault();
    toggleDone(todo);
  } else if (todo && (e.key === "Delete" || e.key === "Backspace")) {
    e.preventDefault();
    deleteTodo(todo);
  } else if (todo && e.key === "Enter") {
    e.preventDefault();
    detailEl.querySelector(".tk-d-title")?.focus();
  }
}

// ---------- Init ----------

const actions = {
  "show-list": () => {
    flushSave();
    ui.pane = "list";
    renderTasks();
  },
  delete: () => deleteTodo(selectedTodo()),
  reschedule: openRescheduleModal,
  "new-task": () => inputEl.focus(),
  "toggle-sidebar": () => {
    ui.sidebarHidden = !ui.sidebarHidden;
    renderChrome();
  },
  desktop: () => enterDesktopMode(),
  tray: () => exitDesktopMode(),
  "close-desktop": () => exitDesktopMode({ visible: false }),
  minimize: minimizeWindow,
  maximize: toggleMaximize,
};

export function initTasks() {
  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    addTodo(text);
  });

  appEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (btn && actions[btn.dataset.action]) actions[btn.dataset.action]();
  });

  searchEl.addEventListener("input", () => {
    ui.query = searchEl.value;
    renderList();
  });

  document.addEventListener("keydown", handleGlobalKeydown);

  document.addEventListener("pomodorotick", () => {
    const text = pomoTimeText();
    appEl.querySelectorAll(".tk-pomo-time").forEach((n) => (n.textContent = text));
  });

  document.addEventListener("mainviewchange", () => {
    if (state.activeMainView !== "tasks") {
      flushSave();
      document.body.classList.remove("tasks-editing");
      return;
    }
    renderTasks();
  });

  document.addEventListener("windowmodechange", () => {
    if (!state.desktopMode) {
      ui.pane = "list";
      ui.query = searchEl.value = "";
    }
    renderTasks();
  });

  window.addEventListener("beforeunload", () => {
    if (saveTimer) flushSave();
  });
}
