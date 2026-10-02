import { state } from "../state.js";
import { saveSettingsApi } from "../api.js";

// Tema do app: preferência "system" | "light" | "dark" salva em settings.json (AppSettings.theme).
// O tema resolvido vai para <html data-theme>; uma cópia no localStorage deixa o script do
// <head> aplicar o tema antes da primeira pintura.

const media = window.matchMedia("(prefers-color-scheme: light)");
const PREFS = ["system", "light", "dark"];

const normalize = (pref) => (PREFS.includes(pref) ? pref : "system");

function resolve(pref) {
  if (pref === "system") return media.matches ? "light" : "dark";
  return pref;
}

function cache(pref) {
  try {
    localStorage.setItem("theme", pref);
  } catch {
    /* sem storage: o tema só pisca na abertura */
  }
}

/** Aplica o tema na página (com transição suave quando `animate`). */
function apply(pref, { animate = false } = {}) {
  const root = document.documentElement;
  const theme = resolve(pref);
  if (animate && root.dataset.theme !== theme) {
    root.classList.add("theme-anim");
    setTimeout(() => root.classList.remove("theme-anim"), 260);
  }
  root.dataset.theme = theme;
  root.dataset.themePref = pref;

  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    const i = btn.querySelector("i");
    if (i) i.className = theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
    btn.title = theme === "dark" ? "Usar tema claro" : "Usar tema escuro";
  });
  document.querySelectorAll("[data-theme-pref]").forEach((btn) => btn.classList.toggle("active", btn.dataset.themePref === pref));
}

export function setThemePreference(pref) {
  pref = normalize(pref);
  state.settings.theme = pref;
  cache(pref);
  apply(pref, { animate: true });
  saveSettingsApi(state.settings);
}

/** Chamado depois de carregar settings.json. */
export function syncThemeFromSettings() {
  const pref = normalize(state.settings.theme);
  state.settings.theme = pref;
  cache(pref);
  apply(pref);
}

export function initTheme() {
  let pref = "system";
  try {
    pref = normalize(localStorage.getItem("theme"));
  } catch {
    /* padrão */
  }
  state.settings.theme = pref;
  apply(pref);

  media.addEventListener("change", () => {
    if (state.settings.theme === "system") apply("system", { animate: true });
  });

  document.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-theme-toggle]");
    if (toggle) {
      // O botão rápido alterna para o oposto do tema visível (fixa a escolha).
      setThemePreference(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
      return;
    }
    const choice = e.target.closest("[data-theme-pref]");
    if (choice) setThemePreference(choice.dataset.themePref);
  });
}
