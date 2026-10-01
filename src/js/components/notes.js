import { state } from "../state.js";
import { saveNotesApi, saveFoldersApi } from "../api.js";
import { formatNoteListDate, formatNoteFullDate, noteGroupLabel } from "../utils/date.js";
import { noteTitle, notePreview, noteIsEmpty, noteMatches } from "../utils/noteContent.js";
import { initEditor, loadEditor, runCommand, getSelectionState, focusEditorEnd } from "./noteEditor.js";
import { enterDesktopMode, exitDesktopMode, minimizeWindow, toggleMaximize } from "./windowMode.js";

// "Quick Notes" modeled on macOS Notes: folders, grouped list, and a rich editor.
// The same DOM is used in tray mode (stacked navigation) and desktop mode (3 columns).

const ui = state.notesUI;
const DEFAULT_FOLDER = { id: 0, name: "Notas" };

const appEl = document.getElementById("notes-app");
const foldersEl = document.getElementById("nt-folders");
const listEl = document.getElementById("nt-list");
const listTitleEl = document.getElementById("nt-list-title");
const countEl = document.getElementById("nt-count");
const tbFolderEl = document.getElementById("nt-tb-folder");
const tbCountEl = document.getElementById("nt-tb-count");
const backLabelEl = document.getElementById("nt-back-label");
const searchInputs = [document.getElementById("nt-search-desktop"), document.getElementById("nt-search-compact")];
const editorScrollEl = document.getElementById("nt-editor-scroll");
const editorDateEl = document.getElementById("nt-editor-date");
const editorEmptyEl = document.getElementById("nt-editor-empty");
const trashBannerEl = document.getElementById("nt-trash-banner");
const popoverEl = document.getElementById("nt-format-popover");
const menuEl = document.getElementById("nt-menu");

let saveTimer = null;
let listRenderQueued = false;

// ---------- Data helpers ----------

function allFolders() {
  return [DEFAULT_FOLDER, ...state.folders];
}

function folderName(id) {
  return allFolders().find((f) => f.id === id)?.name ?? DEFAULT_FOLDER.name;
}

function scopeFolderId() {
  return ui.scope.startsWith("f:") ? Number(ui.scope.slice(2)) : null;
}

function scopeLabel() {
  if (ui.query.trim()) return "Resultados";
  if (ui.scope === "all") return "Todas as Notas";
  if (ui.scope === "trash") return "Apagadas Recentemente";
  return folderName(scopeFolderId());
}

function findNote(id) {
  return state.notes.find((n) => n.id === id) || null;
}

function selectedNote() {
  return findNote(ui.selectedId);
}

function pluralNotes(n) {
  return `${n} ${n === 1 ? "nota" : "notas"}`;
}

function visibleNotes() {
  const q = ui.query.trim();
  const inTrash = ui.scope === "trash";
  const fid = scopeFolderId();
  let list = state.notes.filter((n) => {
    if (inTrash) return !!n.deleted_at;
    if (n.deleted_at) return false;
    return q || fid === null || n.folder_id === fid;
  });
  if (q) list = list.filter((n) => noteMatches(n, q));
  return list.sort((a, b) => {
    if (inTrash) return b.deleted_at - a.deleted_at;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updated_at - a.updated_at;
  });
}

function saveNotesSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushNotesSave, 400);
}

function flushNotesSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const persisted = state.notes.filter((n) => !noteIsEmpty(n) || n.deleted_at);
  saveNotesApi(persisted.map((n) => ({ ...n, title: noteTitle(n) })));
}

function saveFolders() {
  saveFoldersApi(state.folders);
}

/** Like macOS Notes: a note left without any content is discarded. */
function discardIfEmpty(id) {
  const note = findNote(id);
  if (note && !note.deleted_at && noteIsEmpty(note)) {
    state.notes = state.notes.filter((n) => n.id !== id);
  }
}

// ---------- Actions ----------

function selectNote(id, { focus = false, openEditor = true } = {}) {
  if (ui.selectedId !== id && ui.selectedId !== null) {
    discardIfEmpty(ui.selectedId);
    flushNotesSave();
  }
  ui.selectedId = id;
  if (openEditor && !state.desktopMode && id !== null) ui.pane = "editor";
  renderNotes();
  loadSelectedIntoEditor({ focus });
}

