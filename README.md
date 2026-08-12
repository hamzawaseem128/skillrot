# SkillRot

AI-powered social learning and career development for university students.

Upload a lecture PDF or PowerPoint deck → get swipeable learning cards → ask
questions and get cited answers → see which jobs your coursework is qualifying
you for.

## Quick start

```bash
npm install
# Add your Gemini key to .env.local (see below)
npm run dev
```

Open http://localhost:3000.

### 1. Gemini API key (required)

Grab a free key at https://aistudio.google.com/apikey and put it in `.env.local`:

```
GEMINI_API_KEY=your-key-here
```

Restart `npm run dev` afterwards — Next.js only reads env files at server start.

Without a key the app still loads and PDF upload/extraction works, but card
generation, skill extraction and chat return a clear "API key is missing" message.

### 2. Supabase (optional)

Leave the Supabase variables blank to run against an in-process store: every
feature works, but data is lost when the server restarts. That is enough for a
demo.

For real persistence, create a project at https://supabase.com, run
[`supabase/schema.sql`](supabase/schema.sql) in the SQL Editor, then fill in:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

The schema enables `pgvector`, creates all tables, seeds the `job_roles`
reference data, and turns on RLS so the anon key cannot read student materials.

### 3. Adzuna live job data (optional)

Leave blank to use only the curated role dataset. With free credentials from
https://developer.adzuna.com/ the roadmap **augments** the curated set with live
listings and shows a "live job data" badge:

```
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
ADZUNA_COUNTRY=gb
```

Live roles never replace the curated ones, the request times out after 3.5s, and
any failure falls back silently — so this can't break a demo.

## The three screens

| Route      | What it does                                                           |
| ---------- | ---------------------------------------------------------------------- |
| `/`        | Landing page                                                            |
| `/upload`  | Upload a PDF or paste notes → learning cards + cited Q&A chat           |
| `/roadmap` | Accumulated skills, matched roles, and the gaps between them            |

## API

| Endpoint                     | Method | Purpose                                          |
| ---------------------------- | ------ | ------------------------------------------------ |
| `/api/upload`                | POST   | Extract text (PDF, PPTX or JSON text), store, chunk |
| `/api/materials/[id]/chat`   | POST   | Streaming RAG answer (NDJSON) with citations      |
| `/api/materials/[id]/scenes` | POST   | Narrated lecture scenes for one card              |
| `/api/generate-cards`        | POST   | 5-8 learning cards from stored material           |
| `/api/generate-embeddings`   | POST   | Embed chunks for vector retrieval                 |
| `/api/ask`                   | POST   | Retrieve + answer with citations                  |
| `/api/extract-skills`        | POST   | Structured skills → student profile               |
| `/api/roadmap`               | GET    | Role matches and skill gaps for a user            |

## Narrated lecture player

Each learning card can play as a short narrated video under the **Watch** tab
(**Read** keeps the original static card).

There is no video generation model and no server-side rendering. A card becomes
a lecture through: **Gemini script → Remotion composition → browser speech
synthesis**. `@remotion/player` renders the animation client-side, so the whole
feature costs nothing to host and runs on a Vercel hobby tier.

Eight templates, chosen by the model per scene and deliberately mixed:

| 2D (CSS/spring) | 3D-style (WebGL) |
| --------------- | ---------------- |
| `bullet_reveal`, `diagram`, `formula`, `comparison`, `icon_focus` | `rotating_concept_3d`, `depth_parallax_3d`, `formula_float_3d` |

The 3D templates are **motion graphics with real perspective and depth**, drawn
live by react-three-fiber — not rendered 3D film. Geometry is low-poly and
untextured so it stays smooth on mid-range laptops and phones. The prompt caps
3D at two scenes per segment: a list of definitions doesn't earn a rotating
solid.

### Scene imagery (optional)

