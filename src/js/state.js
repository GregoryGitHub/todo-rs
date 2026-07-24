export const state = {
  todos: [],
  notes: [],
  settings: { autostart: false, start_minimized: false },
  currentView: "my_day", // "my_day" | "all"
  activeMainView: "tasks", // "tasks" | "notes" | "settings"
  currentEditingNoteId: null,
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