function setScope(scope) {
  ui.scope = scope;
  ui.query = "";
  searchInputs.forEach((i) => (i.value = ""));
  if (!state.desktopMode) ui.pane = "list";
  const first = visibleNotes()[0];
  const keep = visibleNotes().some((n) => n.id === ui.selectedId);
  if (state.desktopMode && !keep) selectNote(first?.id ?? null, { openEditor: false });
  else renderNotes();
}

function createNote() {
  if (ui.scope === "trash") ui.scope = "all";
  ui.query = "";
  searchInputs.forEach((i) => (i.value = ""));

  let id = Date.now();
  while (findNote(id)) id++;
  const now = Date.now();
  state.notes.unshift({
    id,
    title: "",
    content: "<h1><br></h1>",
    created_at: new Date(now).toISOString(),
    updated_at: now,
    pinned: false,
    folder_id: scopeFolderId() ?? 0,
    deleted_at: null,
  });
  selectNote(id, { focus: true });
}

function deleteNote(id) {
  const note = findNote(id);
  if (!note) return;
  const list = visibleNotes();
  const idx = list.findIndex((n) => n.id === id);
  const next = list[idx + 1] || list[idx - 1] || null;

  if (note.deleted_at || noteIsEmpty(note)) {
    state.notes = state.notes.filter((n) => n.id !== id);
  } else {
    note.deleted_at = Date.now();
    note.pinned = false;
  }
  flushNotesSave();

  if (ui.selectedId === id) {
    ui.selectedId = null;
    if (!state.desktopMode) {
      ui.pane = "list";
      renderNotes();
      return;
    }
    selectNote(next?.id ?? null, { openEditor: false });
    return;
  }
  renderNotes();
}

function restoreNote(id) {
  const note = findNote(id);
  if (!note) return;
  note.deleted_at = null;
  if (!allFolders().some((f) => f.id === note.folder_id)) note.folder_id = 0;
  note.updated_at = Date.now();
  flushNotesSave();
  if (ui.selectedId === id) {
    // Follows the note back to its folder, like macOS Notes.
    ui.scope = `f:${note.folder_id}`;
    renderNotes();
    loadSelectedIntoEditor();
  } else {
    renderNotes();
  }
}

function togglePin(id) {
  const note = findNote(id);
  if (!note || note.deleted_at) return;
  note.pinned = !note.pinned;
  flushNotesSave();
  renderNotes();
}

function moveNote(id, folderId) {
  const note = findNote(id);
  if (!note) return;
  note.folder_id = folderId;
  if (note.deleted_at) note.deleted_at = null;
  flushNotesSave();
  renderNotes();
}

function createFolder() {
  const names = new Set(allFolders().map((f) => f.name));
  let name = "Nova Pasta";
  for (let i = 2; names.has(name); i++) name = `Nova Pasta ${i}`;
  let id = Date.now();
  while (allFolders().some((f) => f.id === id)) id++;
  state.folders.push({ id, name });
  saveFolders();
  ui.editingFolderId = id;
  ui.scope = `f:${id}`;
  if (state.desktopMode) {
    discardIfEmpty(ui.selectedId);
    ui.selectedId = null;
  }
  renderNotes();
  loadSelectedIntoEditor();
}

function renameFolder(id, name) {
  const folder = state.folders.find((f) => f.id === id);
  ui.editingFolderId = null;
  if (folder && name.trim()) {
    folder.name = name.trim().slice(0, 60);
    saveFolders();
  }
  renderNotes();
}

function deleteFolder(id) {
  const now = Date.now();
  for (const n of state.notes) {
    if (n.folder_id === id && !n.deleted_at) {
      n.deleted_at = now;
      n.pinned = false;
    }
  }
  state.folders = state.folders.filter((f) => f.id !== id);
  saveFolders();
  flushNotesSave();
  if (ui.scope === `f:${id}`) setScope("all");
  else renderNotes();
}

// ---------- Rendering ----------

