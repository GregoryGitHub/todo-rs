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

// ---------- HTTP (aba estilo Postman) ----------

export async function loadHttpDataApi() {
  try {
    return await invoke("load_http_data");
  } catch (e) {
    console.error("load_http_data failed", e);
    return null;
  }
}

export async function saveHttpDataApi(data) {
  try {
    await invoke("save_http_data", { data });
  } catch (e) {
    console.error("save_http_data failed", e);
  }
}

/** Executes the request in Rust (no CORS). Rejects with a readable message string. */
export async function sendHttpRequestApi(request) {
  if (!window.__TAURI__?.core) throw "Disponível apenas no aplicativo desktop.";
  return invoke("send_http_request", { request });
}

export function cancelHttpRequestApi(id) {
  invoke("cancel_http_request", { id }).catch(() => {});
}

export function clearHttpCookiesApi() {
  return invoke("clear_http_cookies").catch(() => {});
}

export async function openFileDialogApi({ filters, title } = {}) {
  try {
    const path = await invoke("plugin:dialog|open", { options: { multiple: false, directory: false, filters, title } });
    return Array.isArray(path) ? path[0] ?? null : path ?? null;
  } catch (e) {
    console.error("open dialog failed", e);
    return null;
  }
}

export async function saveFileDialogApi({ defaultPath, filters, title } = {}) {
  try {
    return (await invoke("plugin:dialog|save", { options: { defaultPath, filters, title } })) ?? null;
  } catch (e) {
    console.error("save dialog failed", e);
    return null;
  }
}

export function readTextFileApi(path) {
  return invoke("read_text_file", { path });
}

export function writeFileApi(path, { text = null, base64 = null } = {}) {
  return invoke("write_file", { path, text, base64 });
}
