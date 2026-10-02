import { el, icon } from "../utils/dom.js";

// Modais compartilhados (HTTP, Banco): um overlay por aba, com visual .hx-modal.

export const btn = (label, onclick, cls = "hx-btn") => el(`button.${cls}`, { type: "button", onclick }, label);

/** Controla os modais exibidos dentro de `overlayEl` (um de cada vez). */
export function createModalHost(overlayEl) {
  let current = null;

  function isOpen() {
    return !overlayEl.hidden;
  }

  function close() {
    if (!current) return;
    const { onClose } = current;
    current = null;
    overlayEl.hidden = true;
    overlayEl.innerHTML = "";
    onClose?.();
  }

  function open({ title, iconCls, body, footer = [], wide = false, className = "", onClose }) {
    close();
    const box = el(
      "div.hx-modal",
      { role: "dialog", "aria-label": title },
      el(
        "div.hx-modal-head",
        {},
        el("h3", {}, iconCls ? icon(iconCls) : null, title),
        el("button.hx-icon-btn", { type: "button", title: "Fechar (Esc)", onclick: close }, icon("fa-solid fa-xmark")),
      ),
      el("div.hx-modal-body", {}, body),
      footer.length ? el("div.hx-modal-foot", {}, footer) : null,
    );
    box.classList.toggle("wide", wide);
    if (className) box.classList.add(...className.split(" "));
    overlayEl.append(box);
    overlayEl.hidden = false;
    current = { onClose };
    overlayEl.onmousedown = (e) => {
      if (e.target === overlayEl) close();
    };
    return box;
  }

  /** Resolve true/false. `body` substitui a mensagem simples quando informado. */
  function confirm({ title, message, body = null, confirmLabel = "Confirmar", danger = false, wide = false }) {
    return new Promise((resolve) => {
      let answered = false;
      const done = (v) => {
        answered = true;
        resolve(v);
        close();
      };
      const ok = btn(confirmLabel, () => done(true), danger ? "hx-btn.danger" : "hx-btn.primary");
      open({
        title,
        wide,
        body: body || el("p.hx-modal-text", {}, message),
        footer: [btn("Cancelar", () => done(false)), ok],
        onClose: () => !answered && resolve(false),
      });
      ok.focus();
    });
  }

  return { isOpen, close, open, confirm };
}
