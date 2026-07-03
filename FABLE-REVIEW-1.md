# FABLE-REVIEW-1 — Omnighost plugin, folder structure, and book build

Date: 2026-07-03 · Reviewed at commit `28c7e56` (main, clean tree)

Scope: (1) full review of the plugin source, (2) design for nesting all blog folders
under `Ghost Posts/<domain>`, (3) why the books lack screenshots, (4) why the troff
PDF has word-spacing errors. Findings are verified against the code and the built
artifacts in `docs/book/dist/`.

---

## 1. Executive summary

- **Plugin**: architecture is sound and Obsidian-rule compliance is strong (no
  `fetch`, no `innerHTML`, `registerEvent` everywhere, keychain secrets, ARIA).
  The biggest risk is not a bug but provenance: **`main.js` is a hand-edited
  artifact and `main.ts` was reconstructed from it** — they have never been in a
  compile relationship (`handoff.md` says so explicitly). Second biggest:
  **JWT internals are logged to the console**. Full findings in §2.
- **Folder structure**: the nested `Ghost Posts/<domain>` layout is cheap to add.
  Routing is already frontmatter-based (`g_blog`), all folder checks already use
  `startsWith(folder + '/')` (nesting-safe), and the domain normalizer you need
  (`hostOf()`, `main.ts:790`) already exists. Design in §3.
- **Screenshots**: the EPUBs contain all 10 figures. The **typst PDF is missing
  3 of 5 screenshots** (the ones written as raw HTML `<img>` tags, which pandoc
  drops for non-HTML output). The **troff PDF contains zero images** — pandoc's
  ms writer emits every image as a comment. Details in §4.
- **Troff formatting**: three verified defects — (a) **no fonts are embedded**,
  so viewers substitute fonts with different metrics, producing exactly the
  "gaps too big or missing" symptom; (b) groff is run **without the `tbl`
  preprocessor**, so the Appendix B property table renders as raw `T{ … T}`
  garbage; (c) fully justified text stretches badly around inline code. Fixes in §5.

---

## 2. Plugin code review

### Architecture snapshot (as-built)

- Routing is **per-note, via the `g_blog` frontmatter list**, not per-folder.
  `resolveBlogsForFile()` (`main.ts:943`) tokenizes `g_blog` and matches tokens
  against each blog's domain, name, or aliases (`blogMatchesToken`, `main.ts:810`),
  falling back to the default blog.
- Each `GhostBlog` (`src/types.ts:5`) carries its own `folder`, keychain secret
  name, and optional per-blog sync interval. The folder governs only which files
  are swept by auto/periodic sync (`syncBlogFolder` `main.ts:464`, `syncAllRouted`
  `main.ts:1082`), import destinations, and archive targets — not routing.
- Sync writes per-blog identity keys back into the note
  (`g_id_<domain>`, `g_url_<domain>`, `g_public_url_<domain>`, `main.ts:1042-1052`),
  with legacy `g_id`/`g_url` read for compatibility.
- `SyncEngine` (`src/sync/sync-engine.ts`) is single-target; `setActiveBlog()`
  re-points it per blog inside the routing loop. API access is JWT over
  `requestUrl` (`src/ghost/api-client.ts`), images are content-hash deduped and
  uploaded before publish (`src/ghost/image-uploader.ts`).

### Findings, ranked

**H1 — `main.js` and `main.ts` are parallel hand-maintained copies, not a build pair.**
`handoff.md` documents that `main.js` was hand-edited and `main.ts`/`src/**` were
reconstructed from it afterward, syntax-transpiled but never type-checked.
`main_ts.patch` and `main.ts.changes` are committed drift scaffolding.
*Risk*: the shipped bundle can diverge from the reviewed source; a clean
`npm run build` may not even compile.
*Fix*: run `npm run build` from `main.ts`, resolve whatever `tsc` surfaces
(see M2/M3 below — the handoff itself lists the likely blockers), ship the real
bundle, and delete `main_ts.patch`, `main.ts.changes`, and `handoff.md`.

