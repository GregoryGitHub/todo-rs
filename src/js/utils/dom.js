// Helpers de DOM compartilhados pelos componentes.

/** Tiny DOM helper: el("div.cls", { title: "x", onclick }, child, "text"). */
export function el(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split(".");
  const node = document.createElement(name || "div");
  if (classes.length) node.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null) continue;
    if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === false) {
      if (k in node) node[k] = false;
    }
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "html") node.innerHTML = v;
    else if (k in node && typeof v !== "string") node[k] = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

export const icon = (cls) => el("i", { class: cls });
