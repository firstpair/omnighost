# Changelog

All notable changes to the Ghost Updater plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