**H2 — Admin-credential internals logged to console.**
`src/ghost/api-client.ts:48-88` logs the secret length, whether it's hex, the
encoded JWT header, encoded payload, and the **signature**; `main.ts:561,579`
log the secret name and key length. These are `console.debug`, which the eslint
config allows, so they ship.
*Fix*: delete the JWT-internal logs outright; never log token parts or signatures.

**H3 — Every new blog defaults to the same folder `'Ghost Posts'`.**
`main.ts:2342` (Add blog) and `migrateBlogs` (`main.ts:896`) both default to the
bare root. Two blogs left at the default share one sweep set, so periodic sync
and `syncAllRouted` collect the same files for multiple blogs, and archive/index
folder attribution becomes ambiguous. The §3 folder redesign fixes this
structurally; short of that, at least refuse identical folders in settings.

**M1 — `g_blog` is written in two different key styles.**
Modal paths write the blog **name** (`openSetBlogsModal` `main.ts:1112`,
edit-properties save `main.ts:1294`); import/link paths write the **domain key**
(`main.ts:700,1169,1390`). It works today only because `blogMatchesToken` accepts
both and a rename migration patches names. Standardize on the domain key
(`blogPropertyYaml`) everywhere — it's the stable one.

**M2 — Dead code, some of it flagged by the handoff as build blockers.**
`SyncEngine.deletePostForFile` (`sync-engine.ts:481`, never called, reads the
legacy id key), `periodicSyncInterval` field (`main.ts:50`, never assigned),
`ensureInSyncFolder` (`main.ts:1430`, never called), and the entire
`src/converters/markdown-to-html.ts` module (sync uses `markdown-to-lexical`;
the unused converter also has real ordering bugs in its regexes). Delete all four.

**M3 — `this.app.secretStorage` is accessed with no type augmentation**
(`main.ts:565,571,873,875,2289`). If the installed `obsidian` typings don't
declare it, a clean `tsc` fails — verify during the H1 rebuild or add a
`declare module 'obsidian'` augmentation.

**M4 — Frontmatter writes use `vault.read` → `vault.modify`** throughout
(`main.ts:1064,1297,1607,1676`, …). That's a non-atomic read-modify-write that
can clobber concurrent edits and races the metadata cache when several keys are
written in sequence. Use `app.vault.process(file, fn)` for background mutations
(rule #11) and the Editor API when the file is open (rule #10).

**Low**: legacy single-blog commands still key off `settings.ghostUrl`/`syncFolder`
and bypass routing (`main.ts:595,615,633,1449,1514`); `blogClients` map isn't
cleared in `onunload` (`main.ts:436`); 66 `console.debug` calls across the tree
(noisy even where harmless); status bar uses emoji text instead of `setIcon`
(`main.ts:477`); the HTML→MD import converter is intentionally lossy — fine, but
worth a line in the README.

**Compliance positives (verified)**: `requestUrl` everywhere, no
`innerHTML`/`outerHTML`, no regex lookbehind, consistent `normalizePath`,
`registerEvent` for all listeners, intervals cleared in `onunload`, keychain
secrets, ARIA + keyboard navigation on calendar and modals, no default hotkeys,
manifest naming rules all pass.

---

## 3. Proposed folder structure: `Ghost Posts/<domain>`

**Goal**: every blog lives in a nested subfolder under one root, named by
normalized domain — `Ghost Posts/collected.ga`, `Ghost Posts/chief.sc` — derived
automatically from the blog's admin URL.

**Why it's cheap**: routing never depends on folder location (it's `g_blog`
frontmatter), every folder-membership test already matches subpaths
(`f.path === folder || f.path.startsWith(folder + '/')`), and the exact
normalizer already exists: `hostOf(url)` (`main.ts:790`) returns
`hostname`, lowercased, `www.` stripped — i.e. `collected.ga`, `chief.sc`.
`archiveTargetFor` (`main.ts:1636`) already picks the *longest* matching base
folder, so nested blog folders resolve correctly even with the root also present.

