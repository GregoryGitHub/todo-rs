import { state } from "./js/state.js";
import { getTodayStr } from "./js/utils/date.js";
import { loadTodosApi, loadNotesApi, loadSettingsApi } from "./js/api.js";
import { initTasks, renderTasks } from "./js/components/tasks.js";
import { initNotes, renderNotes } from "./js/components/notes.js";
import { initPomodoro, setPomodoroRenderCallback } from "./js/components/pomodoro.js";
import { initSettings, updateSettingsUI } from "./js/components/settings.js";
import { initWindowControls } from "./js/components/windowControls.js";
import { initRescheduleModal } from "./js/components/reschedule.js";

async function load() {
  try {
    const rawTodos = await loadTodosApi();
    const today = getTodayStr();
    state.todos = (rawTodos || []).map((t) => ({
      ...t,
      date: t.date || today,
      is_my_day: t.is_my_day ?? (t.date === today),
    }));

    state.notes = await loadNotesApi();
    state.settings = await loadSettingsApi();
  } catch (e) {
    console.error("load failed", e);
  }

  updateSettingsUI();
  renderTasks();
  renderNotes();
}

function initGlobalShortcutListeners() {
  const inputEl = document.getElementById("input");
  const modalNoteEditor = document.getElementById("modal-note-editor");
  const modalPomodoro = document.getElementById("modal-pomodoro");
  const modalReschedule = document.getElementById("modal-reschedule");
  const menuDropdown = document.getElementById("menu-dropdown");

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
      } else if (inputEl) {
        inputEl.value = "";
        inputEl.blur();
      }
    }
  });
}

function main() {
  initTasks();
  initNotes();
  initPomodoro();
  setPomodoroRenderCallback(renderTasks);
  initSettings();
  initWindowControls();
  initRescheduleModal();
  initGlobalShortcutListeners();

  load();
}

main();
