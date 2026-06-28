# Changelog

All notable changes to the Ghost Updater plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-06-28

### Added
- **Multiple Ghost blogs.** Configure several blogs in Settings, each with its own site address, Admin API key (keychain secret), and folder. The legacy single-blog config is migrated automatically into the first blog.
- **Per-note blog selection.** "Set blog(s) for this note" command opens a picker; the chosen blogs are stored in the note's `g_blog` property and stick. A note can target several blogs at once — syncing publishes/updates all of them (one-to-many). The last blog you pick becomes the default for new notes.
- **Import all posts.** "Import all posts from a ghost blog" command fetches every post from the chosen blog and writes each as a note in that blog's folder, tagged with `g_blog`.

### Changed
- Sync routing is now blog-aware: a single-blog note tracks its post by `ghost_id` (robust); a multi-blog note matches each blog by slug. "Sync all" walks every blog folder.

## [0.6.0] - 2026-06-28

Release **Pessoa** — publishing UX and reliability milestone (see RELEASES.md). Rolls up the 0.4.x–0.5.x properties modal, prefix migration, separate image-cache file, and the validation/indicator fixes into a named release. No code change since 0.5.3.

## [0.5.3] - 2026-06-28

### Fixed
- **Modal status indicator no longer shows "Published" after a failed sync.** Save writes `published` to the note immediately, so the green check used to appear even when the sync errored. The indicator now shows Published/Scheduled only when a public URL exists (written only after a successful publish), and Draft otherwise.

## [0.5.2] - 2026-06-28

### Fixed
- **Over-long slug validation error.** A note with no `# heading` derived its title from the first body line (a whole paragraph), producing a slug over Ghost's 191-character limit. The title now comes from the first H1 heading or the note's filename (never the first paragraph), the slug is capped at 191 chars, and the title at 255.

## [0.5.1] - 2026-06-28

### Fixed
- **Setting an excerpt no longer causes a Ghost validation error.** The plugin now sends `custom_excerpt` (the writable Admin API field, capped at 300 chars) instead of the read-only `excerpt` field. Sending a non-empty `excerpt` was rejected by Ghost.

## [0.5.0] - 2026-06-27

### Added
- **"Migrate ghost property prefix" command.** Renames every Ghost frontmatter key across all notes from the current prefix to a new one (e.g. `ghost_` -> `g_`), preserving values, and updates the plugin setting. Useful so the property names fit better in Obsidian's native Properties panel.

## [0.4.8] - 2026-06-27

### Fixed
- **Property-only edits now sync without a body edit.** Sync merges the metadata cache (which reflects Properties-UI edits immediately) with the on-disk frontmatter, so changing `post_access`, `published`, etc. takes effect on the next sync even before the file is flushed to disk.

## [0.4.7] - 2026-06-27

### Changed
- **Test Connection now reports the blog title** — e.g. "Successfully connected to Strongly Typed AI News" — instead of a generic message, so you can confirm you're connected to the right site.

## [0.4.6] - 2026-06-27

### Changed
- **The image cache now lives in its own file** (`image-cache.json` in the plugin folder), separate from `data.json`. Existing caches are migrated automatically on load. This means resetting or deleting `data.json` no longer touches the image cache, and clearing the cache never touches your settings.

## [0.4.5] - 2026-06-27

### Added
- **"Clear ghost image cache" command** — empties the cached image-upload map without touching any other settings, so you never need to delete `data.json` (which would also wipe your Ghost URL, sync folder, and prefix).

## [0.4.4] - 2026-06-27

### Fixed
- **Empty note no longer errors on sync.** An empty body produced an empty Lexical document, which Ghost rejected; it now publishes with a single empty paragraph. The title also falls back to the note's filename when there is no heading.

### Changed
- The Edit Ghost properties modal is **wider** and wraps long property labels, so names aren't cramped.

## [0.4.3] - 2026-06-27

### Added
- **Copy button** next to the public URL in the properties modal.
- After **Save & sync**, the modal stays open and **refreshes in place** — the published status and live public URL appear without reopening.

### Changed
- On first publish, identifiers (`ghost_id`, editor URL, public URL) are written back **immediately** instead of after a 3-second delay. Safe now that re-syncs read `ghost_id` from disk; also closes the brief create-then-resync duplicate window.

## [0.4.2] - 2026-06-27

### Added
- The Edit Ghost properties modal now shows a **status indicator** (check = published, clock = scheduled, circle = draft) and, for published/scheduled posts, the **public URL as a clickable link** (from `<prefix>public_url`).

## [0.4.1] - 2026-06-27

### Added
- Open the Edit Ghost properties modal from a **ribbon icon** and the **editor right-click menu**, in addition to the command.

## [0.4.0] - 2026-06-27