function renderFolders() {
  foldersEl.innerHTML = "";
  const active = state.notes.filter((n) => !n.deleted_at);
  const trashCount = state.notes.length - active.length;

  const entries = [
    { scope: "all", name: "Todas as Notas", icon: "fa-regular fa-folder-open", count: active.length },
    ...allFolders().map((f) => ({
      scope: `f:${f.id}`,
      folderId: f.id,
      name: f.name,
      icon: "fa-regular fa-folder",
      count: active.filter((n) => n.folder_id === f.id).length,
      editable: f.id !== 0,
    })),
  ];
  if (trashCount > 0 || ui.scope === "trash") {
    entries.push({ scope: "trash", name: "Apagadas Recentemente", icon: "fa-regular fa-trash-can", count: trashCount });
  }

  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "nt-folder";
    li.dataset.scope = entry.scope;
    li.classList.toggle("active", ui.scope === entry.scope && !ui.query.trim());

    const icon = document.createElement("i");
    icon.className = `${entry.icon} nt-folder-icon`;
    li.appendChild(icon);

    if (entry.folderId !== undefined && ui.editingFolderId === entry.folderId) {
      const input = document.createElement("input");
      input.className = "nt-folder-input";
      input.value = entry.name;
      input.maxLength = 60;
      let done = false;
      const commit = (save) => {
        if (done) return;
        done = true;
        if (save) renameFolder(entry.folderId, input.value);
        else {
          ui.editingFolderId = null;
          renderNotes();
        }
      };
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit(true);
        if (e.key === "Escape") commit(false);
      });
      input.addEventListener("blur", () => commit(true));
      input.addEventListener("click", (e) => e.stopPropagation());
      li.appendChild(input);
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    } else {
      const name = document.createElement("span");
      name.className = "nt-folder-name";
      name.textContent = entry.name;
      li.appendChild(name);
    }

    const count = document.createElement("span");
    count.className = "nt-folder-count";
    count.textContent = entry.count;
    li.appendChild(count);

    const chevron = document.createElement("i");
    chevron.className = "fa-solid fa-chevron-right nt-folder-chevron";
    li.appendChild(chevron);

    li.addEventListener("click", () => setScope(entry.scope));
    if (entry.editable) {
      li.addEventListener("dblclick", () => {
        ui.editingFolderId = entry.folderId;
        renderNotes();
      });
    }
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showFolderMenu(e.clientX, e.clientY, entry);
    });

    if (entry.folderId !== undefined) {
      li.addEventListener("dragover", (e) => {
        if (!e.dataTransfer.types.includes("application/x-note-id")) return;
        e.preventDefault();
        li.classList.add("drop-target");
      });
      li.addEventListener("dragleave", () => li.classList.remove("drop-target"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        li.classList.remove("drop-target");
        const id = Number(e.dataTransfer.getData("application/x-note-id"));
        if (id) moveNote(id, entry.folderId);
      });
    }

    foldersEl.appendChild(li);
  }
}

function renderListItem(note, showFolder) {
  const item = document.createElement("div");
  item.className = "nt-item";
  item.dataset.id = note.id;
  item.draggable = true;
  item.classList.toggle("selected", note.id === ui.selectedId);

  const title = document.createElement("div");
  title.className = "nt-item-title";
  if (note.pinned) {
    const pin = document.createElement("i");
    pin.className = "fa-solid fa-thumbtack nt-item-pin";
    title.appendChild(pin);
  }
  title.append(noteTitle(note));

  const meta = document.createElement("div");
  meta.className = "nt-item-meta";
  const date = document.createElement("span");
  date.className = "nt-item-date";
  date.textContent = formatNoteListDate(note.updated_at);
  const preview = document.createElement("span");
  preview.className = "nt-item-preview";
  preview.textContent = notePreview(note);
  meta.append(date, preview);

  item.append(title, meta);

  if (showFolder) {
    const folder = document.createElement("div");
    folder.className = "nt-item-folder";
    folder.innerHTML = `<i class="fa-regular fa-folder"></i>`;
    folder.append(note.deleted_at ? "Apagadas Recentemente" : folderName(note.folder_id));
    item.appendChild(folder);
  }

  item.addEventListener("click", () => {
    selectNote(note.id);
    if (state.desktopMode) listEl.focus({ preventScroll: true });
  });
  item.addEventListener("dblclick", () => focusEditorEnd());
  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showNoteMenu(e.clientX, e.clientY, note);
  });
  item.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("application/x-note-id", String(note.id));
    e.dataTransfer.effectAllowed = "move";
  });
  return item;
}

