import { state } from "../state.js";
import { getTodayStr, formatDateLabel } from "../utils/date.js";
import { saveNotesApi } from "../api.js";

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

const FA_TRASH = `<i class="fa-solid fa-trash-can"></i>`;

export function renderNotes() {
  notesListEl.innerHTML = "";
  notesEmptyEl.hidden = state.notes.length > 0;

  for (const note of state.notes) {
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
      state.notes = state.notes.filter((n) => n.id !== note.id);
      saveNotesApi(state.notes);
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

export function openNoteEditor(note = null) {
  if (note) {
    state.currentEditingNoteId = note.id;
    noteModalTitleEl.innerHTML = `<i class="fa-solid fa-pen"></i> Editar Nota`;
    noteTitleInput.value = note.title;
    noteContentInput.value = note.content;
    btnDeleteNote.hidden = false;
  } else {
    state.currentEditingNoteId = null;
    noteModalTitleEl.innerHTML = `<i class="fa-solid fa-plus"></i> Nova Nota`;
    noteTitleInput.value = "";
    noteContentInput.value = "";
    btnDeleteNote.hidden = true;
  }
  modalNoteEditor.hidden = false;
  noteTitleInput.focus();
}

export function initNotes() {
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
    if (state.currentEditingNoteId) {
      state.notes = state.notes.filter((n) => n.id !== state.currentEditingNoteId);
      saveNotesApi(state.notes);
      renderNotes();
    }
    modalNoteEditor.hidden = true;
  });

  btnSaveNote.addEventListener("click", () => {
    const title = noteTitleInput.value.trim();
    const content = noteContentInput.value.trim();

    if (!title && !content) return;

    const todayStr = formatDateLabel(getTodayStr());

    if (state.currentEditingNoteId) {
      const note = state.notes.find((n) => n.id === state.currentEditingNoteId);
      if (note) {
        note.title = title || "Sem título";
        note.content = content;
      }
    } else {
      state.notes.unshift({
        id: Date.now(),
        title: title || "Sem título",
        content,
        created_at: todayStr,
      });
    }

    saveNotesApi(state.notes);
    renderNotes();
    modalNoteEditor.hidden = true;
  });
}
