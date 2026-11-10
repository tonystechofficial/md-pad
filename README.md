# md-pad

A fully public Markdown pad, in the spirit of HedgeDoc, running on the Cloudflare free plan:
one Worker, its static assets, and one D1 database. No accounts: anyone with the address can
list, read, write and delete notes, and each note has its own shareable link.

## Features

- Note list with search (title and content)
- Markdown editor with live preview (GitHub-flavoured Markdown, sanitized with DOMPurify)
- Autosave, with a conflict prompt when someone else saved the same note meanwhile
- Raw view and `.md` download per note
- Delete from the list or from the open note

It is not real-time collaborative: the last save wins, after a prompt.

## Layout

- `src/notes.ts`: pure note logic (ids, title, input validation), tested in `test/`
- `src/index.ts`: the Worker, JSON API under `/api/notes`
- `public/`: the page (no build step; `marked` and `DOMPurify` are copied in by `bun run vendor`)
- `migrations/`: D1 schema

## Run it

```bash
bun install
bun run migrate:local
bun run dev
```

## Deploy on your own account

Create the database, put its id in `wrangler.jsonc`, then migrate and deploy:

```bash
bunx wrangler d1 create md-pad
bun run migrate:remote
bun run deploy
```

## Limits to know

- Everything is public, including deletion. Don't store anything private.
- No rate limiting. Notes are capped at 500 KB.