function renderList() {
  const notes = visibleNotes();
  const showFolder = ui.scope === "all" || !!ui.query.trim();
  listEl.innerHTML = "";

  if (!notes.length) {
    const empty = document.createElement("div");
    empty.className = "nt-list-empty";
    empty.textContent = ui.query.trim() ? "Nenhum resultado" : "Nenhuma Nota";
    listEl.appendChild(empty);
  }

  let groupLabel = null;
  let groupEl = null;
  for (const note of notes) {
    const label =
      ui.scope === "trash"
        ? noteGroupLabel(note.deleted_at)
        : note.pinned
          ? "Fixadas"
          : noteGroupLabel(note.updated_at);
    if (label !== groupLabel) {
      groupLabel = label;
      const header = document.createElement("div");
      header.className = "nt-group-label";
      if (label === "Fixadas") header.innerHTML = `<i class="fa-solid fa-thumbtack"></i> `;
      header.append(label);
      groupEl = document.createElement("div");
      groupEl.className = "nt-group";
      listEl.append(header, groupEl);
    }
    groupEl.appendChild(renderListItem(note, showFolder));
  }

  const label = scopeLabel();
  const count = pluralNotes(notes.length);
  listTitleEl.textContent = label;
  tbFolderEl.textContent = label;
  tbCountEl.textContent = count;
  countEl.textContent = count;
  backLabelEl.textContent = label;
}

function renderChrome() {
  appEl.dataset.pane = ui.pane;
  appEl.classList.toggle("sidebar-hidden", ui.sidebarHidden);
  const editing = state.activeMainView === "notes" && !state.desktopMode && ui.pane === "editor";
  document.body.classList.toggle("notes-editing", editing);

  const note = selectedNote();
  appEl.querySelectorAll('[data-action="pin"]').forEach((btn) => {
    btn.classList.toggle("active", !!note?.pinned);
    btn.disabled = !note || !!note.deleted_at;
  });
  appEl.querySelectorAll('[data-action="delete-note"]').forEach((btn) => (btn.disabled = !note));
  const readOnly = !note || !!note.deleted_at;
  appEl.querySelectorAll("[data-cmd], [data-popover]").forEach((btn) => (btn.disabled = readOnly));
}

export function renderNotes() {
  renderFolders();
  renderList();
  renderChrome();
}

function queueListRender() {
  if (listRenderQueued) return;
  listRenderQueued = true;
  requestAnimationFrame(() => {
    listRenderQueued = false;
    renderList();
  });
}

function loadSelectedIntoEditor({ focus = false } = {}) {
  const note = selectedNote();
  closePopover();
  editorScrollEl.hidden = !note;
  editorEmptyEl.hidden = !!note;
  trashBannerEl.hidden = !note?.deleted_at;
  if (!note) return;
  editorDateEl.textContent = formatNoteFullDate(note.updated_at);
  loadEditor(note.content, { readOnly: !!note.deleted_at, focus });
}

function handleEditorInput(html) {
  const note = selectedNote();
  if (!note || note.deleted_at) return;
  note.content = html;
  note.updated_at = Date.now();
  editorDateEl.textContent = formatNoteFullDate(note.updated_at);
  saveNotesSoon();
  queueListRender();
}

function handleSelectionState(sel) {
  appEl.querySelectorAll('[data-cmd="check"]').forEach((b) => b.classList.toggle("active", sel?.list === "check"));
  appEl.querySelectorAll('[data-cmd="table"]').forEach((b) => b.classList.toggle("active", !!sel?.table));
  if (popoverEl.hidden) return;
  popoverEl.querySelectorAll("[data-style]").forEach((b) => b.classList.toggle("active", sel?.style === b.dataset.style && !sel?.list));
  popoverEl.querySelectorAll("[data-list]").forEach((b) => b.classList.toggle("active", sel?.list === b.dataset.list));
  popoverEl.querySelectorAll("[data-quote]").forEach((b) => b.classList.toggle("active", !!sel?.quote));
  popoverEl.querySelectorAll("[data-inline]").forEach((b) => b.classList.toggle("active", !!sel?.[b.dataset.inline]));
}

// ---------- Popover & context menu ----------

