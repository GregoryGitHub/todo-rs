import { state } from "../state.js";
import { formatTime } from "../utils/date.js";
import { playChimeSound } from "../utils/audio.js";
import { saveTodosApi } from "../api.js";

const modalPomodoro = document.getElementById("modal-pomodoro");
const pomodoroModalClose = document.getElementById("pomodoro-modal-close");
const pomoTaskNameEl = document.getElementById("pomodoro-task-name");
const pomoModeBadgeEl = document.getElementById("pomodoro-mode-badge");
const pomoBadgeIconEl = document.getElementById("pomo-badge-icon");
const pomoBadgeTextEl = document.getElementById("pomo-badge-text");
const pomoTimeDisplayEl = document.getElementById("pomodoro-time-display");
const btnPomoToggle = document.getElementById("btn-pomo-toggle");
const pomoToggleIconEl = document.getElementById("pomo-toggle-icon");
const pomoToggleTextEl = document.getElementById("pomo-toggle-text");
const btnPomoReset = document.getElementById("btn-pomo-reset");
const pomoWorkInput = document.getElementById("pomo-work-input");
const pomoBreakInput = document.getElementById("pomo-break-input");

let onRenderCallback = () => {};

export function setPomodoroRenderCallback(cb) {
  onRenderCallback = cb;
}

export function openPomodoroModal(todo) {
  state.activePomoTaskId = todo.id;
  state.pomoState.taskId = todo.id;

  pomoTaskNameEl.textContent = todo.text;

  if (!state.pomoState.secondsRemaining || state.pomoState.taskId !== todo.id) {
    state.pomoState.mode = "work";
    state.pomoState.workMinutes = todo.pomoWorkMinutes || 25;
    state.pomoState.breakMinutes = todo.pomoBreakMinutes || 5;
    state.pomoState.secondsRemaining = state.pomoState.workMinutes * 60;
  }

  pomoWorkInput.value = state.pomoState.workMinutes;
  pomoBreakInput.value = state.pomoState.breakMinutes;

  updatePomodoroUI();
  modalPomodoro.hidden = false;
}

export function updatePomodoroUI() {
  pomoTimeDisplayEl.textContent = formatTime(state.pomoState.secondsRemaining);

  if (state.pomoState.mode === "work") {
    pomoModeBadgeEl.className = "pomo-mode-badge work";
    pomoBadgeIconEl.className = "fa-solid fa-brain";
    pomoBadgeTextEl.textContent = "Foco";
  } else {
    pomoModeBadgeEl.className = "pomo-mode-badge break";
    pomoBadgeIconEl.className = "fa-solid fa-mug-hot";
    pomoBadgeTextEl.textContent = "Pausa";
  }

  if (state.pomoState.isRunning) {
    pomoToggleIconEl.className = "fa-solid fa-pause";
    pomoToggleTextEl.textContent = "Pausar";
  } else {
    pomoToggleIconEl.className = "fa-solid fa-play";
    pomoToggleTextEl.textContent = "Iniciar";
  }
}

export function startPomodoroTimer() {
  if (state.pomoState.isRunning) return;

  state.pomoState.isRunning = true;
  updatePomodoroUI();

  state.pomoState.intervalId = setInterval(() => {
    if (state.pomoState.secondsRemaining > 0) {
      state.pomoState.secondsRemaining--;
      pomoTimeDisplayEl.textContent = formatTime(state.pomoState.secondsRemaining);
    } else {
      playChimeSound();
      if (state.pomoState.mode === "work") {
        state.pomoState.mode = "break";
        state.pomoState.secondsRemaining = state.pomoState.breakMinutes * 60;
      } else {
        state.pomoState.mode = "work";
        state.pomoState.secondsRemaining = state.pomoState.workMinutes * 60;
      }
      updatePomodoroUI();
    }
  }, 1000);
}

export function pausePomodoroTimer() {
  if (!state.pomoState.isRunning) return;

  state.pomoState.isRunning = false;
  if (state.pomoState.intervalId) {
    clearInterval(state.pomoState.intervalId);
    state.pomoState.intervalId = null;
  }
  updatePomodoroUI();
}

export function resetPomodoroTimer() {
  pausePomodoroTimer();
  if (state.pomoState.mode === "work") {
    state.pomoState.secondsRemaining = state.pomoState.workMinutes * 60;
  } else {
    state.pomoState.secondsRemaining = state.pomoState.breakMinutes * 60;
  }
  updatePomodoroUI();
}

export function initPomodoro() {
  pomodoroModalClose.addEventListener("click", () => {
    modalPomodoro.hidden = true;
  });

  modalPomodoro.addEventListener("click", (e) => {
    if (e.target === modalPomodoro) {
      modalPomodoro.hidden = true;
    }
  });

  btnPomoToggle.addEventListener("click", () => {
    if (state.pomoState.isRunning) {
      pausePomodoroTimer();
    } else {
      startPomodoroTimer();
    }
    onRenderCallback();
  });

  btnPomoReset.addEventListener("click", () => {
    resetPomodoroTimer();
    onRenderCallback();
  });

  pomoWorkInput.addEventListener("change", () => {
    let val = parseInt(pomoWorkInput.value, 10);
    if (isNaN(val) || val < 1) val = 25;
    state.pomoState.workMinutes = val;

    const currentTodo = state.todos.find((t) => t.id === state.pomoState.taskId);
    if (currentTodo) {
      currentTodo.pomoWorkMinutes = val;
      saveTodosApi(state.todos);
    }

    if (state.pomoState.mode === "work" && !state.pomoState.isRunning) {
      state.pomoState.secondsRemaining = val * 60;
      updatePomodoroUI();
    }
  });

  pomoBreakInput.addEventListener("change", () => {
    let val = parseInt(pomoBreakInput.value, 10);
    if (isNaN(val) || val < 1) val = 5;
    state.pomoState.breakMinutes = val;

    const currentTodo = state.todos.find((t) => t.id === state.pomoState.taskId);
    if (currentTodo) {
      currentTodo.pomoBreakMinutes = val;
      saveTodosApi(state.todos);
    }

    if (state.pomoState.mode === "break" && !state.pomoState.isRunning) {
      state.pomoState.secondsRemaining = val * 60;
      updatePomodoroUI();
    }
  });
}