### Added
- **Edit Ghost properties modal** (command: "Edit ghost properties (modal)"). Dropdowns for Status (Draft / Publish now / Schedule) and Visibility (Public / Members only / Paid) so invalid values are impossible; free text only for tags, slug, excerpt, and feature image. The publish-date field appears only when scheduling. **Save** writes the frontmatter (preserving non-Ghost keys); **Save & sync** also pushes to Ghost. Non-sticky — closes on save.
- **`cover_from_first_image` flag.** The cover-swallow (first body image becomes the feature image and is removed from the body) is now **opt-in per note** via this flag, instead of happening automatically whenever no feature image was set. Toggle it in the modal or set `<prefix>cover_from_first_image: true`.

### Changed
- New posts include `cover_from_first_image: false` in the template.

## [0.3.4] - 2026-06-27

### Fixed
- **Frontmatter changes now take effect on sync.** All Ghost metadata (not just `ghost_id`/slug) is read from the file on disk, so toggling `published`, changing `post_access`, etc. in the Properties UI applies on the next sync without having to edit the body to "wake up" the metadata cache.
- **`post_access` is now case- and whitespace-insensitive.** Typing `Public` (or `PUBLIC`, ` public `) no longer silently falls back to `paid`.

## [0.3.3] - 2026-06-27

### Fixed
- **Duplicate posts on update.** The create/update decision read `ghost_id` from Obsidian's metadata cache, which can lag right after a note is edited or the plugin reloads — causing a note that already has a `ghost_id` to be **created as a duplicate** (often a new draft) instead of updated. The id and slug are now read from the file on disk (via `parseYaml`) as the source of truth, and the id is also recognized under `ghost_id` / `g_id` regardless of the configured prefix.

## [0.3.2] - 2026-06-27

### Added
- README: "Via BRAT" install instructions for auto-updating beta installs.

### Fixed
- Lint/type cleanups for community-plugin submission: typed the image-reference rewrite callbacks, sentence-cased UI strings, and excluded build output from linting.

### Added
- **Seed a note from an existing Ghost post by slug.** When a note has an explicit `g_slug` but no `ghost_id`, you can pull the live post into the note (Ghost → Obsidian) to bootstrap it: metadata and body are written into the note and `ghost_id` is recorded, so later edits push in place.
  - New command: **"Seed note from existing Ghost post (by slug)"**.
  - Automatic on sync when the note has an explicit slug, no `ghost_id`, and an **empty body** — seeds instead of pushing an empty note over the live post (closes a data-loss path). Notes with any body content still publish.

### Notes
- Seeding converts Ghost's HTML to markdown; since Ghost stores Lexical, the reconstructed body is a close approximation, intended for bootstrapping.

## [0.3.0] - 2026-06-27

