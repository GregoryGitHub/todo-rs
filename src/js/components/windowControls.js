import { hideWindowApi, exitAppApi } from "../api.js";

const btnHide = document.getElementById("btn-hide");
const btnMenuToggle = document.getElementById("btn-menu-toggle");
const menuDropdown = document.getElementById("menu-dropdown");
const menuItemHide = document.getElementById("menu-item-hide");
const menuItemQuit = document.getElementById("menu-item-quit");

export function initWindowControls() {
  btnHide.addEventListener("click", () => {
    hideWindowApi();
  });

  btnMenuToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    menuDropdown.hidden = !menuDropdown.hidden;
  });

  menuItemHide.addEventListener("click", () => {
    menuDropdown.hidden = true;
    hideWindowApi();
  });

  menuItemQuit.addEventListener("click", () => {
    exitAppApi();
  });

  document.addEventListener("click", (e) => {
    if (!menuDropdown.hidden && !e.target.closest(".menu-container")) {
      menuDropdown.hidden = true;
    }
  });
}
