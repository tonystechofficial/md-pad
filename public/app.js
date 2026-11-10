import { marked } from "/vendor/marked.esm.js";
import DOMPurify from "/vendor/purify.es.mjs";

const $ = (id) => document.getElementById(id);
const el = {
  list: $("note-list"),
  listStatus: $("list-status"),
  search: $("search"),
  welcome: $("welcome"),
  note: $("note"),
  missing: $("missing"),
  title: $("note-title"),
  status: $("save-status"),
  panes: $("panes"),
  editor: $("editor"),
  preview: $("preview"),
  conflict: $("conflict"),
  conflictText: $("conflict-text"),
  conflictActions: $("conflict-actions"),
  raw: $("raw-link"),
  download: $("download-link"),
};

const SAVE_DELAY_MS = 800;
const narrow = window.matchMedia("(max-width: 760px)");

let notes = [];
/** @type {{id: string, updatedAt: number, saved: string} | null} */
let current = null;
let saveTimer = 0;
let saving = false;
let blocked = false; // a conflict is waiting for the user's choice
let routeToken = 0;

// ---------- API ----------

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json" } : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, ok: res.ok, data };
}

// ---------- Rendering ----------

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
});

function titleOf(content) {
  // Mirror of the server's deriveTitle, close enough for the live header;
  // the server's value replaces it after each save.
  const lines = content.split(/\r?\n/);
  const h1 = lines.find((l) => /^\s{0,3}#\s+\S/.test(l));
  const first = h1 ?? lines.find((l) => l.trim());
  if (!first) return "Sans titre";
  return first.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/[*_`~]+/g, "").trim().slice(0, 120) || "Sans titre";
}

function renderPreview() {
  const content = el.editor.value;
  if (!content.trim()) {
    el.preview.innerHTML = '<p class="empty">Rien à afficher pour l’instant.</p>';
    return;
  }
  const html = marked.parse(content, { gfm: true, breaks: true });
  el.preview.innerHTML = DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "form"], FORBID_ATTR: ["style"] });
}

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

function renderList() {
  el.list.replaceChildren(
    ...notes.map((n) => {
      const li = document.createElement("li");
      if (current && current.id === n.id) li.className = "active";
      const a = document.createElement("a");
      a.href = `/n/${n.id}`;
      a.dataset.link = "";
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = n.title;
      const d = document.createElement("span");
      d.className = "d muted";
      d.textContent = dateFmt.format(n.updatedAt);
      a.append(t, d);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "del";
      del.textContent = "✕";
      del.setAttribute("aria-label", `Supprimer « ${n.title} »`);
      del.addEventListener("click", () => removeNote(n.id, n.title));
      li.append(a, del);
      return li;
    }),
  );
  if (notes.length === 0) {
    el.listStatus.textContent = el.search.value.trim() ? "Aucune note ne correspond." : "Aucune note pour l’instant.";
  } else {
    el.listStatus.textContent = "";
  }
}

async function loadList() {
  const q = el.search.value.trim();
  const { ok, data } = await api(`/api/notes${q ? `?q=${encodeURIComponent(q)}` : ""}`).catch(() => ({ ok: false }));
  if (!ok) {
    el.listStatus.textContent = "Impossible de charger la liste.";
    return;
  }
  if (q !== el.search.value.trim()) return; // a newer search is on its way
  notes = data.notes;
  renderList();
}

function setMode(mode) {
  if (narrow.matches && mode === "split") mode = "edit";
  el.panes.dataset.mode = mode;
  for (const b of document.querySelectorAll(".modes button")) {
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  }
  if (mode !== "edit") renderPreview();
  try {
    localStorage.setItem("md-pad:mode", mode);
  } catch {
    /* storage unavailable */
  }
}

function show(section) {
  for (const s of [el.welcome, el.note, el.missing]) s.hidden = s !== section;
  document.body.classList.toggle("has-note", section !== el.welcome);
}

function hideConflict() {
  blocked = false;
  el.conflict.hidden = true;
  el.conflictActions.replaceChildren();
}

function showConflict(text, actions) {
  blocked = true;
  el.conflictText.textContent = text;
  el.conflictActions.replaceChildren(
    ...actions.map(([label, fn]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    }),
  );
  el.conflict.hidden = false;
}

// ---------- Note lifecycle ----------

function openNote(note) {
  current = { id: note.id, updatedAt: note.updatedAt, saved: note.content };
  el.editor.value = note.content;
  el.title.textContent = note.title;
  document.title = `${note.title} · md-pad`;
  el.raw.href = `/api/notes/${note.id}/raw`;
  el.download.href = `/api/notes/${note.id}/raw?download`;
  el.status.textContent = `Enregistrée le ${dateFmt.format(note.updatedAt)}`;
  hideConflict();
  show(el.note);
  renderPreview();
  renderList();
}

async function createNote(content = "") {
  await flush();
  const { ok, data } = await api("/api/notes", { method: "POST", body: JSON.stringify({ content }) }).catch(() => ({ ok: false }));
  if (!ok) {
    alert(data?.error ?? "Création impossible. Vérifiez la connexion.");
    return;
  }
  history.pushState(null, "", `/n/${data.note.id}`);
  openNote(data.note);
  setMode(narrow.matches || el.panes.dataset.mode === "view" ? "edit" : el.panes.dataset.mode);
  el.editor.focus();
  loadList();
}

async function removeNote(id, title) {
  if (!confirm(`Supprimer définitivement « ${title} » ?`)) return;
  if (current?.id === id) {
    clearTimeout(saveTimer);
    current = null;
  }
  const { status } = await api(`/api/notes/${id}`, { method: "DELETE" }).catch(() => ({ status: 0 }));
  if (status !== 200 && status !== 404) {
    alert("Suppression impossible. Vérifiez la connexion.");
    return;
  }
  if (location.pathname === `/n/${id}`) {
    history.replaceState(null, "", "/");
    route();
  }
  loadList();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  if (!current || blocked) return;
  el.status.textContent = "Modifications non enregistrées…";
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

async function save({ force = false } = {}) {
  clearTimeout(saveTimer);
  if (!current || saving || (blocked && !force)) return;
  const note = current;
  const content = el.editor.value;
  if (content === note.saved && !force) return;

  saving = true;
  el.status.textContent = "Enregistrement…";
  const res = await api(`/api/notes/${note.id}`, {
    method: "PUT",
    body: JSON.stringify({ content, baseUpdatedAt: force ? null : note.updatedAt }),
  }).catch(() => ({ status: 0, data: null }));
  saving = false;
  if (current !== note) return; // the user moved to another note meanwhile

  if (res.status === 200) {
    note.updatedAt = res.data.note.updatedAt;
    note.saved = content;
    el.title.textContent = res.data.note.title;
    document.title = `${res.data.note.title} · md-pad`;
    el.status.textContent = `Enregistrée à ${new Date(note.updatedAt).toLocaleTimeString("fr-FR")}`;
    hideConflict();
    loadList();
    if (el.editor.value !== content) scheduleSave();
  } else if (res.status === 409) {
    const theirs = res.data.note;
    el.status.textContent = "Non enregistrée";
    showConflict("Cette note a été modifiée ailleurs pendant que vous écriviez.", [
      ["Prendre l’autre version", () => openNote(theirs)],
      ["Garder la mienne", () => save({ force: true })],
    ]);
  } else if (res.status === 404) {
    el.status.textContent = "Non enregistrée";
    showConflict("Cette note a été supprimée ailleurs.", [
      ["Enregistrer comme nouvelle note", () => { const text = el.editor.value; current = null; createNote(text); }],
    ]);
  } else {
    el.status.textContent = res.data?.error ?? "Échec de l’enregistrement, nouvel essai dans 5 s.";
    if (res.status !== 413) saveTimer = setTimeout(save, 5000);
  }
}

/** Saves pending edits before leaving the current note. */
async function flush() {
  if (current && !blocked && el.editor.value !== current.saved) await save();
}

// ---------- Routing ----------

async function route() {
  const token = ++routeToken;
  const m = /^\/n\/([A-Za-z0-9]{12})$/.exec(location.pathname);
  if (!m) {
    current = null;
    document.title = "md-pad";
    show(location.pathname === "/" ? el.welcome : el.missing);
    renderList();
    return;
  }
  if (current?.id === m[1]) return;
  const { status, data } = await api(`/api/notes/${m[1]}`).catch(() => ({ status: 0 }));
  if (token !== routeToken) return;
  if (status === 200) {
    openNote(data.note);
  } else {
    current = null;
    show(el.missing);
    renderList();
  }
}

async function navigate(path) {
  await flush();
  if (path !== location.pathname) history.pushState(null, "", path);
  route();
}

// ---------- Events ----------

document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[data-link]");
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(new URL(a.href).pathname);
});
window.addEventListener("popstate", async () => {
  await flush();
  route();
});

$("new-note").addEventListener("click", () => createNote());
$("new-note-2").addEventListener("click", () => createNote());
$("delete-note").addEventListener("click", () => current && removeNote(current.id, el.title.textContent));
$("copy-link").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  try {
    await navigator.clipboard.writeText(location.href);
    b.textContent = "Lien copié";
  } catch {
    prompt("Lien de la note :", location.href);
  }
  setTimeout(() => (b.textContent = "Copier le lien"), 1500);
});
for (const b of document.querySelectorAll(".modes button")) {
  b.addEventListener("click", () => setMode(b.dataset.mode));
}

let previewTimer = 0;
el.editor.addEventListener("input", () => {
  el.title.textContent = titleOf(el.editor.value);
  scheduleSave();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 120);
});
el.editor.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    el.editor.setRangeText("  ", el.editor.selectionStart, el.editor.selectionEnd, "end");
    el.editor.dispatchEvent(new Event("input"));
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save();
  }
});

let searchTimer = 0;
el.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadList, 250);
});

// Leaving the page with unsaved text: send it without waiting for the answer.
window.addEventListener("pagehide", () => {
  if (!current || blocked || el.editor.value === current.saved) return;
  fetch(`/api/notes/${current.id}`, {
    method: "PUT",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: el.editor.value, baseUpdatedAt: current.updatedAt }),
  }).catch(() => {});
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadList();
});

// ---------- Start ----------

let savedMode = "split";
try {
  savedMode = localStorage.getItem("md-pad:mode") ?? "split";
} catch {
  /* storage unavailable */
}
setMode(["edit", "split", "view"].includes(savedMode) ? savedMode : "split");
loadList();
route();
