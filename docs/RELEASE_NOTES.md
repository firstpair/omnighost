# Ghost Writer Manager 0.2.1

Patch release with type safety and lint fixes introduced in 0.2.0.

## Fixed

- Replace `TFile` type cast with safe `instanceof` narrowing when opening vault notes from the calendar
- Remove unnecessary `async` from `onClose` (no `await` expression)
- Add explicit `void` operator to unhandled `revealLeaf` promises in `activateCalendarView`

---

**Full changelog**: https://github.com/firstpair/omnighost/compare/0.2.0...0.2.1

---

# Ghost Writer Manager 0.2.0

Introduces the editorial calendar — a sidebar view to see and navigate all your Ghost posts for the month without leaving Obsidian.

## What's new

### Editorial calendar

Open the calendar from the ribbon or via `Cmd/Ctrl + P` → "Open Ghost editorial calendar". It shows a monthly grid of all your published and scheduled posts with at-a-glance status indicators:

- **Purple dot** — post is published
- **Green dot** — post is scheduled for a future date
- **Both dots side by side** — day has both types

Day numbers are bold when they have posts. The current day is highlighted with a subtle grey border.

### Post list and navigation

Below the grid, all posts for the month are listed and grouped by day. Click a day cell to filter the list to that day only; click it again to go back to the full month view. Click a post title to open the linked vault note in a new Obsidian tab, or use the external link icon to jump straight to Ghost Admin.

Use the navigation arrows to browse months and years, or hit **Today** to return to the current month instantly.

## Installation

Download `main.js`, `manifest.json`, and `styles.css` from this release and copy them to `.obsidian/plugins/ghost-writer-manager/` in your vault.

---

**Full changelog**: https://github.com/firstpair/omnighost/compare/0.1.2...0.2.0

---

# Ghost Writer Manager v0.1.0 🚀

First stable release of Ghost Writer Manager - A powerful Obsidian plugin for synchronizing your notes to Ghost CMS.

## ✨ Key Features

### Automatic Synchronization
- **One-way sync** from Obsidian to Ghost (keeps Ghost as your publishing platform)
- **Auto-sync on save** - Debounced 2-second delay prevents excessive API calls
- **Periodic sync** - Configurable interval (default: 15 minutes) ensures all posts stay updated
- **Manual sync options** - Sync individual notes or entire folder on demand

### Post Scheduling System
Control when your posts go live with the new scheduling system:
- **Draft mode** - Set `g_published: false` to keep posts as drafts
- **Publish immediately** - Set `g_published: true` to publish now
- **Schedule for later** - Set `g_published: true` + `g_published_at: "2026-12-25T10:00:00.000Z"` to schedule
- **Custom publish dates** - Publish with historical dates for backdating content

### YAML Frontmatter Control
All Ghost metadata is controlled via YAML frontmatter with customizable prefix (default: `g_`):

```yaml
---
g_post_access: paid          # Visibility: public, members, or paid
g_published: false           # Draft or published state
g_published_at: ""           # ISO date for scheduling (optional)
g_featured: false            # Mark as featured post
g_tags: [writing, obsidian]  # Post tags
g_excerpt: "Post summary"    # Custom excerpt
g_feature_image: ""          # Featured image URL
g_slug: "custom-url"         # Custom URL slug
g_no_sync: false             # Disable sync for this post
---
```

### Rich Markdown Support
Full markdown conversion to Ghost's Lexical format:
- Headings (H1-H6)
- Lists (ordered and unordered)
- Blockquotes
- Code blocks with syntax highlighting
- Images
- Links
- Inline formatting (bold, italic, code)

### Developer-Friendly
- Hot reload development system
- Comprehensive debug commands
- Detailed console logging
- TypeScript with full type safety

## 📦 Installation

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from this release
2. Create folder: `{VaultFolder}/.obsidian/plugins/ghost-writer-manager/`
3. Copy the three files into the folder
4. Reload Obsidian
5. Enable the plugin in Settings → Community Plugins

