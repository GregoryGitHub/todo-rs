import { state } from "./js/state.js";
import { getTodayStr } from "./js/utils/date.js";
import { loadTodosApi, loadNotesApi, loadFoldersApi, loadSettingsApi, saveNotesApi } from "./js/api.js";
import { normalizeNote, purgeExpiredTrash } from "./js/utils/noteContent.js";
import { initTasks, renderTasks } from "./js/components/tasks.js";
import { initNotes, renderNotes } from "./js/components/notes.js";
import { initPomodoro, setPomodoroRenderCallback } from "./js/components/pomodoro.js";
import { initSettings, updateSettingsUI } from "./js/components/settings.js";
import { initWindowControls } from "./js/components/windowControls.js";
import { initWindowMode } from "./js/components/windowMode.js";
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

    const rawNotes = (await loadNotesApi()) || [];
    state.notes = purgeExpiredTrash(rawNotes.map(normalizeNote));
    if (state.notes.length !== rawNotes.length) saveNotesApi(state.notes);
    state.folders = (await loadFoldersApi()) || [];
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
  const modalPomodoro = document.getElementById("modal-pomodoro");
  const modalReschedule = document.getElementById("modal-reschedule");
  const menuDropdown = document.getElementById("menu-dropdown");

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!modalPomodoro.hidden) {
        modalPomodoro.hidden = true;
      } else if (!modalReschedule.hidden) {
        modalReschedule.hidden = true;
      } else if (!menuDropdown.hidden) {
        menuDropdown.hidden = true;
      } else if (inputEl && state.activeMainView === "tasks") {
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
  initWindowMode();
  initRescheduleModal();
  initGlobalShortcutListeners();

  load();
}

main();
