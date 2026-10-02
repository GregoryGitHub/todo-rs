import { el, icon } from "../utils/dom.js";
import { codeEditor } from "./codeEditor.js";

// Editores do DataGrid: o campo sobre a célula e o "Editor de valor" (textos longos, JSON, XML).

/**
 * Campo de edição posicionado sobre a célula, dentro de `container` (área rolável do grid).
 * onCommit(text, move) — move: "" | "right" | "left" | "down"; devolve false para manter aberto (valor inválido).
 */
export function createCellEditor({ container, onCommit, onCancel, onExpand }) {
  const input = el("textarea.dg-editor", { spellcheck: false, rows: 1, wrap: "off" });
  let open = false;
  let committing = false;

  function close() {
    if (!open) return;
    open = false;
    input.remove();
  }

  function commit(move = "") {
    if (!open || committing) return;
    committing = true;
    const ok = onCommit(input.value, move) !== false;
    committing = false;
    if (ok) close();
  }

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      onCancel?.();
    } else if (e.key === "Enter" && (e.ctrlKey || e.altKey)) {
      // Quebra de linha dentro do valor.
      e.preventDefault();
      input.setRangeText("\n", input.selectionStart, input.selectionEnd, "end");
      autoSize();
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      const text = input.value;
      close();
      onExpand?.(text);
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit("down");
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit(e.shiftKey ? "left" : "right");
    }
  });
  input.addEventListener("input", autoSize);
  input.addEventListener("blur", () => commit(""));

  function autoSize() {
    const lines = input.value.split("\n").length;
    input.style.height = `${Math.min(8, Math.max(1, lines)) * 18 + 6}px`;
  }

  return {
    get isOpen() {
      return open;
    },
    open({ left, top, width, height, text, selectAll = true }) {
      close();
      open = true;
      input.value = text;
      Object.assign(input.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(width, 80)}px`, minHeight: `${height}px` });
      container.append(input);
      autoSize();
      input.focus();
      if (selectAll) input.select();
      else input.setSelectionRange(input.value.length, input.value.length);
    },
    commit,
    close,
  };
}

function guessLang(text) {
  const t = text.trim();
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      /* não é JSON */
    }
  }
  if (/^<[\w?!]/.test(t)) return "xml";
  return "text";
}

/**
 * Painel modal sobre o grid para ver/editar um valor grande.
 * onSave(text) | onSetNull() — omitidos quando somente leitura.
 */
export function openValueEditor({ host, title, subtitle = "", text, readOnly, onSave, onSetNull }) {
  const lang = guessLang(text);
  const editor = codeEditor({ value: text, lang, fill: true, readOnly, indent: "  " });
  const info = el("span.dg-ve-info");
  const updateInfo = () => {
    const v = editor.value;
    info.textContent = `${v.length.toLocaleString("pt-BR")} caracteres · ${v.split("\n").length} linhas`;
  };

  const formatBtn = el(
    "button.hx-btn",
    {
      type: "button",
      title: "Formatar JSON",
      hidden: lang !== "json",
      onclick: () => {
        try {
          editor.setValue(JSON.stringify(JSON.parse(editor.value), null, 2));
          editor.input.dispatchEvent(new Event("input"));
        } catch {
          /* inválido: mantém */
        }
      },
    },
    icon("fa-solid fa-wand-magic-sparkles"),
    "Formatar",
  );
  const overlay = el("div.dg-ve-overlay");
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const save = () => {
    if (readOnly) return close();
    onSave(editor.value);
    close();
  };
  const panel = el(
    "div.dg-ve",
    { role: "dialog" },
    el(
      "div.dg-ve-head",
      {},
      el("div.dg-ve-title", {}, el("strong", {}, title), subtitle ? el("span", {}, subtitle) : null),
      el("button.hx-icon-btn", { type: "button", title: "Fechar (Esc)", onclick: close }, icon("fa-solid fa-xmark")),
    ),
    el("div.dg-ve-body", {}, editor.root),
    el(
      "div.dg-ve-foot",
      {},
      info,
      el("span.hx-flex"),
      formatBtn,
      !readOnly && onSetNull ? el("button.hx-btn", { type: "button", onclick: () => (onSetNull(), close()) }, "Definir NULL") : null,
      el("button.hx-btn", { type: "button", onclick: close }, readOnly ? "Fechar" : "Cancelar"),
      readOnly ? null : el("button.hx-btn.primary", { type: "button", title: "Aplicar (Ctrl+Enter)", onclick: save }, "Aplicar"),
    ),
  );
  overlay.append(panel);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      save();
    }
  }
  document.addEventListener("keydown", onKey, true);
  editor.input.addEventListener("input", updateInfo);
  host.append(overlay);
  updateInfo();
  editor.input.focus();
  return close;
}
