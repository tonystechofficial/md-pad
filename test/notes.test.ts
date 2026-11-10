import { describe, expect, it } from "vitest";
import {
  MAX_CONTENT_BYTES,
  MAX_TITLE_LENGTH,
  deriveTitle,
  isValidId,
  newId,
  parseNoteInput,
  rawFileName,
} from "../src/notes";

describe("deriveTitle", () => {
  it("takes the first level-1 heading", () => {
    expect(deriveTitle("intro\n\n# Mon titre\n\ntexte")).toBe("Mon titre");
  });

  it("falls back to the first non-empty line, without markdown markers", () => {
    expect(deriveTitle("\n\n## Sous-titre **gras**\nsuite")).toBe("Sous-titre gras");
    expect(deriveTitle("- [ ] acheter du pain")).toBe("acheter du pain");
  });

  it("returns 'Sans titre' for empty or blank content", () => {
    expect(deriveTitle("")).toBe("Sans titre");
    expect(deriveTitle("   \n\t\n")).toBe("Sans titre");
  });

  it("caps the title length", () => {
    const title = deriveTitle("# " + "a".repeat(500));
    expect(title.length).toBe(MAX_TITLE_LENGTH);
  });

  it("ignores a heading marker inside a fenced code block", () => {
    expect(deriveTitle("```\n# commentaire\n```\n# Vrai titre")).toBe("Vrai titre");
  });
});

describe("ids", () => {
  it("generates url-safe ids of 12 characters that validate", () => {
    const id = newId();
    expect(id).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(isValidId(id)).toBe(true);
  });

  it("generates different ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "abc", "a".repeat(13), "abc/def12345", "../../etc/pw", "abcdefghijk!"]) {
      expect(isValidId(bad)).toBe(false);
    }
  });
});

describe("parseNoteInput", () => {
  it("accepts content and derives the title", () => {
    expect(parseNoteInput({ content: "# Salut\ncorps" })).toEqual({
      ok: true,
      value: { content: "# Salut\ncorps", title: "Salut", baseUpdatedAt: null },
    });
  });

  it("accepts an empty note", () => {
    const r = parseNoteInput({ content: "" });
    expect(r.ok && r.value.title).toBe("Sans titre");
  });

  it("carries baseUpdatedAt when it is an integer", () => {
    const r = parseNoteInput({ content: "x", baseUpdatedAt: 1700000000000 });
    expect(r.ok && r.value.baseUpdatedAt).toBe(1700000000000);
  });

  it("rejects a non-object body or a non-string content", () => {
    for (const bad of [null, "texte", 42, [], {}, { content: 12 }, { content: null }]) {
      const r = parseNoteInput(bad);
      expect(r).toEqual({ ok: false, status: 400, error: expect.any(String) });
    }
  });

  it("rejects a malformed baseUpdatedAt", () => {
    for (const bad of ["12", 1.5, -1, NaN]) {
      expect(parseNoteInput({ content: "x", baseUpdatedAt: bad }).ok).toBe(false);
    }
  });

  it("rejects content over the size limit, counted in UTF-8 bytes", () => {
    const justUnder = "a".repeat(MAX_CONTENT_BYTES);
    expect(parseNoteInput({ content: justUnder }).ok).toBe(true);
    // "é" is 2 bytes: half the characters, one byte too many
    const over = "é".repeat(MAX_CONTENT_BYTES / 2) + "a";
    expect(parseNoteInput({ content: over })).toEqual({
      ok: false,
      status: 413,
      error: expect.any(String),
    });
  });
});

describe("rawFileName", () => {
  it("builds a safe .md file name from the title", () => {
    expect(rawFileName("Réunion du 10/11 : notes?", "abc")).toBe("Reunion-du-10-11-notes.md");
  });

  it("falls back to the id when nothing usable is left", () => {
    expect(rawFileName("???", "abcDEF123456")).toBe("abcDEF123456.md");
  });
});
