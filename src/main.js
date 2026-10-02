import { state } from "./js/state.js";
import { getTodayStr } from "./js/utils/date.js";
import { loadTodosApi, loadNotesApi, loadFoldersApi, loadSettingsApi, saveNotesApi, loadHttpDataApi, loadDbDataApi } from "./js/api.js";
import { normalizeNote, purgeExpiredTrash } from "./js/utils/noteContent.js";
import { initTasks, renderTasks } from "./js/components/tasks.js";
import { initNotes, renderNotes, collectNoteImageGarbage } from "./js/components/notes.js";
import { initHttp, setHttpData } from "./js/components/http.js";
import { initJsonFormatter } from "./js/components/jsonFormatter.js";
import { initDb, setDbData } from "./js/components/db.js";
import { initPomodoro, setPomodoroRenderCallback } from "./js/components/pomodoro.js";
import { initSettings, updateSettingsUI } from "./js/components/settings.js";
import { initWindowControls } from "./js/components/windowControls.js";
import { initWindowMode } from "./js/components/windowMode.js";
import { initRescheduleModal } from "./js/components/reschedule.js";
import { initTheme, syncThemeFromSettings } from "./js/components/theme.js";

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
    state.settings = { ...state.settings, ...(await loadSettingsApi()) };
  } catch (e) {
    console.error("load failed", e);
  }

  syncThemeFromSettings();
  updateSettingsUI();
  renderTasks();
  renderNotes();
  collectNoteImageGarbage();

  try {
    setHttpData(await loadHttpDataApi());
  } catch (e) {
    console.error("http load failed", e);
    setHttpData({});
  }

  try {
    setDbData(await loadDbDataApi());
  } catch (e) {
    console.error("db load failed", e);
    setDbData({});
  }
}

function initGlobalShortcutListeners() {
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
      }
    }
  });
}

function main() {
  initTheme();
  initTasks();
  initNotes();
  initHttp();
  initJsonFormatter();
  initDb();
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
