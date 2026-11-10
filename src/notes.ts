// Pure note logic: no database, no network. Tested in test/notes.test.ts.

/** D1 caps a string/row at 2 MB; stay well under it. */
export const MAX_CONTENT_BYTES = 500_000;
export const MAX_TITLE_LENGTH = 120;
export const ID_LENGTH = 12;

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ID_PATTERN = new RegExp(`^[A-Za-z0-9]{${ID_LENGTH}}$`);

export function newId(): string {
  // 62 symbols: reject bytes >= 248 so every symbol is equally likely.
  let id = "";
  while (id.length < ID_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH * 2));
    for (const b of bytes) {
      if (b < 248 && id.length < ID_LENGTH) id += ID_ALPHABET[b % 62];
    }
  }
  return id;
}

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

function stripMarkdown(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "") // heading
    .replace(/^\s*>\s?/, "") // quote
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, "") // bullet, task box
    .replace(/^\s*\d+[.)]\s+/, "") // numbered item
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // link, image
    .replace(/[*_`~]+/g, "") // emphasis, code
    .replace(/\s+/g, " ")
    .trim();
}

export function deriveTitle(content: string): string {
  let inFence = false;
  let firstLine: string | null = null;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h1 = /^\s{0,3}#\s+(.+)$/.exec(line);
    if (h1) {
      const t = stripMarkdown(line);
      if (t) return t.slice(0, MAX_TITLE_LENGTH);
    }
    if (firstLine === null) {
      const t = stripMarkdown(line);
      if (t) firstLine = t;
    }
  }
  return (firstLine ?? "Sans titre").slice(0, MAX_TITLE_LENGTH);
}

export interface NoteInput {
  content: string;
  title: string;
  /** updated_at the client last saw; null = write without conflict check. */
  baseUpdatedAt: number | null;
}

export type ParseResult =
  | { ok: true; value: NoteInput }
  | { ok: false; status: 400 | 413; error: string };

export function parseNoteInput(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Le corps doit être un objet JSON." };
  }
  const { content, baseUpdatedAt } = body as Record<string, unknown>;
  if (typeof content !== "string") {
    return { ok: false, status: 400, error: "« content » doit être une chaîne." };
  }
  let base: number | null = null;
  if (baseUpdatedAt !== undefined && baseUpdatedAt !== null) {
    if (typeof baseUpdatedAt !== "number" || !Number.isInteger(baseUpdatedAt) || baseUpdatedAt < 0) {
      return { ok: false, status: 400, error: "« baseUpdatedAt » doit être un entier positif." };
    }
    base = baseUpdatedAt;
  }
  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Note trop longue (maximum ${MAX_CONTENT_BYTES / 1000} ko).`,
    };
  }
  return { ok: true, value: { content, title: deriveTitle(content), baseUpdatedAt: base } };
}

export function rawFileName(title: string, id: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || id}.md`;
}
