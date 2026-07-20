const { invoke } = window.__TAURI__?.core || { invoke: async () => [] };

// Navigation & View elements
const bottomNav = document.getElementById("bottom-nav");
const viewTasks = document.getElementById("view-tasks");
const viewNotes = document.getElementById("view-notes");
const viewSettings = document.getElementById("view-settings");

// Tasks elements
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

// Pomodoro Modal elements
const modalPomodoro = document.getElementById("modal-pomodoro");
const pomodoroModalClose = document.getElementById("pomodoro-modal-close");
const pomoTaskNameEl = document.getElementById("pomodoro-task-name");
const pomoModeBadgeEl = document.getElementById("pomodoro-mode-badge");
const pomoBadgeIconEl = document.getElementById("pomo-badge-icon");
const pomoBadgeTextEl = document.getElementById("pomo-badge-text");
const pomoTimeDisplayEl = document.getElementById("pomodoro-time-display");
const btnPomoToggle = document.getElementById("btn-pomo-toggle");
const pomoToggleIconEl = document.getElementById("pomo-toggle-icon");
const pomoToggleTextEl = document.getElementById("pomo-toggle-text");
const btnPomoReset = document.getElementById("btn-pomo-reset");
const pomoWorkInput = document.getElementById("pomo-work-input");
const pomoBreakInput = document.getElementById("pomo-break-input");

// Notes elements
const btnNewNote = document.getElementById("btn-new-note");
const notesListEl = document.getElementById("notes-list");
const notesEmptyEl = document.getElementById("notes-empty");
const modalNoteEditor = document.getElementById("modal-note-editor");
const noteModalClose = document.getElementById("note-modal-close");
const noteModalTitleEl = document.getElementById("note-modal-title");
const noteTitleInput = document.getElementById("note-title-input");
const noteContentInput = document.getElementById("note-content-input");
const btnSaveNote = document.getElementById("btn-save-note");
const btnCancelNote = document.getElementById("btn-cancel-note");
const btnDeleteNote = document.getElementById("btn-delete-note");

// Settings elements
const settingAutostart = document.getElementById("setting-autostart");
const settingStartMinimized = document.getElementById("setting-start-minimized");

// FontAwesome Icons
const FA_CHECKED = `<i class="fa-solid fa-circle-check"></i>`;
const FA_UNCHECKED = `<i class="fa-regular fa-circle"></i>`;
const FA_CALENDAR = `<i class="fa-regular fa-calendar"></i>`;
const FA_SUN_SOLID = `<i class="fa-solid fa-sun"></i>`;
const FA_SUN_REGULAR = `<i class="fa-regular fa-sun"></i>`;
const FA_LIST = `<i class="fa-solid fa-list-check"></i>`;
const FA_TRASH = `<i class="fa-solid fa-trash-can"></i>`;
const FA_CLOCK = `<i class="fa-regular fa-clock"></i>`;
const FA_STOPWATCH = `<i class="fa-solid fa-stopwatch"></i>`;

let todos = [];
let notes = [];
let settings = { autostart: false, start_minimized: false };
let currentView = "my_day"; // "my_day" | "all"
let activeMainView = "tasks"; // "tasks" | "notes" | "settings"
let currentEditingNoteId = null;

// Pomodoro global state
let activePomoTaskId = null;
let pomoState = {
  taskId: null,
  mode: "work", // 'work' | 'break'
  workMinutes: 25,
  breakMinutes: 5,
  secondsRemaining: 25 * 60,
  isRunning: false,
  intervalId: null,
};

function playChimeSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch (e) {
    console.error("Audio synth error", e);
  }
}

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

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Data loading & persistence
async function load() {
  try {
    const rawTodos = await invoke("load_todos");
    const today = getTodayStr();
    todos = (rawTodos || []).map((t) => ({
      ...t,
      date: t.date || today,
      is_my_day: t.is_my_day ?? (t.date === today),
    }));

    notes = (await invoke("load_notes")) || [];
    settings = (await invoke("load_settings")) || { autostart: false, start_minimized: false };
  } catch (e) {
    console.error("load failed", e);
  }

  settingAutostart.checked = !!settings.autostart;
  settingStartMinimized.checked = !!settings.start_minimized;

  render();
  renderNotes();
}

async function persist() {
  try {
    await invoke("save_todos", { todos });
  } catch (e) {
    console.error("save_todos failed", e);
  }
}

async function persistNotes() {
  try {
    await invoke("save_notes", { notes });
  } catch (e) {
    console.error("save_notes failed", e);
  }
}

async function persistSettings() {
  try {
    await invoke("save_settings", { settings });
  } catch (e) {
    console.error("save_settings failed", e);
  }
}

