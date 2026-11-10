import { isValidId, newId, parseNoteInput, rawFileName } from "./notes";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface NoteRow {
  id: string;
  title: string;
  content: string;
  size: number;
  created_at: number;
  updated_at: number;
}

const LIST_LIMIT = 500;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

function error(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

function toNote(row: NoteRow) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    size: row.size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

async function listNotes(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const columns = "id, title, size, created_at, updated_at";
  const stmt = q
    ? env.DB.prepare(
        `SELECT ${columns} FROM notes
         WHERE instr(lower(title), lower(?1)) > 0 OR instr(lower(content), lower(?1)) > 0
         ORDER BY updated_at DESC LIMIT ?2`,
      ).bind(q, LIST_LIMIT)
    : env.DB.prepare(`SELECT ${columns} FROM notes ORDER BY updated_at DESC LIMIT ?1`).bind(
        LIST_LIMIT,
      );
  const { results } = await stmt.all<Omit<NoteRow, "content">>();
  return json({
    notes: results.map((r) => ({
      id: r.id,
      title: r.title,
      size: r.size,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
}

async function createNote(env: Env, request: Request): Promise<Response> {
  const parsed = parseNoteInput(await readBody(request));
  if (!parsed.ok) return error(parsed.status, parsed.error);
  const { content, title } = parsed.value;
  const now = Date.now();
  const row: NoteRow = {
    id: newId(),
    title,
    content,
    size: new TextEncoder().encode(content).length,
    created_at: now,
    updated_at: now,
  };
  await env.DB.prepare(
    "INSERT INTO notes (id, title, content, size, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
  )
    .bind(row.id, row.title, row.content, row.size, now)
    .run();
  return json({ note: toNote(row) }, 201);
}

async function getNote(env: Env, id: string): Promise<NoteRow | null> {
  return env.DB.prepare("SELECT * FROM notes WHERE id = ?1").bind(id).first<NoteRow>();
}

async function updateNote(env: Env, id: string, request: Request): Promise<Response> {
  const parsed = parseNoteInput(await readBody(request));
  if (!parsed.ok) return error(parsed.status, parsed.error);
  const { content, title, baseUpdatedAt } = parsed.value;
  const size = new TextEncoder().encode(content).length;
  // updated_at doubles as the version: it must strictly grow, even within one millisecond.
  // The conflict check is part of the UPDATE itself, so two writers can't both pass it.
  const updated = await env.DB.prepare(
    `UPDATE notes
     SET title = ?2, content = ?3, size = ?4, updated_at = max(?5, updated_at + 1)
     WHERE id = ?1 AND (?6 IS NULL OR updated_at = ?6)
     RETURNING *`,
  )
    .bind(id, title, content, size, Date.now(), baseUpdatedAt)
    .first<NoteRow>();
  if (updated) return json({ note: toNote(updated) });

  const current = await getNote(env, id);
  if (!current) return error(404, "Note introuvable.");
  return error(409, "La note a été modifiée ailleurs entre-temps.", { note: toNote(current) });
}

async function deleteNote(env: Env, id: string): Promise<Response> {
  const res = await env.DB.prepare("DELETE FROM notes WHERE id = ?1").bind(id).run();
  if (res.meta.changes === 0) return error(404, "Note introuvable.");
  return json({ deleted: id });
}

async function rawNote(env: Env, id: string, download: boolean): Promise<Response> {
  const note = await getNote(env, id);
  if (!note) return new Response("Note introuvable.\n", { status: 404 });
  const headers = new Headers({
    // text/plain, never text/html: the content is untrusted.
    "content-type": download ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
  });
  if (download) {
    headers.set("content-disposition", `attachment; filename="${rawFileName(note.title, note.id)}"`);
  }
  return new Response(note.content, { headers });
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "notes", id?, "raw"?]
  if (parts[1] !== "notes" || parts.length > 4) return error(404, "Route inconnue.");
  const method = request.method;

  if (parts.length === 2) {
    if (method === "GET") return listNotes(env, url);
    if (method === "POST") return createNote(env, request);
    return error(405, "Méthode non autorisée.");
  }

  const id = parts[2]!;
  if (!isValidId(id)) return error(404, "Note introuvable.");

  if (parts.length === 4) {
    if (parts[3] !== "raw") return error(404, "Route inconnue.");
    if (method !== "GET") return error(405, "Méthode non autorisée.");
    return rawNote(env, id, url.searchParams.has("download"));
  }

  if (method === "GET") {
    const note = await getNote(env, id);
    return note ? json({ note: toNote(note) }) : error(404, "Note introuvable.");
  }
  if (method === "PUT") return updateNote(env, id, request);
  if (method === "DELETE") return deleteNote(env, id);
  return error(405, "Méthode non autorisée.");
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        console.error(e);
        return error(500, "Erreur interne.");
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