### Design

1. **New setting** `ghostPostsRoot` (default `'Ghost Posts'`), replacing the
   legacy `syncFolder` as the umbrella. Keep `syncFolder` read-only for migration.
2. **Auto-derive per-blog folder**:
   `folder = normalizePath(`${ghostPostsRoot}/${hostOf(blog.url)}`)`.
   Compute it when a blog is added (`main.ts:2342`) and recompute in the URL
   field's `onChange` (`main.ts:2266`) whenever the folder is still in "auto"
   state. Keep the folder text field as a manual override; treat a blank field
   as "auto".
3. **Migration**: for existing blogs whose folder is the bare root or blank,
   offer (one-time notice or settings button) to move their notes into
   `Ghost Posts/<domain>/` via `fileManager.renameFile` (link-safe), then update
   `blog.folder`. Notes route by frontmatter, so a partial or deferred move
   breaks nothing — files sync fine from either location.
4. **Root semantics**: today `isArchivePath`/`fileInAnyBlogFolder`
   (`main.ts:1628,1684`) include the legacy root as a "blog folder", so a stray
   note directly in `Ghost Posts/` would be swept by sync-all once blogs nest
   under it. Decide explicitly: recommended — notes directly under the root
   belong to the **default blog** (preserves current behavior for existing
   vaults), and each `<domain>` subfolder implies that blog.
5. **Optional nicety**: when a note sits in `Ghost Posts/<domain>/` with no
   `g_blog` key, infer that blog from the path instead of the global default.
   That makes the folder tree *the* mental model (drag a note into
   `chief.sc/` → it publishes to chief.sc) while frontmatter still wins when set.
6. **Archive layout** follows automatically:
   `Ghost Posts/<domain>/_archived/…` via the existing `archiveTargetFor`
   longest-prefix logic — verify with a test, no code change expected.

**Touch points** (all small): `types.ts:51`, `main.ts:896` (migrateBlogs),
`main.ts:2266` (URL onChange), `main.ts:2317` (folder field), `main.ts:2342`
(Add blog), plus the root-semantics decision in `main.ts:1628-1689` and
`main.ts:1082-1101`. No changes needed in `SyncEngine`, converters, or the
frontmatter layer. This also structurally resolves finding **H3**.

---

## 4. Book: missing screenshots

The manuscript references **10 figures**: 5 diagrams (`docs/book/diagrams/*.png`)
and 5 screenshots (`docs/book/media/file{2,3,4,6,7}.png`). Verified contents of
the built artifacts:

| Artifact | Figures present | Missing |
|---|---|---|
| EPUBs (both) | all 10 | — |
| `obsidian-typst.pdf` | 7 (5 diagrams + file3, file4) | **file2, file6, file7** |
| `obsidian-troff.pdf` | **0** (`pdfimages -list` is empty; 76 KB vs 474 KB) | all 10 |

**Root cause 1 — raw HTML images.** file2, file6, and file7 are written as raw
`<img src="…" alt="…" />` tags (`omnighost.md:253,444,498`) while file3/file4 use
Markdown syntax (`omnighost.md:289,321`). Pandoc passes raw HTML through to EPUB
but **silently drops it** for typst and ms output.
*Fix*: convert the three `<img>` tags to native Markdown images. The long alt
texts work fine in Markdown: `![A note's Properties panel…](docs/book/media/file2.png)`.
If they were HTML for sizing control, use pandoc figure attributes
(`![alt](path){width=80%}`) instead — those survive all writers.

