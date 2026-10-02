// Undo/redo for the note editor.
//
// The browser's native undo stack can't be used: many edits (tables, checklist, quotes,
// block fixes) change the DOM directly and loading another note replaces innerHTML, which
// leaves the native stack inconsistent. Instead each step is a snapshot of the editor HTML,
// the same string the editor already serializes on every change to save the note, so
// recording a step costs no extra serialization. Typing is grouped into word-sized steps.

const MAX_STEPS = 200;
const MAX_CHARS = 3_000_000; // per note (~6 MB of UTF-16); images are URLs, not data
const MAX_NOTES = 10; // notes that keep their history while switching between them
const GROUP_MS = 1200;

/** key -> { stack: [{ html, sel }], index, chars, lastKind, lastTime } */
const histories = new Map();
let current = null;

/** Starts (or resumes) the history of a note. Pass key = null for read-only content. */
export function openHistory(key, html) {
  if (key === null || key === undefined) {
    current = null;
    return;
  }
  let h = histories.get(key);
  if (!h || h.stack[h.index].html !== html) {
    h = { stack: [{ html, sel: null }], index: 0, chars: html.length, lastKind: null, lastTime: 0 };
  }
  // Most recently used last; drop the oldest.
  histories.delete(key);
  histories.set(key, h);
  if (histories.size > MAX_NOTES) histories.delete(histories.keys().next().value);
  h.lastKind = null;
  current = h;
}

export function forgetHistory(key) {
  if (current && histories.get(key) === current) current = null;
  histories.delete(key);
}

/**
 * Records the editor state after a change.
 * kind: "type" | "delete" group with the previous step of the same kind; anything else
 * is a step of its own. wordStart = true starts a new step even while typing.
 */
export function recordHistory(html, kind = "cmd", wordStart = false) {
  const h = current;
  if (!h) return;
  const top = h.stack[h.index];
  if (top.html === html) return;

  const now = Date.now();
  const merge =
    h.index > 0 &&
    h.index === h.stack.length - 1 &&
    (kind === "type" || kind === "delete") &&
    kind === h.lastKind &&
    !wordStart &&
    now - h.lastTime < GROUP_MS;

  if (merge) {
    h.chars += html.length - top.html.length;
    top.html = html;
  } else {
    for (const dropped of h.stack.splice(h.index + 1)) h.chars -= dropped.html.length;
    h.stack.push({ html, sel: null });
    h.index++;
    h.chars += html.length;
    while (h.stack.length > 2 && (h.stack.length > MAX_STEPS || h.chars > MAX_CHARS)) {
      h.chars -= h.stack.shift().html.length;
      h.index--;
    }
  }
  h.lastKind = kind;
  h.lastTime = now;
}

/** Replaces the current state without a new step (follow-up fixes of the last edit). */
export function amendHistory(html) {
  const h = current;
  if (!h) return;
  const top = h.stack[h.index];
  h.chars += html.length - top.html.length;
  top.html = html;
}

/** Remembers where the caret is in the current state (restored on undo/redo). */
export function recordSelection(getSel) {
  if (current) current.stack[current.index].sel = getSel();
}

/** The next change starts a new step (caret moved, click, etc.). */
export function sealHistory() {
  if (current) current.lastKind = null;
}

/** Moves back/forward and returns the state to show, or null. */
export function stepHistory(delta) {
  const h = current;
  if (!h) return null;
  const next = h.index + delta;
  if (next < 0 || next >= h.stack.length) return null;
  h.index = next;
  h.lastKind = null;
  return h.stack[next];
}