// Bottom Navigation Switching
bottomNav.addEventListener("click", (e) => {
  const tabBtn = e.target.closest(".bottom-tab");
  if (!tabBtn) return;

  const targetView = tabBtn.dataset.view;
  if (!targetView || targetView === activeMainView) return;

  activeMainView = targetView;

  document.querySelectorAll(".bottom-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === targetView);
  });

  viewTasks.hidden = targetView !== "tasks";
  viewNotes.hidden = targetView !== "notes";
  viewSettings.hidden = targetView !== "settings";

  if (targetView === "notes") renderNotes();
});

// Settings Handlers
settingAutostart.addEventListener("change", () => {
  settings.autostart = settingAutostart.checked;
  persistSettings();
});

settingStartMinimized.addEventListener("change", () => {
  settings.start_minimized = settingStartMinimized.checked;
  persistSettings();
});

// Tasks logic
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

function openPomodoroModal(todo) {
  activePomoTaskId = todo.id;
  pomoState.taskId = todo.id;

  pomoTaskNameEl.textContent = todo.text;
  
  if (!pomoState.secondsRemaining || pomoState.taskId !== todo.id) {
    pomoState.mode = "work";
    pomoState.workMinutes = todo.pomoWorkMinutes || 25;
    pomoState.breakMinutes = todo.pomoBreakMinutes || 5;
    pomoState.secondsRemaining = pomoState.workMinutes * 60;
  }

  pomoWorkInput.value = pomoState.workMinutes;
  pomoBreakInput.value = pomoState.breakMinutes;

  updatePomodoroUI();
  modalPomodoro.hidden = false;
}

function updatePomodoroUI() {
  pomoTimeDisplayEl.textContent = formatTime(pomoState.secondsRemaining);

  if (pomoState.mode === "work") {
    pomoModeBadgeEl.className = "pomo-mode-badge work";
    pomoBadgeIconEl.className = "fa-solid fa-brain";
    pomoBadgeTextEl.textContent = "Foco";
  } else {
    pomoModeBadgeEl.className = "pomo-mode-badge break";
    pomoBadgeIconEl.className = "fa-solid fa-mug-hot";
    pomoBadgeTextEl.textContent = "Pausa";
  }

  if (pomoState.isRunning) {
    pomoToggleIconEl.className = "fa-solid fa-pause";
    pomoToggleTextEl.textContent = "Pausar";
  } else {
    pomoToggleIconEl.className = "fa-solid fa-play";
    pomoToggleTextEl.textContent = "Iniciar";
  }
}

function startPomodoroTimer() {
  if (pomoState.isRunning) return;

  pomoState.isRunning = true;
  updatePomodoroUI();

  pomoState.intervalId = setInterval(() => {
    if (pomoState.secondsRemaining > 0) {
      pomoState.secondsRemaining--;
      pomoTimeDisplayEl.textContent = formatTime(pomoState.secondsRemaining);
    } else {
      playChimeSound();
      if (pomoState.mode === "work") {
        pomoState.mode = "break";
        pomoState.secondsRemaining = pomoState.breakMinutes * 60;
      } else {
        pomoState.mode = "work";
        pomoState.secondsRemaining = pomoState.workMinutes * 60;
      }
      updatePomodoroUI();
    }
  }, 1000);
}

function pausePomodoroTimer() {
  if (!pomoState.isRunning) return;

  pomoState.isRunning = false;
  if (pomoState.intervalId) {
    clearInterval(pomoState.intervalId);
    pomoState.intervalId = null;
  }
  updatePomodoroUI();
}

