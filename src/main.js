const { invoke } = window.__TAURI__?.core || { invoke: async () => [] };

const listEl = document.getElementById("list");
const formEl = document.getElementById("new-todo");
const inputEl = document.getElementById("input");
const counterEl = document.getElementById("counter");
const emptyEl = document.getElementById("empty");
const viewTitleEl = document.getElementById("view-title");
const tabMyDay = document.getElementById("tab-my-day");
const tabAll = document.getElementById("tab-all");

// Window Bar & Menu elements
const btnHide = document.getElementById("btn-hide");
const btnMenuToggle = document.getElementById("btn-menu-toggle");
const menuDropdown = document.getElementById("menu-dropdown");
const menuItemHide = document.getElementById("menu-item-hide");
const menuItemQuit = document.getElementById("menu-item-quit");

// Reschedule Modal elements
const modalReschedule = document.getElementById("modal-reschedule");
const btnRescheduleOpen = document.getElementById("btn-reschedule-open");
const modalClose = document.getElementById("modal-close");
const btnCancelReschedule = document.getElementById("btn-cancel-reschedule");
const btnConfirmReschedule = document.getElementById("btn-confirm-reschedule");
const rescheduleDateInput = document.getElementById("reschedule-date");

const FA_CHECKED = `<i class="fa-solid fa-circle-check"></i>`;
const FA_UNCHECKED = `<i class="fa-regular fa-circle"></i>`;
const FA_CALENDAR = `<i class="fa-regular fa-calendar"></i>`;
const FA_SUN_SOLID = `<i class="fa-solid fa-sun"></i>`;
const FA_SUN_REGULAR = `<i class="fa-regular fa-sun"></i>`;
const FA_LIST = `<i class="fa-solid fa-list-check"></i>`;
const FA_TRASH = `<i class="fa-solid fa-trash-can"></i>`;

let todos = [];
let currentView = "my_day"; // "my_day" | "all"

function getTodayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateStr) {
  if (!dateStr) return "";
  const today = getTodayStr();
  const tomorrow = getTomorrowStr();
  if (dateStr === today) return "Hoje";
  if (dateStr === tomorrow) return "Amanhã";

  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}

async function load() {
  try {
    const raw = await invoke("load_todos");
    const today = getTodayStr();
    todos = (raw || []).map((t) => ({
      ...t,
      date: t.date || today,
      is_my_day: t.is_my_day ?? (t.date === today),
    }));
  } catch (e) {
    console.error("load_todos failed", e);
    todos = [];
  }
  render();
}

async function persist() {
  try {
    await invoke("save_todos", { todos });
  } catch (e) {
    console.error("save_todos failed", e);
  }
}

function getFilteredTodos() {
  const today = getTodayStr();
  if (currentView === "my_day") {
    return todos.filter((t) => t.is_my_day || t.date === today);
  }
  return todos;
}

function updateCounter() {
  const filtered = getFilteredTodos();
  const pending = filtered.filter((t) => !t.done).length;
  counterEl.textContent = pending;
  emptyEl.hidden = filtered.length > 0;
}

function render() {
  listEl.innerHTML = "";
  const today = getTodayStr();
  const filtered = getFilteredTodos();

  for (const todo of filtered) {
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
      persist();
      render();
    });

    // Content container
    const contentDiv = document.createElement("div");
    contentDiv.className = "item-content";

    const textSpan = document.createElement("span");
    textSpan.className = "text";
    textSpan.textContent = todo.text;

    contentDiv.appendChild(textSpan);

    // Date badge
    if (todo.date) {
      const dateBadge = document.createElement("span");
      dateBadge.className = "date-badge" + (todo.date < today && !todo.done ? " overdue" : "");
      dateBadge.innerHTML = `${FA_CALENDAR} ${formatDateLabel(todo.date)}`;
      contentDiv.appendChild(dateBadge);
    }

    // Toggle "Meu Dia" button
    const myDayBtn = document.createElement("button");
    myDayBtn.type = "button";
    myDayBtn.className = "btn-icon btn-sun" + (todo.is_my_day ? " active" : "");
    myDayBtn.title = todo.is_my_day ? "Remover de Meu Dia" : "Adicionar a Meu Dia";
    myDayBtn.innerHTML = todo.is_my_day ? FA_SUN_SOLID : FA_SUN_REGULAR;
    myDayBtn.addEventListener("click", () => {
      todo.is_my_day = !todo.is_my_day;
      if (todo.is_my_day) {
        todo.date = today;
      }
      persist();
      render();
    });

    // Delete button
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-icon del";
    delBtn.setAttribute("aria-label", "Remover");
    delBtn.title = "Excluir tarefa";
    delBtn.innerHTML = FA_TRASH;
    delBtn.addEventListener("click", () => {
      todos = todos.filter((t) => t.id !== todo.id);
      persist();
      render();
    });

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "item-actions";
    actionsDiv.append(myDayBtn, delBtn);

    li.append(checkBtn, contentDiv, actionsDiv);
    listEl.appendChild(li);
  }

  updateCounter();
}

// Window controls & Menu
btnHide.addEventListener("click", () => {
  invoke("hide_window");
});

btnMenuToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  menuDropdown.hidden = !menuDropdown.hidden;
});

menuItemHide.addEventListener("click", () => {
  menuDropdown.hidden = true;
  invoke("hide_window");
});

menuItemQuit.addEventListener("click", () => {
  invoke("exit_app");
});

document.addEventListener("click", (e) => {
  if (!menuDropdown.hidden && !e.target.closest(".menu-container")) {
    menuDropdown.hidden = true;
  }
});

// Form Submission
formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  const today = getTodayStr();
  todos.push({
    id: Date.now(),
    text,
    done: false,
    date: today,
    is_my_day: currentView === "my_day",
  });

  inputEl.value = "";
  persist();
  render();
});

// View switching
tabMyDay.addEventListener("click", () => {
  currentView = "my_day";
  tabMyDay.classList.add("active");
  tabAll.classList.remove("active");
  viewTitleEl.innerHTML = `${FA_SUN_SOLID} Meu Dia`;
  render();
});

tabAll.addEventListener("click", () => {
  currentView = "all";
  tabAll.classList.add("active");
  tabMyDay.classList.remove("active");
  viewTitleEl.innerHTML = `${FA_LIST} Todas as Tarefas`;
  render();
});

// Reschedule Modal Handlers
btnRescheduleOpen.addEventListener("click", () => {
  rescheduleDateInput.value = getTomorrowStr();
  modalReschedule.hidden = false;
});

modalClose.addEventListener("click", () => {
  modalReschedule.hidden = true;
});

btnCancelReschedule.addEventListener("click", () => {
  modalReschedule.hidden = true;
});

modalReschedule.addEventListener("click", (e) => {
  if (e.target === modalReschedule) {
    modalReschedule.hidden = true;
  }
});

btnConfirmReschedule.addEventListener("click", () => {
  const targetDate = rescheduleDateInput.value;
  if (!targetDate) return;

  const today = getTodayStr();
  let movedCount = 0;

  for (const todo of todos) {
    if (!todo.done) {
      todo.date = targetDate;
      todo.is_my_day = (targetDate === today);
      movedCount++;
    }
  }

  modalReschedule.hidden = true;
  if (movedCount > 0) {
    persist();
    render();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!modalReschedule.hidden) {
      modalReschedule.hidden = true;
    } else if (!menuDropdown.hidden) {
      menuDropdown.hidden = true;
    } else {
      inputEl.value = "";
      inputEl.blur();
    }
  }
});

load();
