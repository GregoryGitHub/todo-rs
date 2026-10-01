import { sanitizeHtml, escapeHtml } from "../utils/noteContent.js";

// Rich-text editor (contenteditable) modeled on the macOS Notes app.

const editor = document.getElementById("nt-editor");
const tableTools = document.getElementById("nt-table-tools");
const scroller = document.getElementById("nt-editor-scroll");

const BLOCK_TAGS = new Set(["H1", "H2", "H3", "P", "DIV", "UL", "OL", "PRE", "BLOCKQUOTE", "TABLE"]);
const STYLE_TAGS = { title: "h1", heading: "h2", subheading: "h3", body: "p", mono: "pre" };
const AUTO_LISTS = { "-": "dash", "–": "dash", "*": "bullet", "•": "bullet", "1.": "number", "1)": "number", "[]": "check" };

let onChange = () => {};
let onSelectionState = () => {};

function exec(cmd, value = null) {
  document.execCommand(cmd, false, value);
}

function selectionRange() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer) ? range : null;
}

function closestInEditor(selector) {
  const range = selectionRange();
  if (!range) return null;
  let node = range.startContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  const found = node?.closest(selector);
  return found && editor.contains(found) && found !== editor ? found : null;
}

function placeCaret(el, atEnd = false) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function changed() {
  fixBlockNesting();
  onChange(editor.innerHTML);
  updateTableTools();
  emitSelectionState();
}

/** Keeps every top-level node inside a block (typing into an empty editor creates bare text). */
function normalizeTopLevel() {
  if (!editor.firstChild) {
    editor.innerHTML = "<h1><br></h1>";
    placeCaret(editor.firstChild);
    return;
  }
  const sel = window.getSelection();
  const anchor = sel.anchorNode;
  const offset = sel.anchorOffset;
  let wrap = null;
  let moved = false;
  for (const node of [...editor.childNodes]) {
    const isBlock = node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName);
    if (isBlock) {
      wrap = null;
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim() && node !== anchor) {
      node.remove();
      continue;
    }
    if (!wrap) {
      wrap = document.createElement(node === editor.firstChild ? "h1" : "p");
      editor.insertBefore(wrap, node);
    }
    wrap.appendChild(node);
    moved = true;
  }
  if (moved && anchor && editor.contains(anchor)) sel.collapse(anchor, offset);
}

/** Chrome sometimes nests lists/tables inside <p> or headings; lift them back out. */
function fixBlockNesting() {
  const bad = () => editor.querySelector(":is(p,h1,h2,h3,pre) > :is(ul,ol,table,p,h1,h2,h3,pre,blockquote)");
  if (!bad()) return;
  const sel = window.getSelection();
  const anchor = sel.anchorNode;
  const offset = sel.anchorOffset;
  let el;
  while ((el = bad())) {
    const parent = el.parentElement;
    const rest = [...parent.childNodes];
    const meaningful = rest.filter((n) => n !== el && !(n.nodeName === "BR" || (n.nodeType === Node.TEXT_NODE && !n.textContent.trim())));
    if (!meaningful.length) {
      parent.replaceWith(...rest.filter((n) => n.nodeName !== "BR"));
    } else {
      // Move the block (and anything after it) out, after the paragraph.
      const idx = rest.indexOf(el);
      parent.after(...rest.slice(idx));
    }
  }
  if (anchor && editor.contains(anchor)) sel.collapse(anchor, Math.min(offset, anchor.length ?? anchor.childNodes.length));
}

// ---------- Block styles ----------

function currentBlock() {
  return closestInEditor("h1,h2,h3,p,pre,li,td,th,div,blockquote");
}

function setBlockStyle(style) {
  const tag = STYLE_TAGS[style];
  if (!tag) return;
  const list = closestInEditor("ul,ol");
  if (list && tag !== "p") {
    // A heading cannot live inside a list item: leave the list first.
    exec(list.tagName === "OL" ? "insertOrderedList" : "insertUnorderedList");
  }
  exec("formatBlock", `<${tag}>`);
}

function toggleQuote() {
  const quote = closestInEditor("blockquote");
  if (quote) {
    const range = selectionRange();
    const marker = range?.startContainer;
    const offset = range?.startOffset;
    const children = [...quote.childNodes];
    if (!children.some((c) => c.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(c.tagName))) {
      const p = document.createElement("p");
      p.append(...children);
      quote.replaceWith(p);
    } else {
      quote.replaceWith(...children);
    }
    if (marker && editor.contains(marker)) window.getSelection().collapse(marker, offset);
    changed();
    return;
  }
  exec("formatBlock", "<blockquote>");
}