With `PEXELS_API_KEY` set, each scene gets a relevant stock photo behind a
Ken Burns zoom/pan, with the required photographer attribution shown in-frame.
Queries are normalised so similar phrasings share one lookup
("gravitational field lines diagram" and "diagram of the gravitational field
lines" hit the same cache key), and results are de-duplicated within a lecture.
Without the key — or when a concept has no photographable subject, in which case
the model returns an empty query on purpose — scenes fall back to their
icon/diagram templates.

### Downloading a lecture

The player records itself to `.webm` in real time using `getDisplayMedia` +
`MediaRecorder`. **This is deliberately not `canvas.captureStream()`**, for two
reasons that are worth knowing before changing it:

1. Remotion's Player renders React **DOM, not a canvas** — there is no drawing
   surface to capture. (Its server renderer screenshots headless Chrome, which
   is the Lambda/Docker path this project cannot use.)
2. `speechSynthesis` exposes no `AudioNode` or `MediaStream`, so its output
   cannot be routed into an `AudioContext` and mixed in. Tab capture is the only
   way to record the narration at all.

Cost of that choice: the viewer gets a permission prompt and must tick "share
tab audio". The player goes fullscreen while recording so the captured frame is
the lecture rather than the page around it.

**How narration stays in sync.** The Remotion timeline is authoritative and the
voice follows it. `speechSynthesis` cannot be seeked, reports no duration before
it starts, and fires `onboundary` inconsistently across browsers — so scene
durations are derived from narration word count (~150 wpm) and narration is
restarted at each scene boundary. Sync is therefore **scene-level, not
word-level**, which is precisely what lets the scrub bar and speed control work.

Scenes are generated on first view of a card and cached in `lecture_scenes`, so
a deck never costs more Gemini calls than the student actually watches.

> Requires the `lecture_scenes` table — run
> [`supabase/migrations/002_lecture_scenes.sql`](supabase/migrations/002_lecture_scenes.sql).
> Without it the player still works; scenes just regenerate on every view.

## Retrieval tiers

`/api/ask` degrades through three strategies, and reports which one it used in
the `strategy` field of the response:

1. **`pgvector`** — cosine distance computed in Postgres via the
   `match_material_chunks` function. The intended production path.
2. **`vector`** — the same cosine similarity computed in-process, when Supabase
   isn't configured or that function hasn't been created.
3. **`keyword`** — term-overlap scoring, when no embeddings exist at all.

Every tier returns real citations pointing at real pages.

## How it holds up in a live demo

Reliability was prioritised over feature breadth (PRD §9):

- **No database?** Falls back to an in-process store. The full flow still works.
- **Embeddings unavailable?** Retrieval drops to keyword scoring, so chat still
  answers from your document with real citations.
- **Card generation down?** Falls back to cards extracted from the document
  itself — real headings and sentences, never canned filler. The response sets
  `degraded: true` and the UI shows a banner saying the text is quoted rather
  than rewritten.
- **API failure?** Routes return a specific, actionable message ("rate limit
  reached", "API key is missing") that the UI displays, not a generic 500.
- **Cards are cached per material**, so re-generating doesn't burn another
  Gemini call. Skill extraction is not cached — it re-runs per request.
- **Transient upstream errors retry** with backoff (503/5xx and rate-limit
  429s). A permanent `limit: 0` quota error is not retried.

## Data scoping

Every material endpoint requires the caller's `user_id` and returns **404** if
the material belongs to someone else — 404 rather than 403, since 403 would
confirm the id exists (PRD §9, no cross-user leakage).

There is no authentication (PRD §4 non-goal): the anonymous `user_id` in
`localStorage` acts as the bearer token for that student's materials and skill
profile. That is sufficient for a demo and **not** sufficient for real student
data — add real auth before deploying this beyond a hackathon.

## Supported input

| Format | Citations read | Notes |
| ------ | -------------- | ----- |
| PDF (`.pdf`) | "Page 4" | Verified to 30 pages (PRD §5.1) |
| PowerPoint (`.pptx`) | "Slide 4" | Parsed straight from the OPC XML — no Office dependency |
| Pasted text | "Section 1" | Minimum 200 characters |

Scanned/image-only PDFs and image-only slides have no extractable text; the
upload returns a message saying so rather than failing silently. There is no OCR.

## Notes

- Citations resolve to real page/slide numbers because chunking preserves page
  boundaries — you get "Page 4" or "Slide 4", not "Section 7".
- `pdf-parse` and `pdfjs-dist` are listed in `serverExternalPackages`
  ([`next.config.ts`](next.config.ts)). They resolve a worker file from disk at
  runtime and fail if bundled.
- Job-role data lives in [`src/lib/job-roles.ts`](src/lib/job-roles.ts) as a
  curated static dataset — deliberately not scraped from live job boards.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS 4 ·
`@remotion/player` + `@remotion/three` (browser-only, no server render) · Gemini
(`gemini-flash-latest` + `gemini-embedding-001`) · Supabase + pgvector (optional)

### Model selection

Defaults are `gemini-flash-latest` and `gemini-embedding-001`, overridable via
`GEMINI_MODEL` / `GEMINI_EMBEDDING_MODEL`. Model availability varies per API
key — some keys return `429 limit: 0` for `gemini-2.0-flash` or `404` for
`text-embedding-004`. If generation fails, list what your key can reach:

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY"
```

Embeddings are requested at **768 dimensions** to match the `vector(768)`
column. `gemini-embedding-001` returns 3072 by default, which exceeds
pgvector's 2000-dimension index limit — changing the model means changing both.
