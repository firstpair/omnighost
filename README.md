# Omnighost

Publish and **update** Ghost CMS posts from Obsidian — on **desktop and iOS** — with image upload, in-place updates (no duplicates), post scheduling, YAML metadata control, automatic sync, and an editorial calendar view.

> **Fork notice.** Omnighost is a fork of [Ghost Writer Manager](https://github.com/diegoeis/ghost-writer-manager-plugin) by Diego Eis (MIT). On top of the original it adds: full **iOS / mobile** compatibility, **image publishing** to Ghost with a cover-image trick, a **content-hash image cache** (so images aren't re-uploaded), and **`ghost_id` / explicit-`g_slug` upsert** so re-publishing updates the existing post instead of creating a duplicate. See the [CHANGELOG](CHANGELOG.md) for details.

## Features

- 🔄 **One-way sync** from Obsidian to Ghost (keeps Ghost as your publishing platform)
- ♻️ **In-place updates, no duplicates** — re-publishing updates the same post via `ghost_id`; optional adoption of an existing post by explicit `g_slug`
- 🖼️ **Image publishing** — local images (`![](…)` and `![[…]]` embeds) are uploaded to Ghost and references rewritten to the hosted URLs
- 🎚️ **Cover-image trick** — when no `g_feature_image` is set, the first image becomes the post cover and is removed from the body (no duplicate at the top)
- ⚡ **Content-hash image cache** — unchanged images are never re-uploaded across syncs
- 📱 **Desktop and iOS** — works in the Obsidian mobile WebView (no Node `Buffer`/`FormData`; JWT signing via Web Crypto, multipart built by hand)
- 📅 **Editorial calendar** — sidebar view of all scheduled and published posts for the month
- 📝 **YAML frontmatter control** — manage all Ghost metadata directly in Obsidian
- 🕐 **Post scheduling** — schedule posts for future publication with `g_published_at`
- 🔄 **Automatic sync** — debounced sync on file save
- ⏰ **Periodic sync** — configurable interval sync (default: 15 minutes)
- ✨ **Markdown to Lexical conversion** — full markdown support including images
- 🔒 **Paywall marker** — control the public preview line with `--members-only--`
- 🔐 **Secure credentials** — API keys stored in Obsidian's secure keychain
- 🔑 **JWT authentication** — Ghost Admin API integration (whitespace-tolerant key parsing + clock-skew tolerance)
- 📊 **Status bar indicator** — visual feedback on sync status

## Installation

### Manual install (desktop or iOS)

1. Download the latest release files from the [Releases page](https://github.com/alexy/omnighost/releases):
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. In your vault, navigate to the `.obsidian/plugins/` folder.
3. Create a folder called **`omnighost`**.
4. Move the downloaded files into `.obsidian/plugins/omnighost/`.
5. Restart Obsidian (or reload the app).
6. Go to **Settings → Community plugins** and enable **Omnighost**.

> **iOS note.** The `.obsidian` folder is hidden in the Files app; the easiest path is to install/enable any community plugin once so the `plugins/` folder exists, then drop `omnighost/` in beside it. Your vault must be in a Files-accessible location (On My iPhone or iCloud Drive).

### Via BRAT (beta, auto-updating)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs and auto-updates plugins straight from GitHub — works on desktop and mobile:

1. Install **Obsidian42 - BRAT** from Community plugins and enable it.
2. Run the command **"BRAT: Add a beta plugin for testing"**.
3. Enter the repo: **`alexy/omnighost`** and confirm.
4. Enable **Omnighost** under Community plugins.

BRAT will keep it updated as new releases are published.

### From source (development)

1. Clone the repository:
   ```bash
   git clone https://github.com/alexy/omnighost.git
   cd omnighost
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure your vault path for hot reload:
   ```bash
   cp dev.config.example.json dev.config.json
   # Edit dev.config.json with your vault path
   ```
4. Start dev mode with hot reload:
   ```bash
   npm run dev
   ```
5. Enable the plugin in Obsidian settings and reload (Ctrl/Cmd + R) to see changes.

## Configuration

### Getting your Ghost Admin API key

1. Log in to your Ghost Admin panel.
2. Navigate to **Settings → Integrations**.
3. Click **Add custom integration** and give it a name (e.g., "Obsidian").
4. Copy the **Admin API Key** (format: `id:secret`).

> Use the **Admin API Key** (which contains a `:`), not the Content API Key. Surrounding whitespace is tolerated, but the key must be the admin key.

### Plugin settings

1. Open Obsidian Settings → **Omnighost** under Community plugins.
2. Configure:
   - **Ghost URL** — your Ghost site URL (e.g., `https://yourblog.ghost.io`), no trailing slash
   - **Admin API Key** — stored securely in Obsidian's keychain
   - **Sync Folder** — where Ghost posts live in your vault (default: `Ghost Posts`)
   - **Sync Interval** — minutes between checks (default: 15)
   - **YAML Prefix** — prefix for Ghost metadata fields (default: `g_`)
3. Click **Test Connection** to verify your credentials.

## Usage

### Updating vs. creating (no duplicates)

- The **first** publish creates the post and writes its `ghost_id` (and editor URL) back into the note's frontmatter. Every later publish updates **that** post by `ghost_id`.
- To adopt a post that already exists on Ghost (e.g., created elsewhere) without making a duplicate, set its slug explicitly with **`g_slug`** — Omnighost will find that post by slug and update it in place, then record its `ghost_id`.
- Notes with only an auto-derived (title-based) slug always **create** — so a title collision can never silently overwrite an unrelated post.

### Images

- Local images referenced as `![alt](path)` or Obsidian embeds `![[image.png]]` are uploaded to Ghost's Images API on publish, and the reference is rewritten to the hosted URL.
- **Cover trick:** if the note has no `g_feature_image`, the **first** image becomes the post's feature image and is removed from the body (so it isn't shown twice). Set `g_feature_image` to keep every image inline.
- Images are cached by content hash, so unchanged images are never re-uploaded. Remote `http(s)`/`data:` images are left untouched.

### Editorial calendar

Open it from the ribbon icon or `Cmd/Ctrl + P` → "Open Ghost editorial calendar". The sidebar shows published (purple dot) and scheduled (green dot) posts for the month; click a day to filter, a title to open the linked note, or the external-link icon to open the post in Ghost Admin.

### YAML frontmatter

```yaml
---
g_post_access: paid              # Visibility: public, members, or paid
g_published: false               # Draft (false) or published (true)
g_published_at: ""               # Schedule: ISO date (e.g., "2026-12-25T10:00:00.000Z")
g_featured: false                # Mark as featured post
g_tags: [obsidian, ghost]        # Post tags
g_excerpt: "Post summary"        # Custom excerpt/description
g_feature_image: ""              # Cover image URL (leave empty to use the first body image)
g_slug: "custom-url"             # Custom URL slug (also enables update-by-slug adoption)
g_no_sync: false                 # Disable sync for this post
---

# Your Post Title

Your post content here...
```

### Paywall marker

Add `--members-only--` on its own line to mark where the public preview ends for members-only posts. Everything above is the public preview; everything below is behind the Ghost paywall. Works with `g_post_access: paid` or `members`.

### Post scheduling

- **Draft**: `g_published: false`
- **Publish now**: `g_published: true` + `g_published_at: ""`
- **Schedule**: `g_published: true` + `g_published_at: "<future ISO date>"`
- **Backdate**: `g_published: true` + `g_published_at: "<past ISO date>"`

## Development

```
omnighost/
├── main.ts                       # Main plugin file
├── src/
│   ├── types.ts                  # TypeScript interfaces (+ image cache)
│   ├── ghost/
│   │   ├── api-client.ts         # Ghost Admin API client (JWT, CRUD, image upload, slug lookup)
│   │   └── image-uploader.ts     # Image upload, reference rewriting, cover swallow, hash cache
│   ├── sync/
│   │   └── sync-engine.ts        # Obsidian → Ghost sync, upsert
│   ├── converters/               # Markdown ↔ Lexical/HTML
│   └── views/
│       └── calendar-view.ts      # Editorial calendar sidebar
├── styles.css
├── manifest.json
└── package.json
```

- `npm run dev` — build in watch mode
- `npm run build` — production build (type-check + bundle)
- `npm run lint` — ESLint

## Credits

Omnighost builds directly on **[Ghost Writer Manager](https://github.com/diegoeis/ghost-writer-manager-plugin)** by **[Diego Eis](https://github.com/diegoeis)**. Sincere thanks to Diego for the original plugin — the sync engine, editorial calendar, Markdown→Lexical conversion, scheduling, paywall marker, and the whole foundation come from his work. Omnighost would not exist without it.

This fork is maintained by **[Alexy Khrabrov](https://github.com/alexy)**, adding iOS/mobile support, image publishing with the cover-image trick, the content-hash image cache, in-place updates (no duplicates), and the public-URL frontmatter field.

## License

Licensed under the **MIT License** — see [LICENSE](LICENSE). Original work © 2026 Diego Eis; fork modifications © 2026 Alexy Khrabrov. The original copyright and license notice are retained.

## Support

Please [open an issue](https://github.com/alexy/omnighost/issues) for bugs or questions about this fork.
