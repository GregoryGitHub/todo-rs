export const state = {
  todos: [],
  notes: [],
  folders: [], // pastas criadas pelo usuário; a pasta padrão "Notas" (id 0) é implícita
  settings: { autostart: false, start_minimized: false },
  currentView: "my_day", // "my_day" | "all"
  activeMainView: "tasks", // "tasks" | "notes" | "settings"
  desktopMode: false, // true = janela grande estilo app Notas do macOS
  notesUI: {
    scope: "all", // "all" | "trash" | "f:<folderId>"
    selectedId: null,
    query: "",
    pane: "list", // modo bandeja: "folders" | "list" | "editor"
    sidebarHidden: false,
    editingFolderId: null,
  },
  activePomoTaskId: null,
  pomoState: {
    taskId: null,
    mode: "work", // 'work' | 'break'
    workMinutes: 25,
    breakMinutes: 5,
    secondsRemaining: 25 * 60,
    isRunning: false,
    intervalId: null,
  },
};