Renamed to **Ghost Updater** — a fork of [Ghost Writer Manager](https://github.com/diegoeis/ghost-writer-manager-plugin) by Diego Eis (MIT), focused on publishing and reliably updating Ghost posts from Obsidian on desktop and iOS.

### Added
- **Public URL in frontmatter**: for a published or scheduled post, the post's public URL is written as `g_public_url`, just below the editor URL (`g_url`), on create and on update.
- **Image publishing**: local images (`![alt](path)` and Obsidian `![[embed]]`) are uploaded to Ghost's Images API and references are rewritten to the hosted URLs.
- **Cover-image trick**: when a note has no `g_feature_image`, the first image becomes the post cover and is removed from the body so it isn't shown twice.
- **Content-hash image cache**: uploaded images are cached by SHA-256 of their bytes, so unchanged images are not re-uploaded across syncs.
- **Update-by-slug adoption**: when a note has no `ghost_id` but sets an explicit `g_slug`, an existing Ghost post with that slug is updated in place instead of creating a duplicate (auto-derived slugs never adopt, to avoid accidental overwrites).

### Changed
- New posts default to `g_post_access: public` (was `paid`), so notes publish publicly unless changed.
- Plugin id is now `ghost-updater` (install folder `.obsidian/plugins/ghost-updater/`).

## [0.2.19] - 2026-06-27

### Changed
- Update-by-slug now only adopts a post when `g_slug` is set explicitly; `ghost_id` remains the primary, collision-proof updater.

## [0.2.18] - 2026-06-27

### Added
- Persistent content-hash cache of uploaded images to avoid re-uploading unchanged images.

## [0.2.17] - 2026-06-27

### Added
- Image upload to Ghost with reference rewriting and the cover-image trick.
- Upsert by slug so re-publishing updates the existing post rather than creating a duplicate.

## [0.2.16] - 2026-06-26

### Fixed
- iOS/mobile compatibility: replaced Node `Buffer` base64 with the WebView-safe `btoa` in JWT signing (signing already used Web Crypto).
- More tolerant Ghost auth: trim whitespace/newlines from the pasted Admin API key, and backdate the JWT `iat` to absorb device/server clock skew (addresses "Invalid token").
- Removed the unused Node-only `@tryghost/admin-api` dependency.

## [0.2.1] - 2026-02-19

### Fixed
- Replace `TFile` type cast with safe `instanceof` narrowing when opening vault notes from calendar
- Remove unnecessary `async` from `onClose` (no await expression)
- Add explicit `void` operator to unhandled `revealLeaf` promises in `activateCalendarView`

## [0.2.0] - 2026-02-19

### Added
- Editorial calendar sidebar view (`CalendarView`) showing all published and scheduled posts for the current month
- Monthly grid with navigation buttons (previous/next month and year)
- Status dots on day cells via CSS pseudo-elements: purple for published posts, green for scheduled, both when mixed
- Bold day numbers for days that have posts
- Click a day cell to filter the post list to that day; click again to deselect and show all
- Today button to return to the current month
- Current day highlighted with a subtle grey border
- Post list grouped by day, each entry showing status badge, title and external link to Ghost Admin
- Post titles with linked vault notes open in a new Obsidian tab
- Full keyboard navigation and ARIA labels for accessibility
- "Open Ghost editorial calendar" command

## [0.1.2] - 2026-02-18

### Fixed
- Replace all `console.log` calls with `console.debug` for production compliance (60+ occurrences)
- Resolve floating promises with `void` operator and `.then()/.catch()` patterns
- Fix async `editorCallback` functions that had no `await` (made synchronous)
- Replace deprecated `substr()` with `substring()` in API client
- Fix unnecessary regex escape characters in markdown-to-lexical converter
- Remove unsafe `as BufferSource` type assertion; use `keyData.buffer as ArrayBuffer` instead
- Fix potential `[object Object]` stringification in frontmatter parser for excerpt, feature_image, and published_at
- Remove unused imports (`TFolder`, `hasGhostProperties`, `GhostPostStatus`, `markdownToHtml`)
- Fix emoji characters in Notice messages (replaced with plain text)
- Fix `error.message` references to use proper `(error as Error).message` casting
- Enforce sentence case in all UI command names and placeholders
- Add `aria-label` to Keychain icon button for screen reader accessibility (Rule 22)

## [0.1.0] - 2026-02-09

### Added
- Initial release of Ghost Writer Manager
- Obsidian to Ghost synchronization (one-way sync)
- Automatic sync on file modification (debounced 2 seconds)
- Periodic sync based on configurable interval (default: 15 minutes)
- Post scheduling system with `g_published_at` property
  - Schedule posts for future dates
  - Publish posts with custom dates
  - Automatic status detection (draft/published/scheduled)
- YAML frontmatter-based metadata control with customizable prefix
- Ghost properties:
  - `g_post_access` - Control post visibility (public/members/paid)
  - `g_published` - Boolean to control draft/published state
  - `g_published_at` - ISO date for scheduling posts
  - `g_featured` - Mark posts as featured
  - `g_tags` - Array of tags
  - `g_excerpt` - Post excerpt/description
  - `g_feature_image` - Featured image URL
  - `g_no_sync` - Disable sync for specific posts
  - `g_slug` - Custom slug for posts
- Markdown to Lexical format conversion
  - Full markdown support (headings, lists, blockquotes, code blocks)
  - Image rendering
  - Link support
  - Inline formatting (bold, italic, code)
- JWT authentication with Ghost Admin API
- Commands:
  - "Sync with Ghost" - Manual sync of all files
  - "Test Ghost connection" - Verify credentials
  - "Create new Ghost post" - Create template with properties
  - "Add Ghost properties to current note" - Add missing properties
  - "Sync current note to Ghost" - Manual sync of active file
  - Debug commands for troubleshooting
- Status bar indicator showing sync status
- Configurable sync folder
- Optional sync notifications
- Hot reload system for development

### Technical Details
- Uses Obsidian's `requestUrl` to bypass CORS
- Implements HMAC-SHA256 JWT token generation
- Debounced file watching to prevent excessive API calls
- Proper error handling and logging
- TypeScript-based with full type safety

### Known Limitations
- One-way sync only (Obsidian → Ghost)
- Excerpt field may not persist in Ghost (Ghost API limitation)
- No support for Ghost pages (posts only)
- No media upload support yet

[0.2.1]: https://github.com/diegoeis/ghost-writer-manager-plugin/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/diegoeis/ghost-writer-manager-plugin/compare/0.1.2...0.2.0
[0.1.2]: https://github.com/diegoeis/ghost-writer-manager-plugin/compare/0.1.0...0.1.2
[0.1.0]: https://github.com/diegoeis/ghost-writer-manager-plugin/releases/tag/0.1.0
