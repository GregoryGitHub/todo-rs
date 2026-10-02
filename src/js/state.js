export const state = {
  todos: [],
  notes: [],
  folders: [], // pastas criadas pelo usuário; a pasta padrão "Notas" (id 0) é implícita
  settings: { autostart: false, start_minimized: false },
  currentView: "my_day", // "my_day" | "all"
  activeMainView: "tasks", // "tasks" | "notes" | "http" | "json" | "settings"
  desktopMode: false, // true = janela grande (Notas, HTTP e JSON)
  notesUI: {
    scope: "all", // "all" | "trash" | "f:<folderId>"
    selectedId: null,
    query: "",
    pane: "list", // modo bandeja: "folders" | "list" | "editor"
    sidebarHidden: false,
    editingFolderId: null,
  },
  http: null, // documento de http.json normalizado por normalizeHttpData
  httpUI: {
    scope: null, // "all" | "history" | "c:<collectionId>"
    selectedId: null, // id da requisição (ou da entrada do histórico quando scope === "history")
    query: "",
    pane: "list", // modo bandeja: "collections" | "list" | "editor"
    side: "request", // modo bandeja: "request" | "response"
    sidebarHidden: false,
    editingCollectionId: null,
    editingFolderId: null,
    reqTab: "params",
    resTab: "body",
    bodyView: "pretty", // "pretty" | "raw" | "preview"
    wrap: false,
    split: 0.48, // modo desktop: fração da altura usada pela requisição
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
