import { state } from "../state.js";
import { saveSettingsApi } from "../api.js";
import { renderNotes } from "./notes.js";

const bottomNav = document.getElementById("bottom-nav");
const viewTasks = document.getElementById("view-tasks");
const viewNotes = document.getElementById("view-notes");
const viewSettings = document.getElementById("view-settings");
const settingAutostart = document.getElementById("setting-autostart");
const settingStartMinimized = document.getElementById("setting-start-minimized");

export function initSettings() {
  settingAutostart.addEventListener("change", () => {
    state.settings.autostart = settingAutostart.checked;
    saveSettingsApi(state.settings);
  });

  settingStartMinimized.addEventListener("change", () => {
    state.settings.start_minimized = settingStartMinimized.checked;
    saveSettingsApi(state.settings);
  });

  bottomNav.addEventListener("click", (e) => {
    const tabBtn = e.target.closest(".bottom-tab");
    if (!tabBtn) return;

    const targetView = tabBtn.dataset.view;
    if (!targetView || targetView === state.activeMainView) return;

    state.activeMainView = targetView;

    document.querySelectorAll(".bottom-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === targetView);
    });

    viewTasks.hidden = targetView !== "tasks";
    viewNotes.hidden = targetView !== "notes";
    viewSettings.hidden = targetView !== "settings";

    if (targetView === "notes") renderNotes();
  });
}

export function updateSettingsUI() {
  settingAutostart.checked = !!state.settings.autostart;
  settingStartMinimized.checked = !!state.settings.start_minimized;
}
