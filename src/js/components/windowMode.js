import { state } from "../state.js";
import { setDesktopModeApi, minimizeWindowApi, toggleMaximizeApi } from "../api.js";
import { showMainView } from "../navigation.js";

// Tray mode (compact window by the tray) <-> desktop mode (large Notes window).

function notifyChange() {
  document.dispatchEvent(new CustomEvent("windowmodechange", { detail: { desktop: state.desktopMode } }));
}

function updateMaximizedClass() {
  const maximized =
    state.desktopMode &&
    window.outerWidth >= window.screen.availWidth - 2 &&
    window.outerHeight >= window.screen.availHeight - 2;
  document.body.classList.toggle("maximized", maximized);
}

export async function enterDesktopMode() {
  if (state.desktopMode) return;
  state.desktopMode = true;
  document.body.classList.add("desktop-mode");
  showMainView("notes");
  notifyChange();
  await setDesktopModeApi(true, true);
}

/** Back to the compact tray window; `visible: false` also hides it (red button). */
export async function exitDesktopMode({ visible = true } = {}) {
  if (!state.desktopMode) return;
  state.desktopMode = false;
  await setDesktopModeApi(false, visible);
  document.body.classList.remove("desktop-mode", "maximized");
  notifyChange();
}

export function minimizeWindow() {
  minimizeWindowApi();
}

export async function toggleMaximize() {
  await toggleMaximizeApi();
  updateMaximizedClass();
}

export function initWindowMode() {
  window.addEventListener("resize", updateMaximizedClass);
}
