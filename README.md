# Omnighost

Publish and **update** Ghost CMS posts from Obsidian — on **desktop and iOS** — with multiple Ghost blogs, image upload, in-place updates (no duplicates), selective sync, bulk import, bulk delete, post scheduling, YAML metadata control, periodic/manual sync, and an editorial calendar view.

> **Fork notice.** Omnighost is a fork of [Ghost Writer Manager](https://github.com/diegoeis/ghost-writer-manager-plugin) by Diego Eis (MIT). On top of the original it adds: full **iOS / mobile** compatibility, **multiple Ghost blogs**, **image publishing** to Ghost with an opt-in cover-image trick, a **content-hash image cache** (so images aren't re-uploaded), and **per-blog id / explicit slug upsert** so re-publishing updates the existing post instead of creating a duplicate. See the [CHANGELOG](CHANGELOG.md) for details.

## Features

- 🔄 **One-way sync** from Obsidian to Ghost (keeps Ghost as your publishing platform)
- 🌐 **Multiple Ghost blogs** — configure several sites, each with its own URL, Admin API key, folder, sync toggle, and interval
- 🎯 **Selective sync** — publish each note to one blog or many blogs with its `ghost_blog` / `g_blog` property or the blog picker
- ♻️ **In-place updates, no duplicates** — re-publishing updates the same post via per-blog ids; optional adoption of an existing post by explicit slug
- 📥 **Bulk import** — import all posts from one or more Ghost blogs into their configured vault folders
- 🧹 **Bulk delete checklist** — review linked posts by blog, choose which to delete, and optionally archive local notes
- 🖼️ **Image publishing** — local images (`![](…)` and `![[…]]` embeds) are uploaded to Ghost and references rewritten to the hosted URLs
- 🎚️ **Cover-image trick** — opt in per note to make the first image the post cover and remove it from the body
- ⚡ **Content-hash image cache** — unchanged images are never re-uploaded across syncs
- 📱 **Desktop and iOS** — works in the Obsidian mobile WebView (no Node `Buffer`/`FormData`; JWT signing via Web Crypto, multipart built by hand)
- 📅 **Editorial calendar** — sidebar view of all scheduled and published posts for the month
- 📝 **YAML frontmatter control** — manage all Ghost metadata directly in Obsidian
- 🕐 **Post scheduling** — schedule posts for future publication with `ghost_published_at` / `g_published_at`
- ⏰ **Periodic sync** — configurable per-blog interval sync (default: 15 minutes)
- 🔄 **Manual sync** — sync the current note or all configured blog folders on demand
- ✨ **Markdown to Lexical conversion** — full markdown support including images
- 🔒 **Paywall marker** — control the public preview line with `--members-only--`
- 🔐 **Secure credentials** — API keys stored in Obsidian's secure keychain
- 🔑 **JWT authentication** — Ghost Admin API integration (whitespace-tolerant key parsing + clock-skew tolerance)
- 📊 **Status bar indicator** — visual feedback on sync status

## Installation

### Manual install (desktop or iOS)

1. Download the latest release files from the [Releases page](https://github.com/firstpair/omnighost/releases):
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
3. Enter the repo: **`firstpair/omnighost`** and confirm.
4. Enable **Omnighost** under Community plugins.

BRAT will keep it updated as new releases are published.

### From source (development)

1. Clone the repository:
   ```bash
   git clone https://github.com/firstpair/omnighost.git
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
   - **Ghost blogs** — add one block per Ghost site
   - **Name** — display name used in pickers and notices
   - **Site address** — your Ghost site URL (e.g., `https://yourblog.ghost.io`)
   - **Admin API key** — stored securely in Obsidian's keychain, one secret per blog
   - **Folder** — vault folder for that blog's posts (default: `Ghost Posts`)
   - **Auto-sync this folder** — per-blog automatic sync toggle
   - **Sync interval** — optional per-blog interval; blank uses the global interval
   - **YAML prefix** — prefix for Ghost metadata fields (default in current builds: `ghost_`; many older examples use `g_`)
3. Click **Save key** in each blog block. Omnighost stores the key and immediately tests the connection.

Legacy single-blog settings are migrated into the first blog automatically. If two blogs accidentally share one keychain secret, settings shows a warning because the wrong Admin API key will cause Ghost 401 errors.

## Usage

### Updating vs. creating (no duplicates)

- The **first** publish creates the post and writes that blog's id and editor URL back into the note's frontmatter. Every later publish updates **that** post by the stored id.
- In multi-blog notes, each target blog gets its own keys, such as `ghost_id_example_com`, `ghost_url_example_com`, and `ghost_public_url_example_com`. The suffix is based on the blog domain so renaming a blog does not break links.
- To adopt a post that already exists on Ghost (e.g., created elsewhere) without making a duplicate, set its slug explicitly with **`ghost_slug`** or **`g_slug`** — Omnighost will find that post by slug and update it in place, then record the blog-specific id.
- Notes with only an auto-derived (title-based) slug always **create** — so a title collision can never silently overwrite an unrelated post.

### Multiple blogs and selective sync

Configure blogs in Settings → Omnighost → **Ghost blogs**. Each blog has its own folder, API key, auto-sync toggle, and optional interval. The star button marks the default blog; new notes and notes without a blog property route there.

Use `Cmd/Ctrl + P` → **Set blog(s) for this note** or the **Edit ghost properties** modal to choose targets for a note. Omnighost writes the target list to `ghost_blog` (or `g_blog` if your prefix is `g_`); values may be blog names or stable domain keys. A note can publish to one blog or several blogs in one sync.

```yaml
---
ghost_blog: ["example.com", "second-site.com"]
ghost_slug: "custom-url"
ghost_id_example_com: "post-id-on-example"
ghost_url_example_com: "https://example.com/ghost/#/editor/post/post-id-on-example"
ghost_public_url_example_com: "https://example.com/custom-url/"
---
```

If you remove a blog from a note's blog list after it has already published there, the next interactive sync warns about the orphaned Ghost post. You can delete it on Ghost, keep it by re-adding the blog to the note, or decide later.

Run **Normalize blog references (use domain keys)** to rewrite existing blog references and per-blog id/public URL keys to stable domain-based keys without changing their values.

For one-note exclusions, set `ghost_no_sync: true` / `g_no_sync: true`. For folder-level selective sync, turn off **Auto-sync this folder** on a blog; manual sync still works.

### Importing from Ghost

- **Import post from ghost** imports one existing Ghost post by editor URL and writes it into the matching blog folder.
- **Link note to ghost post** connects an existing note to an existing Ghost post. You choose whether Ghost overwrites the note or the note syncs up to Ghost.
- **Seed note from existing ghost post (by slug)** pulls the Ghost post into an empty note that already has an explicit slug.
- **Import all posts from a ghost blog** opens a blog picker, fetches every post from the selected blog(s), and writes each post as a note in that blog's folder.

Imported and linked notes receive `ghost_blog` plus the per-blog id, editor URL, and public URL keys so later syncs update the same remote post.

### Bulk delete and archives

Run **Bulk delete posts (local notes + ghost)** to choose one or more blogs, review a checklist of linked notes/posts, uncheck anything to keep, then confirm. Checked items delete the remote Ghost post and remove the local note. If **Archive deleted notes** is enabled, local notes move into an archive subfolder inside their blog folder and get `ghost_archived`, `ghost_archived_at`, `ghost_archived_from`, and `ghost_no_sync: true`; otherwise they go to Obsidian trash.

Deletion is never automatic. If **Prompt on folder delete** is enabled and you delete a folder of synced notes, Omnighost opens the same checklist for the linked Ghost posts after the local folder is gone. **Confirm each remote delete** adds a per-post Delete / Skip / Stop prompt during the batch.

### Images

- Local images referenced as `![alt](path)` or Obsidian embeds `![[image.png]]` are uploaded to Ghost's Images API on publish, and the reference is rewritten to the hosted URL.
- **Cover trick:** set `ghost_cover_from_first_image: true` / `g_cover_from_first_image: true` and leave the feature image empty to make the first body image the post's feature image and remove it from the body. Leave it false to keep every image inline.
- Images are cached by content hash, so unchanged images are never re-uploaded. Remote `http(s)`/`data:` images are left untouched.

### Editorial calendar

Open it from the ribbon icon or `Cmd/Ctrl + P` → "Open Ghost editorial calendar". The sidebar shows published (purple dot) and scheduled (green dot) posts for the month; click a day to filter, a title to open the linked note, or the external-link icon to open the post in Ghost Admin.

### YAML frontmatter

```yaml
---
ghost_blog: ["example.com"]      # Target blog domain(s); omit to use the default blog
ghost_post_access: paid          # Visibility: public, members, or paid
ghost_published: false           # Draft (false) or published/scheduled (true)
ghost_published_at: ""           # Schedule: ISO date (e.g., "2026-12-25T10:00:00.000Z")
ghost_featured: false            # Mark as featured post
ghost_tags: [obsidian, ghost]    # Post tags
ghost_excerpt: "Post summary"    # Custom excerpt/description
ghost_feature_image: ""          # Cover image URL
ghost_cover_from_first_image: false
ghost_slug: "custom-url"         # Custom URL slug (also enables update-by-slug adoption)
ghost_no_sync: false             # Disable sync for this post
---

# Your Post Title

Your post content here...
```

### Paywall marker

Add `--members-only--` on its own line to mark where the public preview ends for members-only posts. Everything above is the public preview; everything below is behind the Ghost paywall. Works with `ghost_post_access: paid` / `members` or the same keys under your configured prefix.

### Post scheduling

- **Draft**: `ghost_published: false`
- **Publish now**: `ghost_published: true` + `ghost_published_at: ""`
- **Schedule**: `ghost_published: true` + `ghost_published_at: "<future ISO date>"`
- **Backdate**: `ghost_published: true` + `ghost_published_at: "<past ISO date>"`

## Development

```
omnighost/
├── main.ts                       # Main plugin file
├── src/
│   ├── types.ts                  # TypeScript interfaces (blogs, settings, posts)
│   ├── ghost/
│   │   ├── api-client.ts         # Ghost Admin API client (JWT, CRUD, image upload, slug lookup)
│   │   └── image-uploader.ts     # Image upload, reference rewriting, cover swallow, hash cache
│   ├── sync/
│   │   └── sync-engine.ts        # Blog-routed Obsidian → Ghost sync, upsert
│   ├── converters/               # Markdown ↔ Lexical/HTML
│   ├── modals/                   # Blog picker, import, link, properties modals
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

This fork is maintained by **[Alexy Khrabrov](https://github.com/alexy)**, adding iOS/mobile support, multiple blogs, selective sync, bulk import/delete workflows, image publishing with the cover-image trick, the content-hash image cache, in-place updates (no duplicates), and public-URL frontmatter fields.

## License

Licensed under the **MIT License** — see [LICENSE](LICENSE). Original work © 2026 Diego Eis; fork modifications © 2026 Alexy Khrabrov. The original copyright and license notice are retained.

## Support

Please [open an issue](https://github.com/firstpair/omnighost/issues) for bugs or questions about this fork.
