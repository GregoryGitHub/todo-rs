import { state } from "../state.js";
import { getTodayStr, formatDateLabel } from "../utils/date.js";
import { saveTodosApi } from "../api.js";
import { openPomodoroModal, pausePomodoroTimer } from "./pomodoro.js";

const listEl = document.getElementById("list");
const formEl = document.getElementById("new-todo");
const inputEl = document.getElementById("input");
const counterEl = document.getElementById("counter");
const emptyEl = document.getElementById("empty");
const viewTitleIconEl = document.getElementById("view-title-icon");
const viewTitleTextEl = document.getElementById("view-title-text");
const tabMyDay = document.getElementById("tab-my-day");
const tabAll = document.getElementById("tab-all");

const FA_CHECKED = `<i class="fa-solid fa-circle-check"></i>`;
const FA_UNCHECKED = `<i class="fa-regular fa-circle"></i>`;
const FA_CALENDAR = `<i class="fa-regular fa-calendar"></i>`;
const FA_TRASH = `<i class="fa-solid fa-trash-can"></i>`;
const FA_CLOCK = `<i class="fa-regular fa-clock"></i>`;
const FA_STOPWATCH = `<i class="fa-solid fa-stopwatch"></i>`;

export function getFilteredTodos() {
  const today = getTodayStr();
  if (state.currentView === "my_day") {
    return state.todos.filter((t) => {
      if (!t.done) {
        return t.is_my_day || t.date === today;
      }
      const completedDate = t.completed_date || t.date;
      return t.date === today && completedDate === today;
    });
  }
  return state.todos;
}

export function updateCounter() {
  const filtered = getFilteredTodos();
  const pending = filtered.filter((t) => !t.done).length;
  counterEl.textContent = pending;
  emptyEl.hidden = filtered.length > 0;
}

function createTodoItemElement(todo, today) {
  const li = document.createElement("li");
  li.className = "item" + (todo.done ? " done" : "");

  // Checkbox button
  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.className = "check-btn" + (todo.done ? " checked" : "");
  checkBtn.setAttribute("aria-label", todo.done ? "Desmarcar" : "Concluir");
  checkBtn.innerHTML = todo.done ? FA_CHECKED : FA_UNCHECKED;
  checkBtn.addEventListener("click", () => {
    todo.done = !todo.done;
    if (todo.done) {
      todo.completed_date = getTodayStr();
      if (state.pomoState.taskId === todo.id) {
        pausePomodoroTimer();
      }
    } else {
      delete todo.completed_date;
    }
    saveTodosApi(state.todos);
    renderTasks();
  });

  // Content container
  const contentDiv = document.createElement("div");
  contentDiv.className = "item-content";

  const textSpan = document.createElement("span");
  textSpan.className = "text";
  textSpan.textContent = todo.text;

  contentDiv.appendChild(textSpan);

  // Date badge
  if (todo.date && todo.date !== today) {
    const dateBadge = document.createElement("span");
    dateBadge.className = "date-badge" + (todo.date < today && !todo.done ? " overdue" : "");
    dateBadge.innerHTML = `${FA_CALENDAR} ${formatDateLabel(todo.date)}`;
    contentDiv.appendChild(dateBadge);
  }

  // Delete button
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn-icon del";
  delBtn.setAttribute("aria-label", "Remover");
  delBtn.title = "Excluir tarefa";
  delBtn.innerHTML = FA_TRASH;
  delBtn.addEventListener("click", () => {
    if (state.pomoState.taskId === todo.id) {
      pausePomodoroTimer();
      state.pomoState.taskId = null;
    }
    state.todos = state.todos.filter((t) => t.id !== todo.id);
    saveTodosApi(state.todos);
    renderTasks();
  });

  const actionsDiv = document.createElement("div");
  actionsDiv.className = "item-actions";

  if (!todo.done) {
    // Pomodoro clock button (only for pending tasks)
    const pomoBtn = document.createElement("button");
    pomoBtn.type = "button";
    const isPomoActive = state.pomoState.isRunning && state.pomoState.taskId === todo.id;
    pomoBtn.className = "btn-icon btn-pomo" + (isPomoActive ? " active" : "");
    pomoBtn.title = "Timer Pomodoro";
    pomoBtn.innerHTML = isPomoActive ? FA_STOPWATCH : FA_CLOCK;
    pomoBtn.addEventListener("click", () => {
      openPomodoroModal(todo);
    });

    actionsDiv.append(pomoBtn, delBtn);
  } else {
    actionsDiv.append(delBtn);
  }

  li.append(checkBtn, contentDiv, actionsDiv);
  return li;
}

export function renderTasks() {
  listEl.innerHTML = "";
  const today = getTodayStr();
  const filtered = getFilteredTodos();

  const pending = filtered.filter((t) => !t.done);
  const completed = filtered.filter((t) => t.done);

  for (const todo of pending) {
    listEl.appendChild(createTodoItemElement(todo, today));
  }

  if (completed.length > 0) {
    const divider = document.createElement("li");
    divider.className = "completed-divider";
    divider.innerHTML = `<span>Concluídas</span>`;
    listEl.appendChild(divider);

    for (const todo of completed) {
      listEl.appendChild(createTodoItemElement(todo, today));
    }
  }

  updateCounter();
}

export function initTasks() {
  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;

    const today = getTodayStr();
    state.todos.push({
      id: Date.now(),
      text,
      done: false,
      date: today,
      is_my_day: state.currentView === "my_day",
    });

    inputEl.value = "";
    saveTodosApi(state.todos);
    renderTasks();
  });

  tabMyDay.addEventListener("click", () => {
    state.currentView = "my_day";
    tabMyDay.classList.add("active");
    tabAll.classList.remove("active");
    if (viewTitleIconEl) viewTitleIconEl.className = "fa-solid fa-sun";
    if (viewTitleTextEl) viewTitleTextEl.textContent = "Meu Dia";
    renderTasks();
  });

  tabAll.addEventListener("click", () => {
    state.currentView = "all";
    tabAll.classList.add("active");
    tabMyDay.classList.remove("active");
    if (viewTitleIconEl) viewTitleIconEl.className = "fa-solid fa-clock-rotate-left";
    if (viewTitleTextEl) viewTitleTextEl.textContent = "Histórico";
    renderTasks();
  });
}