// ---------- Lists ----------

function listKind(list) {
  if (list.tagName === "OL") return "number";
  if (list.classList.contains("checklist")) return "check";
  if (list.classList.contains("dashed")) return "dash";
  return "bullet";
}

function setListKind(list, kind) {
  list.classList.toggle("checklist", kind === "check");
  list.classList.toggle("dashed", kind === "dash");
  if (!list.className) list.removeAttribute("class");
  if (kind !== "check") list.querySelectorAll(":scope > li.checked").forEach((li) => li.classList.remove("checked"));
}

function applyList(kind) {
  const wantsOl = kind === "number";
  const cmd = wantsOl ? "insertOrderedList" : "insertUnorderedList";
  const list = closestInEditor("ul,ol");

  if (list) {
    if (listKind(list) === kind) {
      exec(cmd); // same style again = remove the list
      changed();
      return;
    }
    if ((list.tagName === "OL") !== wantsOl) exec(cmd);
  } else {
    const block = closestInEditor("h1,h2,h3,pre");
    if (block) exec("formatBlock", "<p>");
    exec(cmd);
  }

  const newList = closestInEditor("ul,ol");
  if (newList) setListKind(newList, kind);
  changed();
}

// ---------- Tables ----------

function makeTable(rows, cols) {
  const table = document.createElement("table");
  table.className = "nt-table";
  const tbody = document.createElement("tbody");
  for (let r = 0; r < rows; r++) {
    const tr = document.createElement("tr");
    for (let c = 0; c < cols; c++) {
      const td = document.createElement("td");
      td.innerHTML = "<br>";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function insertTable() {
  if (closestInEditor("table")) return;
  editor.focus();
  let block = selectionRange() ? closestInEditor("h1,h2,h3,p,pre,div,ul,ol,blockquote") : null;
  while (block && block.parentElement !== editor) block = block.parentElement;

  const table = makeTable(3, 3);
  const isEmpty = block && !block.textContent.trim() && block !== editor.firstElementChild;
  if (isEmpty) block.replaceWith(table);
  else if (block) block.after(table);
  else editor.appendChild(table);

  if (!table.nextElementSibling) {
    const p = document.createElement("p");
    p.innerHTML = "<br>";
    table.after(p);
  }
  placeCaret(table.querySelector("td"));
  changed();
}

function cellPosition(cell) {
  const row = cell.parentElement;
  const table = cell.closest("table");
  return { table, row, rows: [...table.rows], col: cell.cellIndex };
}

function newCell(tag = "td") {
  const c = document.createElement(tag);
  c.innerHTML = "<br>";
  return c;
}

function addRow(cell, after = true) {
  const { row } = cellPosition(cell);
  const tr = document.createElement("tr");
  for (let i = 0; i < row.cells.length; i++) tr.appendChild(newCell());
  if (after) row.after(tr);
  else row.before(tr);
  return tr;
}

function addColumn(cell, after = true) {
  const { rows, col } = cellPosition(cell);
  for (const r of rows) {
    const ref = r.cells[col];
    const c = newCell(ref?.tagName === "TH" ? "th" : "td");
    if (!ref) r.appendChild(c);
    else if (after) ref.after(c);
    else ref.before(c);
  }
}

function removeTable(table) {
  const next = table.nextElementSibling || table.previousElementSibling;
  table.remove();
  if (next) placeCaret(next, true);
  else normalizeTopLevel();
}

function deleteRow(cell) {
  const { table, row, rows, col } = cellPosition(cell);
  if (rows.length <= 1) return removeTable(table);
  const target = row.nextElementSibling || row.previousElementSibling;
  row.remove();
  placeCaret(target.cells[Math.min(col, target.cells.length - 1)]);
}

function deleteColumn(cell) {
  const { table, row, rows, col } = cellPosition(cell);
  if (row.cells.length <= 1) return removeTable(table);
  for (const r of rows) r.cells[col]?.remove();
  placeCaret(row.cells[Math.min(col, row.cells.length - 1)]);
}

function tableAction(action) {
  const cell = closestInEditor("td,th");
  if (!cell) return;
  const table = cell.closest("table");
  switch (action) {
    case "row-above": placeCaret(addRow(cell, false).cells[cell.cellIndex]); break;
    case "row-below": placeCaret(addRow(cell, true).cells[cell.cellIndex]); break;
    case "col-left": addColumn(cell, false); placeCaret(cell.previousElementSibling); break;
    case "col-right": addColumn(cell, true); placeCaret(cell.nextElementSibling); break;
    case "del-row": deleteRow(cell); break;
    case "del-col": deleteColumn(cell); break;
    case "del-table": removeTable(table); break;
    case "header-row": {
      const first = table.rows[0];
      const toTh = first.cells[0].tagName === "TD";
      for (const c of [...first.cells]) {
        const repl = document.createElement(toTh ? "th" : "td");
        repl.append(...c.childNodes);
        c.replaceWith(repl);
      }
      placeCaret(first.cells[0], true);
      break;
    }
  }
  changed();
}

function moveCell(cell, backwards) {
  const cells = [...cell.closest("table").querySelectorAll("td,th")];
  const idx = cells.indexOf(cell);
  if (backwards) {
    if (idx > 0) placeCaret(cells[idx - 1], true);
    return;
  }
  if (idx < cells.length - 1) {
    placeCaret(cells[idx + 1], true);
  } else {
    const tr = addRow(cell, true);
    placeCaret(tr.cells[0]);
    changed();
  }
}

function moveCellDown(cell) {
  const { row, col } = cellPosition(cell);
  let next = row.nextElementSibling;
  if (!next) {
    next = addRow(cell, true);
    changed();
  }
  placeCaret(next.cells[Math.min(col, next.cells.length - 1)], true);
}

function updateTableTools() {
  const cell = closestInEditor("td,th");
  if (!cell || editor.contentEditable !== "true") {
    tableTools.hidden = true;
    return;
  }
  const table = cell.closest("table");
  const tRect = table.getBoundingClientRect();
  const sRect = scroller.getBoundingClientRect();
  tableTools.hidden = false;
  const maxLeft = scroller.clientWidth - tableTools.offsetWidth - 4;
  tableTools.style.top = `${tRect.bottom - sRect.top + scroller.scrollTop + 6}px`;
  tableTools.style.left = `${Math.max(4, Math.min(maxLeft, tRect.left - sRect.left + scroller.scrollLeft))}px`;
}

// ---------- Checklist ----------

function handleChecklistClick(e) {
  const li = e.target.closest?.("ul.checklist > li");
  if (!li || !editor.contains(li) || editor.contentEditable !== "true") return;
  const rect = li.getBoundingClientRect();
  if (e.clientX >= rect.left) return;
  e.preventDefault();
  li.classList.toggle("checked");
  changed();
}

// ---------- Key handling ----------

function tryAutoFormat(e) {
  const range = selectionRange();
  if (!range || !range.collapsed) return false;
  const block = closestInEditor("p,div,h2,h3");
  if (!block || block.closest("li,td,th,pre")) return false;
  const text = block.textContent;
  const kind = AUTO_LISTS[text];
  if (!kind) return false;
  // Caret must be right after the marker.
  const probe = document.createRange();
  probe.selectNodeContents(block);
  probe.setEnd(range.startContainer, range.startOffset);
  if (probe.toString() !== text) return false;

  e.preventDefault();
  block.innerHTML = "<br>";
  placeCaret(block);
  applyList(kind);
  return true;
}

const SHORTCUTS = {
  T: () => setBlockStyle("title"),
  H: () => setBlockStyle("heading"),
  J: () => setBlockStyle("subheading"),
  B: () => setBlockStyle("body"),
  M: () => setBlockStyle("mono"),
  L: () => applyList("check"),
  "&": () => applyList("number"),
  7: () => applyList("number"),
  8: () => applyList("bullet"),
};

function handleKeydown(e) {
  if (editor.contentEditable !== "true") return;
  const mod = e.ctrlKey || e.metaKey;

  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (mod && e.shiftKey && SHORTCUTS[key]) {
    e.preventDefault();
    SHORTCUTS[key]();
    changed();
    return;
  }
  if (mod && e.altKey && e.key.toLowerCase() === "t") {
    e.preventDefault();
    insertTable();
    return;
  }
  if (mod && !e.shiftKey && e.key.toLowerCase() === "d") {
    e.preventDefault();
    exec("strikeThrough");
    changed();
    return;
  }

  const cell = closestInEditor("td,th");
  if (cell) {
    if (e.key === "Tab") {
      e.preventDefault();
      moveCell(cell, e.shiftKey);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      moveCellDown(cell);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      exec("insertLineBreak");
      return;
    }
  }

  if (e.key === "Tab" && closestInEditor("li")) {
    e.preventDefault();
    exec(e.shiftKey ? "outdent" : "indent");
    const list = closestInEditor("ul,ol");
    const parent = list?.parentElement?.closest("ul,ol");
    if (list && parent) setListKind(list, listKind(parent));
    changed();
    return;
  }

  if (e.key === "Tab") {
    e.preventDefault();
    exec("insertText", "\t");
    return;
  }

  if (e.key === " " && tryAutoFormat(e)) return;

  if (e.key === "Enter" && closestInEditor("ul.checklist > li")) {
    // The browser clones the "checked" class onto the new item.
    setTimeout(() => {
      closestInEditor("ul.checklist > li")?.classList.remove("checked");
    });
  }
}

function handlePaste(e) {
  e.preventDefault();
  if (editor.contentEditable !== "true") return;
  const html = e.clipboardData.getData("text/html");
  const text = e.clipboardData.getData("text/plain");
  if (html) {
    exec("insertHTML", sanitizeHtml(html));
  } else if (text) {
    if (closestInEditor("pre,td,th") || !text.includes("\n")) {
      exec("insertText", text);
    } else {
      const paragraphs = text.split(/\r?\n/).map((l) => (l ? `<p>${escapeHtml(l)}</p>` : "<p><br></p>"));
      exec("insertHTML", paragraphs.join(""));
    }
  }
  normalizeTopLevel();
  changed();
}

// ---------- Selection state (toolbar highlighting) ----------

export function getSelectionState() {
  if (!selectionRange()) return null;
  const block = currentBlock();
  const list = closestInEditor("ul,ol");
  const tag = block?.tagName;
  const style = { H1: "title", H2: "heading", H3: "subheading", PRE: "mono" }[tag] || "body";
  return {
    style,
    list: list ? listKind(list) : null,
    quote: !!closestInEditor("blockquote"),
    table: !!closestInEditor("table"),
    // Headings are bold by style; only explicit <b>/<strong> counts as "Bold".
    bold: !!closestInEditor("b,strong"),
    italic: document.queryCommandState("italic"),
    underline: document.queryCommandState("underline"),
    strike: document.queryCommandState("strikeThrough"),
  };
}

function emitSelectionState() {
  onSelectionState(getSelectionState());
}

// ---------- Public API ----------

/** Runs a toolbar command ("title", "bullet", "check", "table", "bold"...). */
export function runCommand(cmd) {
  if (editor.contentEditable !== "true") return;
  if (!selectionRange()) {
    editor.focus();
    placeCaret(editor.lastElementChild || editor, true);
  }
  switch (cmd) {
    case "title":
    case "heading":
    case "subheading":
    case "body":
    case "mono":
      setBlockStyle(cmd);
      break;
    case "quote":
      toggleQuote();
      return;
    case "bullet":
    case "dash":
    case "number":
    case "check":
      applyList(cmd);
      return;
    case "table":
      insertTable();
      return;
    case "bold":
    case "italic":
    case "underline":
      exec(cmd);
      break;
    case "strike":
      exec("strikeThrough");
      break;
    case "indent":
    case "outdent":
      exec(cmd);
      break;
    default:
      if (cmd.startsWith("tbl:")) return tableAction(cmd.slice(4));
      return;
  }
  changed();
}

export function loadEditor(html, { readOnly = false, focus = false } = {}) {
  editor.innerHTML = html || "<h1><br></h1>";
  editor.contentEditable = readOnly ? "false" : "true";
  tableTools.hidden = true;
  scroller.scrollTop = 0;
  if (focus && !readOnly) {
    editor.focus();
    placeCaret(editor.lastElementChild || editor, true);
  }
}

export function focusEditorEnd() {
  if (editor.contentEditable !== "true") return;
  editor.focus();
  placeCaret(editor.lastElementChild || editor, true);
}

export function initEditor({ onInput, onSelection }) {
  onChange = onInput;
  onSelectionState = onSelection;

  exec("defaultParagraphSeparator", "p");
  exec("styleWithCSS", false);

  editor.addEventListener("input", () => {
    normalizeTopLevel();
    changed();
  });
  editor.addEventListener("keydown", handleKeydown);
  editor.addEventListener("paste", handlePaste);
  editor.addEventListener("mousedown", handleChecklistClick);
  editor.addEventListener("drop", (e) => e.preventDefault());

  document.addEventListener("selectionchange", () => {
    if (!selectionRange()) return;
    updateTableTools();
    emitSelectionState();
  });
  scroller.addEventListener("scroll", updateTableTools);
  window.addEventListener("resize", updateTableTools);

  // Table toolbar buttons must not steal the caret from the cell.
  tableTools.addEventListener("mousedown", (e) => e.preventDefault());
  tableTools.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tbl]");
    if (btn) tableAction(btn.dataset.tbl);
  });
}