### Configuration
1. Go to Settings → Ghost Writer Manager
2. Enter your Ghost site URL (e.g., `https://yourblog.ghost.io`)
3. Enter your Admin API Key from Ghost Admin → Settings → Integrations → Custom Integrations
4. Click "Test connection" to verify
5. Configure sync folder (default: "Ghost Posts")
6. Set sync interval in minutes (default: 15)
7. Customize YAML prefix if desired (default: "g_")

## 🎯 Quick Start

### Create Your First Ghost Post
1. Run command: "Create new Ghost post" (Cmd/Ctrl+P)
2. Edit the content and frontmatter properties
3. Save the file
4. Plugin automatically syncs to Ghost after 2 seconds

### Add Ghost Properties to Existing Note
1. Open any markdown file
2. Run command: "Add Ghost properties to current note"
3. Properties are added with defaults
4. Adjust the properties as needed
5. Save to sync

### Manual Sync
- **Sync current note**: Run "Sync current note to Ghost"
- **Sync all posts**: Run "Sync with Ghost"

## 🔍 Available Commands

- **Sync with Ghost** - Manually sync all files in sync folder
- **Test Ghost connection** - Verify your credentials are working
- **Create new Ghost post** - Generate new post with Ghost properties
- **Add Ghost properties to current note** - Add missing properties to existing notes
- **Sync current note to Ghost** - Force sync of active file
- **Debug commands** - Show Ghost properties, test JWT, view file data

## 📊 Status Bar

Watch the status bar for sync status:
- ⚪ Ghost: Ready - Idle, waiting for changes
- 🔄 Ghost: Syncing... - Currently syncing
- ✅ Ghost: Synced - Successfully synced
- ❌ Ghost: Error - Error occurred (check console)

## ⚙️ Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| Ghost URL | Your Ghost site URL | - |
| Admin API Key | Ghost Admin API key (format: id:secret) | - |
| Sync folder | Folder where Ghost posts are stored | "Ghost Posts" |
| Sync interval | Minutes between automatic syncs | 15 |
| YAML prefix | Prefix for Ghost properties | "g_" |
| Show sync notifications | Display notification popups on sync | true |

## ⚠️ Known Limitations

- **One-way sync only** - Changes in Ghost won't sync back to Obsidian
- **Excerpt field** - May not persist in Ghost due to Ghost API limitations
- **Posts only** - Ghost pages are not supported yet
- **No media upload** - Images must be uploaded separately and referenced by URL

## 🐛 Troubleshooting

### Connection Issues
- Verify Ghost URL is correct (no trailing slash)
- Check Admin API Key format is `id:secret`
- Ensure Ghost site is accessible
- Run "Test Ghost connection" command

### Posts Not Syncing
- Check file is in sync folder
- Verify file has Ghost properties
- Ensure `g_no_sync: false`
- Check console for error messages
- Run "Debug: Show Ghost properties" command

### Excerpt Not Showing
This is a known Ghost API limitation. The excerpt is being sent correctly but may not persist in Ghost. Use Ghost's admin interface to set excerpts if needed.

## 🔐 Security Notes

- Admin API Key is stored locally in Obsidian's data folder
- Never commit your API key to version control
- Use `dev.config.example.json` as template for local development

## 📝 Technical Details

- **Authentication**: HMAC-SHA256 JWT tokens with Ghost Admin API
- **Format**: Converts Markdown to Ghost's Lexical format
- **Network**: Uses Obsidian's `requestUrl` to bypass CORS
- **Performance**: Debounced file watching + periodic sync
- **Type Safety**: Full TypeScript implementation

## 🙏 Credits

Built with [Claude Code](https://claude.com/claude-code) by Diego Eis

## 📄 License

MIT License - See LICENSE file for details

## 🔗 Links

- [GitHub Repository](https://github.com/firstpair/omnighost)
- [Report Issues](https://github.com/firstpair/omnighost/issues)
- [Ghost Documentation](https://ghost.org/docs/)
- [Obsidian Plugin Development](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)

---

**Full Changelog**: https://github.com/firstpair/omnighost/blob/main/CHANGELOG.md
