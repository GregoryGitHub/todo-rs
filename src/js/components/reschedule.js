import { state } from "../state.js";
import { getTodayStr, getTomorrowStr } from "../utils/date.js";
import { saveTodosApi } from "../api.js";
import { renderTasks } from "./tasks.js";

const modalReschedule = document.getElementById("modal-reschedule");
const btnRescheduleOpen = document.getElementById("btn-reschedule-open");
const modalClose = document.getElementById("modal-close");
const btnCancelReschedule = document.getElementById("btn-cancel-reschedule");
const btnConfirmReschedule = document.getElementById("btn-confirm-reschedule");
const rescheduleDateInput = document.getElementById("reschedule-date");

export function initRescheduleModal() {
  btnRescheduleOpen.addEventListener("click", () => {
    rescheduleDateInput.value = getTomorrowStr();
    modalReschedule.hidden = false;
  });

  modalClose.addEventListener("click", () => {
    modalReschedule.hidden = true;
  });

  btnCancelReschedule.addEventListener("click", () => {
    modalReschedule.hidden = true;
  });

  modalReschedule.addEventListener("click", (e) => {
    if (e.target === modalReschedule) {
      modalReschedule.hidden = true;
    }
  });

  btnConfirmReschedule.addEventListener("click", () => {
    const targetDate = rescheduleDateInput.value;
    if (!targetDate) return;

    const today = getTodayStr();
    let movedCount = 0;

    for (const todo of state.todos) {
      if (!todo.done) {
        todo.date = targetDate;
        todo.is_my_day = targetDate === today;
        movedCount++;
      }
    }

    modalReschedule.hidden = true;
    if (movedCount > 0) {
      saveTodosApi(state.todos);
      renderTasks();
    }
  });
}