**Root cause 2 — pandoc's ms writer has no image support.** In the generated
`.ms`, every image becomes a comment (`\" .IMAGE "…png"` or `[IMAGE: ]`), so
the troff PDF can never contain figures via the default writer.
*Fix options*, in increasing effort:
- Accept a text-only troff edition and say so on its cover (cheapest, honest).
- Post-process the `.ms` in `build.sh`: convert each referenced PNG to PDF
  (`mutool convert` / ImageMagick), then replace the image comments with
  `.PDFPIC file.pdf 4.5i` (supported by groff ≥ 1.23's pdf device).
- Use a small pandoc Lua filter that emits the `.PDFPIC` requests directly —
  cleaner than sed once it exists; pairs naturally with the mermaid.lua filter
  already in the tree.

Also worth doing: `build.sh` should fail loudly when pandoc reports skipped
content — currently pandoc's "skipping raw HTML" warnings scroll by and the
build still exits 0.

---

## 5. Book: troff formatting errors

Three verified defects in `obsidian-troff.pdf`:

**T1 — No fonts are embedded (the word-gap bug).** `pdffonts` shows every font
(Times-Roman/Bold/Italic, Courier, Courier-Bold) with `emb: no`, while the typst
PDF embeds subsetted fonts. groff computed line layout with its own Times/Courier
metrics, but the viewer substitutes whatever local font it maps those names to —
glyph widths differ, so words render squeezed together (gaps "missing") or
spread apart (gaps "too big"), varying by reader/device. This is the primary
cause of the reported symptom.
*Fix*: embed fonts at build time. In `build.sh:109,118`, change

```sh
groff -Tpdf -ms "$body_ms" > "$body_pdf"
```

to

```sh
groff -Tpdf -P-e -t -ms "$body_ms" > "$body_pdf"
```

`-P-e` tells gropdf to embed the fonts (needs the Type 1 font files available to
groff on the Termux build machine — verify `gropdf -e` works there; if the base-14
fonts aren't shipped, install `groff` full package or download the URW fonts).
As a belt-and-braces check, add a `pdffonts | grep 'no  no'` assertion to the build.

**T2 — Tables render as raw tbl markup.** The pandoc ms output contains a
`.TS … .TE` table (Appendix B property reference), but `build.sh` never runs the
`tbl` preprocessor, so the PDF shows literal `delim(@@) tab( ); lw(23.3n)… T{
Property T}…` running text (visible on page 12 of the current PDF).
*Fix*: the `-t` flag included above. Apply to the cover invocation too in case
covers ever grow a table.

**T3 — Loose justification around inline code.** Body text is set fully
justified (ms default) and the manuscript is dense with long unhyphenatable
tokens (`g_published_at`, URLs, `ghost_published`), which forces very wide
inter-word spaces on some lines even after T1 is fixed.
*Fix (optional, taste)*: prepend `.ds FAM T` aside, set ragged-right for the
body — inject `.na` / `.hy 1` via `--include-in-header` (a small `.ms` preamble
file) or accept justified text once real font metrics (T1) tighten it. Given the
book's code-heavy prose, ragged-right will look noticeably better.

**Also noted**: `pandoc -t ms` correctly escapes UTF-8 punctuation to groff
escapes (`\(em`, `\(cq`), so no `-k`/preconv issue exists; and the ToC of the
troff build lands mid-document rather than up front (`pandoc --toc` for ms
places it where groff's `.TC` would — verify placement after the T1/T2 rebuild,
groff needs `-U` + `pdfmark` tweaks or a two-pass build to front-load it).

---

## 6. Suggested order of attack

1. **Rebuild from source** (H1): `npm run build`, fix M2/M3 blockers, commit the
   real `main.js`, delete the drift files. Everything else assumes this baseline.
2. **Strip credential logging** (H2) — one-file change, ship with the rebuild.
3. **Folder structure** (§3): new root setting + auto-derived `<domain>` folders
   + migration mover; closes H3 as a side effect.
4. **Book, troff**: add `-t -P-e` to the groff invocations (§5 T1/T2) — two-line
   fix with outsized impact.
5. **Book, screenshots**: convert the 3 raw `<img>` tags to Markdown (§4 fix 1) —
   restores them in the typst PDF immediately; decide separately whether the
   troff edition gets `.PDFPIC` images or stays text-only.
6. Then the M-level plugin cleanups (g_blog key style, `vault.process`, dead code).
