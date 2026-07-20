const { invoke } = window.__TAURI__.core;

const listEl = document.getElementById("list");
const formEl = document.getElementById("new-todo");
const inputEl = document.getElementById("input");
const counterEl = document.getElementById("counter");
const emptyEl = document.getElementById("empty");

let todos = [];

async function load() {
  try {
    todos = await invoke("load_todos");
  } catch (e) {
    console.error("load_todos failed", e);
    todos = [];
  }
  render();
}

async function persist() {
  try {
    await invoke("save_todos", { todos });
  } catch (e) {
    console.error("save_todos failed", e);
  }
}

function updateCounter() {
  const pending = todos.filter((t) => !t.done).length;
  counterEl.textContent = pending;
  emptyEl.hidden = todos.length > 0;
}

function render() {
  listEl.innerHTML = "";
  for (const todo of todos) {
    const li = document.createElement("li");
    li.className = "item" + (todo.done ? " done" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = todo.done;
    cb.addEventListener("change", () => {
      todo.done = cb.checked;
      persist();
      render();
    });

    const text = document.createElement("span");
    text.className = "text";
    text.textContent = todo.text;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.setAttribute("aria-label", "Remover");
    del.textContent = "×";
    del.addEventListener("click", () => {
      todos = todos.filter((t) => t.id !== todo.id);
      persist();
      render();
    });

    li.append(cb, text, del);
    listEl.appendChild(li);
  }
  updateCounter();
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  todos.push({ id: Date.now(), text, done: false });
  inputEl.value = "";
  persist();
  render();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    inputEl.value = "";
    inputEl.blur();
  }
});

load();