function openPopover(anchor) {
  closeMenu();
  popoverEl.hidden = false;
  popoverEl.classList.toggle("sheet", !state.desktopMode);
  if (state.desktopMode) {
    const a = anchor.getBoundingClientRect();
    const host = appEl.getBoundingClientRect();
    const left = Math.min(a.left - host.left, host.width - popoverEl.offsetWidth - 8);
    popoverEl.style.left = `${Math.max(8, left)}px`;
    popoverEl.style.top = `${a.bottom - host.top + 6}px`;
  } else {
    popoverEl.style.left = "";
    popoverEl.style.top = "";
  }
  anchor.classList.add("active");
  handleSelectionState(getSelectionState());
}

function closePopover() {
  popoverEl.hidden = true;
  appEl.querySelectorAll("[data-popover].active").forEach((b) => b.classList.remove("active"));
}

function showMenu(x, y, items) {
  closePopover();
  menuEl.innerHTML = "";
  for (const item of items) {
    if (item === "sep") {
      const sep = document.createElement("div");
      sep.className = "nt-menu-sep";
      menuEl.appendChild(sep);
      continue;
    }
    if (item.header) {
      const h = document.createElement("div");
      h.className = "nt-menu-header";
      h.textContent = item.header;
      menuEl.appendChild(h);
      continue;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nt-menu-item";
    btn.classList.toggle("danger", !!item.danger);
    btn.classList.toggle("indent", !!item.indent);
    btn.disabled = !!item.disabled;
    btn.innerHTML = `<i class="${item.icon || ""}"></i>`;
    btn.append(item.label);
    btn.addEventListener("click", () => {
      closeMenu();
      item.run();
    });
    menuEl.appendChild(btn);
  }
  menuEl.hidden = false;
  const host = appEl.getBoundingClientRect();
  const left = Math.min(x - host.left, host.width - menuEl.offsetWidth - 6);
  const top = Math.min(y - host.top, host.height - menuEl.offsetHeight - 6);
  menuEl.style.left = `${Math.max(6, left)}px`;
  menuEl.style.top = `${Math.max(6, top)}px`;
}

function closeMenu() {
  menuEl.hidden = true;
}

function showNoteMenu(x, y, note) {
  if (note.deleted_at) {
    showMenu(x, y, [
      { label: "Recuperar", icon: "fa-solid fa-rotate-left", run: () => restoreNote(note.id) },
      "sep",
      { label: "Apagar Permanentemente", icon: "fa-regular fa-trash-can", danger: true, run: () => deleteNote(note.id) },
    ]);
    return;
  }
  showMenu(x, y, [
    {
      label: note.pinned ? "Desafixar Nota" : "Fixar Nota",
      icon: "fa-solid fa-thumbtack",
      run: () => togglePin(note.id),
    },
    "sep",
    { header: "Mover para" },
    ...allFolders().map((f) => ({
      label: f.name,
      icon: "fa-regular fa-folder",
      indent: true,
      disabled: f.id === note.folder_id,
      run: () => moveNote(note.id, f.id),
    })),
    "sep",
    { label: "Apagar", icon: "fa-regular fa-trash-can", danger: true, run: () => deleteNote(note.id) },
  ]);
}

function showFolderMenu(x, y, entry) {
  const items = [{ label: "Nova Pasta", icon: "fa-solid fa-folder-plus", run: createFolder }];
  if (entry.editable) {
    items.push(
      {
        label: "Renomear Pasta",
        icon: "fa-solid fa-pen",
        run: () => {
          ui.editingFolderId = entry.folderId;
          renderNotes();
        },
      },
      "sep",
      { label: "Apagar Pasta", icon: "fa-regular fa-trash-can", danger: true, run: () => deleteFolder(entry.folderId) },
    );
  }
  showMenu(x, y, items);
}

// ---------- Event wiring ----------

const ACTIONS = {
  "new-note": createNote,
  "delete-note": () => ui.selectedId !== null && deleteNote(ui.selectedId),
  restore: () => ui.selectedId !== null && restoreNote(ui.selectedId),
  pin: () => ui.selectedId !== null && togglePin(ui.selectedId),
  "new-folder": createFolder,
  "show-folders": () => {
    ui.pane = "folders";
    renderNotes();
  },
  "show-list": () => {
    discardIfEmpty(ui.selectedId);
    flushNotesSave();
    ui.pane = "list";
    renderNotes();
  },
  "toggle-sidebar": () => {
    ui.sidebarHidden = !ui.sidebarHidden;
    renderChrome();
  },
  desktop: () => enterDesktopMode(),
  tray: () => exitDesktopMode(),
  "close-desktop": () => exitDesktopMode({ visible: false }),
  minimize: minimizeWindow,
  maximize: toggleMaximize,
};

function moveSelection(delta) {
  const list = visibleNotes();
  if (!list.length) return;
  const idx = list.findIndex((n) => n.id === ui.selectedId);
  const next = list[Math.max(0, Math.min(list.length - 1, idx + delta))];
  if (next && next.id !== ui.selectedId) {
    selectNote(next.id, { openEditor: false });
    listEl.querySelector(`.nt-item[data-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
  }
}

function handleGlobalKeydown(e) {
  if (state.activeMainView !== "notes") return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (e.key === "Escape") {
    if (!menuEl.hidden) return closeMenu();
    if (!popoverEl.hidden) return closePopover();
    if (searchInputs.includes(document.activeElement) && ui.query) {
      document.activeElement.value = "";
      ui.query = "";
      return renderNotes();
    }
    if (!state.desktopMode && ui.pane === "editor") return ACTIONS["show-list"]();
    return;
  }
  if (mod && !e.shiftKey && key === "n") {
    e.preventDefault();
    return createNote();
  }
  if (mod && !e.shiftKey && key === "f") {
    e.preventDefault();
    const input = state.desktopMode ? searchInputs[0] : searchInputs[1];
    if (!state.desktopMode && ui.pane !== "list") {
      ui.pane = "list";
      renderNotes();
    }
    input.focus();
    input.select();
  }
}

export function initNotes() {
  initEditor({ onInput: handleEditorInput, onSelection: handleSelectionState });

  appEl.addEventListener("mousedown", (e) => {
    // Toolbar buttons must not take the caret away from the editor.
    if (e.target.closest("[data-cmd], [data-popover]")) e.preventDefault();
    if (!menuEl.hidden && !e.target.closest("#nt-menu")) closeMenu();
    if (!popoverEl.hidden && !e.target.closest("#nt-format-popover, [data-popover]")) closePopover();
  });

  appEl.addEventListener("click", (e) => {
    const popBtn = e.target.closest("[data-popover]");
    if (popBtn) {
      if (popoverEl.hidden) openPopover(popBtn);
      else closePopover();
      return;
    }
    const cmdBtn = e.target.closest("[data-cmd]");
    if (cmdBtn && !cmdBtn.disabled) {
      runCommand(cmdBtn.dataset.cmd);
      return;
    }
    const actionBtn = e.target.closest("[data-action]");
    if (actionBtn && !actionBtn.disabled) ACTIONS[actionBtn.dataset.action]?.();
  });

  for (const input of searchInputs) {
    input.addEventListener("input", () => {
      ui.query = input.value;
      searchInputs.forEach((i) => i !== input && (i.value = input.value));
      renderNotes();
    });
  }

  listEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    } else if ((e.key === "Delete" || e.key === "Backspace") && ui.selectedId !== null) {
      e.preventDefault();
      deleteNote(ui.selectedId);
    } else if (e.key === "Enter") {
      e.preventDefault();
      focusEditorEnd();
    }
  });

  document.addEventListener("keydown", handleGlobalKeydown);
  listEl.addEventListener("scroll", closeMenu);

  document.addEventListener("mainviewchange", () => {
    if (state.activeMainView !== "notes") closePopover();
    renderChrome();
  });

  document.addEventListener("windowmodechange", () => {
    closePopover();
    closeMenu();
    if (state.desktopMode) {
      ui.sidebarHidden = false;
      if (!selectedNote()) {
        const first = visibleNotes()[0];
        if (first) ui.selectedId = first.id;
      }
    } else {
      ui.pane = selectedNote() ? "editor" : "list";
    }
    renderNotes();
    loadSelectedIntoEditor();
  });

  window.addEventListener("beforeunload", () => {
    if (saveTimer) flushNotesSave();
  });

  loadSelectedIntoEditor();
}