function resetPomodoroTimer() {
  pausePomodoroTimer();
  if (pomoState.mode === "work") {
    pomoState.secondsRemaining = pomoState.workMinutes * 60;
  } else {
    pomoState.secondsRemaining = pomoState.breakMinutes * 60;
  }
  updatePomodoroUI();
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
    if (todo.done && pomoState.taskId === todo.id) {
      pausePomodoroTimer();
    }
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

  // Delete button
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn-icon del";
  delBtn.setAttribute("aria-label", "Remover");
  delBtn.title = "Excluir tarefa";
  delBtn.innerHTML = FA_TRASH;
  delBtn.addEventListener("click", () => {
    if (pomoState.taskId === todo.id) {
      pausePomodoroTimer();
      pomoState.taskId = null;
    }
    todos = todos.filter((t) => t.id !== todo.id);
    persist();
    render();
  });

  const actionsDiv = document.createElement("div");
  actionsDiv.className = "item-actions";

  if (!todo.done) {
    // Pomodoro clock button (only for pending tasks)
    const pomoBtn = document.createElement("button");
    pomoBtn.type = "button";
    const isPomoActive = pomoState.isRunning && pomoState.taskId === todo.id;
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

function render() {
  listEl.innerHTML = "";
  const today = getTodayStr();
  const filtered = getFilteredTodos();

  const pending = filtered.filter((t) => !t.done);
  const completed = filtered.filter((t) => t.done);

  // Render pending tasks first
  for (const todo of pending) {
    listEl.appendChild(createTodoItemElement(todo, today));
  }

  // Render completed divider and completed tasks at the bottom
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

// Notes Logic
function renderNotes() {
  notesListEl.innerHTML = "";
  notesEmptyEl.hidden = notes.length > 0;

  for (const note of notes) {
    const card = document.createElement("div");
    card.className = "note-card";

    const titleEl = document.createElement("h4");
    titleEl.className = "note-card-title";
    titleEl.textContent = note.title || "Sem título";

    const contentEl = document.createElement("p");
    contentEl.className = "note-card-snippet";
    contentEl.textContent = note.content || "Sem conteúdo";

    const footerEl = document.createElement("div");
    footerEl.className = "note-card-footer";

    const dateEl = document.createElement("span");
    dateEl.className = "note-card-date";
    dateEl.textContent = note.created_at || "";

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-icon del";
    delBtn.title = "Excluir nota";
    delBtn.innerHTML = FA_TRASH;
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      notes = notes.filter((n) => n.id !== note.id);
      persistNotes();
      renderNotes();
    });

    footerEl.append(dateEl, delBtn);
    card.append(titleEl, contentEl, footerEl);

    card.addEventListener("click", () => {
      openNoteEditor(note);
    });

    notesListEl.appendChild(card);
  }
}

function openNoteEditor(note = null) {
  if (note) {
    currentEditingNoteId = note.id;
    noteModalTitleEl.innerHTML = `<i class="fa-solid fa-pen"></i> Editar Nota`;
    noteTitleInput.value = note.title;
    noteContentInput.value = note.content;
    btnDeleteNote.hidden = false;
  } else {
    currentEditingNoteId = null;
    noteModalTitleEl.innerHTML = `<i class="fa-solid fa-plus"></i> Nova Nota`;
    noteTitleInput.value = "";
    noteContentInput.value = "";
    btnDeleteNote.hidden = true;
  }
  modalNoteEditor.hidden = false;
  noteTitleInput.focus();
}

btnNewNote.addEventListener("click", () => {
  openNoteEditor(null);
});

noteModalClose.addEventListener("click", () => {
  modalNoteEditor.hidden = true;
});

btnCancelNote.addEventListener("click", () => {
  modalNoteEditor.hidden = true;
});

btnDeleteNote.addEventListener("click", () => {
  if (currentEditingNoteId) {
    notes = notes.filter((n) => n.id !== currentEditingNoteId);
    persistNotes();
    renderNotes();
  }
  modalNoteEditor.hidden = true;
});

btnSaveNote.addEventListener("click", () => {
  const title = noteTitleInput.value.trim();
  const content = noteContentInput.value.trim();

  if (!title && !content) return;

  const todayStr = formatDateLabel(getTodayStr());

  if (currentEditingNoteId) {
    const note = notes.find((n) => n.id === currentEditingNoteId);
    if (note) {
      note.title = title || "Sem título";
      note.content = content;
    }
  } else {
    notes.unshift({
      id: Date.now(),
      title: title || "Sem título",
      content,
      created_at: todayStr,
    });
  }

  persistNotes();
  renderNotes();
  modalNoteEditor.hidden = true;
});

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

// Pomodoro Modal Handlers
pomodoroModalClose.addEventListener("click", () => {
  modalPomodoro.hidden = true;
});

modalPomodoro.addEventListener("click", (e) => {
  if (e.target === modalPomodoro) {
    modalPomodoro.hidden = true;
  }
});

btnPomoToggle.addEventListener("click", () => {
  if (pomoState.isRunning) {
    pausePomodoroTimer();
  } else {
    startPomodoroTimer();
  }
  render();
});

btnPomoReset.addEventListener("click", () => {
  resetPomodoroTimer();
  render();
});

pomoWorkInput.addEventListener("change", () => {
  let val = parseInt(pomoWorkInput.value, 10);
  if (isNaN(val) || val < 1) val = 25;
  pomoState.workMinutes = val;

  const currentTodo = todos.find((t) => t.id === pomoState.taskId);
  if (currentTodo) {
    currentTodo.pomoWorkMinutes = val;
    persist();
  }

  if (pomoState.mode === "work" && !pomoState.isRunning) {
    pomoState.secondsRemaining = val * 60;
    updatePomodoroUI();
  }
});

pomoBreakInput.addEventListener("change", () => {
  let val = parseInt(pomoBreakInput.value, 10);
  if (isNaN(val) || val < 1) val = 5;
  pomoState.breakMinutes = val;

  const currentTodo = todos.find((t) => t.id === pomoState.taskId);
  if (currentTodo) {
    currentTodo.pomoBreakMinutes = val;
    persist();
  }

  if (pomoState.mode === "break" && !pomoState.isRunning) {
    pomoState.secondsRemaining = val * 60;
    updatePomodoroUI();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!modalNoteEditor.hidden) {
      modalNoteEditor.hidden = true;
    } else if (!modalPomodoro.hidden) {
      modalPomodoro.hidden = true;
    } else if (!modalReschedule.hidden) {
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
