const { invoke } = window.__TAURI__?.core || { invoke: async () => [] };

export async function loadTodosApi() {
  try {
    return (await invoke("load_todos")) || [];
  } catch (e) {
    console.error("load_todos failed", e);
    return [];
  }
}

export async function saveTodosApi(todos) {
  try {
    await invoke("save_todos", { todos });
  } catch (e) {
    console.error("save_todos failed", e);
  }
}

export async function loadNotesApi() {
  try {
    return (await invoke("load_notes")) || [];
  } catch (e) {
    console.error("load_notes failed", e);
    return [];
  }
}

export async function saveNotesApi(notes) {
  try {
    await invoke("save_notes", { notes });
  } catch (e) {
    console.error("save_notes failed", e);
  }
}

export async function loadFoldersApi() {
  try {
    return (await invoke("load_folders")) || [];
  } catch (e) {
    console.error("load_folders failed", e);
    return [];
  }
}

export async function saveFoldersApi(folders) {
  try {
    await invoke("save_folders", { folders });
  } catch (e) {
    console.error("save_folders failed", e);
  }
}

export async function loadSettingsApi() {
  try {
    return (await invoke("load_settings")) || { autostart: false, start_minimized: false };
  } catch (e) {
    console.error("load_settings failed", e);
    return { autostart: false, start_minimized: false };
  }
}

export async function saveSettingsApi(settings) {
  try {
    await invoke("save_settings", { settings });
  } catch (e) {
    console.error("save_settings failed", e);
  }
}

export function hideWindowApi() {
  invoke("hide_window");
}

export function exitAppApi() {
  invoke("exit_app");
}

export async function setDesktopModeApi(enabled, visible = true) {
  try {
    await invoke("set_desktop_mode", { enabled, visible });
  } catch (e) {
    console.error("set_desktop_mode failed", e);
  }
}

export function minimizeWindowApi() {
  invoke("minimize_window");
}

export async function toggleMaximizeApi() {
  try {
    return !!(await invoke("toggle_maximize"));
  } catch (e) {
    console.error("toggle_maximize failed", e);
    return false;
  }
}
