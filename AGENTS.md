# AGENTS.md

## FirstPair Book Delivery

`FIRSTPAIR.md` is the required contract for this repository's unified book
build and FirstPair library deployment. Read and maintain it before changing or
delivering the book; it owns the catalog slug, shelf, and all source-side
handoff guidance. The shared implementation and authoritative operational rules
live in `~/src/firstpair`. Do not duplicate that deployment procedure here.

This file provides guidance for AI agents working with the Ghost Writer Manager Plugin codebase.

## Project Overview

**Ghost Writer Manager** is an Obsidian plugin that provides bidirectional synchronization between Obsidian vaults and Ghost CMS. It enables content creators to write in Obsidian and manage Ghost publications directly from their vault, with full editorial control via YAML frontmatter and an integrated editorial calendar.

**Current Status**: v0.2.1 - One-way sync and editorial calendar are implemented and working. Bidirectional sync is planned for a future release.

## Quick Context

- **Language**: TypeScript
- **Platform**: Obsidian plugin (Electron-based desktop app, iOS/Android mobile)
- **Build System**: esbuild with hot reload for development
- **Target API**: Ghost Admin API (JWT authentication)
- **Key Dependencies**: obsidian, jsonwebtoken, gray-matter

## Architecture Overview

### Core Modules

```
src/
├── ghost/                      # Ghost Admin API integration
│   └── api-client.ts          # JWT auth, CRUD operations for posts
├── sync/                       # Synchronization engine
│   └── sync-engine.ts         # Auto-sync, conflict resolution
├── converters/                 # Content format conversion
│   ├── markdown-to-lexical.ts # Obsidian → Ghost format
│   └── lexical-to-markdown.ts # Ghost → Obsidian format (future)
├── metadata/                   # YAML frontmatter management
├── views/                      # UI components
│   └── calendar-view.ts       # Editorial calendar sidebar (ItemView)
├── frontmatter-parser.ts      # YAML parsing and validation
├── templates.ts               # Post templates with Ghost properties
└── types.ts                   # TypeScript interfaces
```

### Key Design Decisions

1. **Authentication**: Ghost Admin API with JWT tokens, stored securely in Obsidian Keychain
2. **Sync Strategy**: One-way sync (Obsidian → Ghost); bidirectional planned for future
3. **Conflict Resolution**: Intelligent merge when possible, user prompt when necessary
4. **YAML Control**: All Ghost metadata managed via configurable prefixed YAML properties (default: `g_`)
5. **Sync Folder**: Isolated folder in vault for Ghost-synced posts only
6. **Calendar View**: `ItemView` in sidebar, loads posts via Ghost API filtered by month, status dots via CSS pseudo-elements
7. **Publication Provenance**: Canonical SHA-256 metadata is stored in each post's `codeinjection_head`; desktop publishing commits the note when Git is safely available, with hash-only fallback on mobile or Git failure. A three-mode setting controls the trailing reader-visible credit/version line, and direct managed-field verification remains available as an enabled-by-default safeguard against edits made directly in Ghost.
8. **Textpack Provenance**: `scripts/textpack.py` safely commits exact source inputs and embeds a portable payload digest. Import verifies and fingerprints that source so untouched notes reuse its Git commit; authorial or imported-asset changes invalidate inheritance.

## Development Workflow

### Environment Setup

```bash
# Install dependencies
npm install

# Configure vault path for hot reload
cp dev.config.example.json dev.config.json
# Edit dev.config.json with your test vault path

# Start development with hot reload
npm run dev

# Production build
npm run build

# Lint check
npm run lint
```

### Testing Changes

1. Make code changes
2. Files automatically rebuild (hot reload)
3. Reload Obsidian (Ctrl/Cmd + R)
4. Test functionality in Obsidian

### Development Mode Flag

In `main.ts`, there's a `DEV_MODE` flag:
- `true`: Auto-sync on file save (2s debounce)
- `false`: Manual sync only (production)

**Always set to `false` before releasing!**

### Release and Local Install Skill

Use this when the user asks to bump Omnighost, update the local Obsidian plugin, or copy changed `main.js` / `styles.css` / `manifest.json` into the epaolo vault.

Findings from the 2026-07-08 desktop/iOS sync debug:

- The active repo is `/Users/alexy/src/omnighost`.
- The local epaolo vault is `/Users/alexy/Documents/epaolo`.
- The installed plugin folder is `/Users/alexy/Documents/epaolo/.obsidian/plugins/omnighost`.
- The three runtime files Obsidian needs are `main.js`, `styles.css`, and `manifest.json`.
- Git history showed `0.12.0` as the latest tag, so the YAML hotfix was bumped to `0.12.1`.
- `manifest.json`, `package.json`, `package-lock.json`, and `versions.json` must stay in sync when bumping a release version.
- The red Properties/frontmatter failure was caused by hand-written YAML double-quoted strings: a value like `\with` is an invalid YAML escape. Use the shared YAML serializers in `src/frontmatter-parser.ts` (`yamlString`, `yamlStringArray`) for any future string/list frontmatter writes.
- `Save & sync` can save frontmatter while sync returns `false`; the modal should surface that as an incomplete sync, not only show a saved notice.
- Repo-wide `npm run lint` may fail if it scans `.agents/skills/obsidian/tools/create-plugin.js` with typed TypeScript rules. For focused validation, run `npx eslint main.ts src/frontmatter-parser.ts src/sync/sync-engine.ts` or another explicit touched-file set.
- macOS File Provider / provenance can make the epaolo plugin files look writable but reject direct replacement from the Codex shell with `Operation not permitted`. Symptoms included `cp`, `install`, `rsync --inplace`, `rm`, `mv`, `chflags`, `xattr`, and even direct reads failing on the existing live plugin files.
- After the user grants Terminal.app access, running the copy from Terminal.app succeeds. If Codex shell still cannot read the live files, ask Terminal.app to write checksum output to `/tmp` and read that file.
- A reload warning about missing `ghost-api-key` is a legacy single-blog remnant. Multi-blog installs should initialize and test clients from the default blog's `apiKeySecretName`; do not call the legacy `loadApiKey()` path during normal plugin startup or ordinary multi-blog sync commands.
- If a published Ghost post looks ragged with very short, widely spaced lines, inspect whether hard-wrapped Markdown lines became separate Lexical paragraphs. The converter should join consecutive prose lines into one paragraph; otherwise Ghost themes render every source line as its own paragraph.
- For the First Pair manifesto import debug, `/Users/alexy/src/firstpair/blog/dist/firstpair-manifesto.textpack` contained `text.markdown` byte-for-byte equal to `/Users/alexy/src/firstpair/blog/firstpair-manifesto.md`. The epaolo vault note body was also faithful, except for the expected image-path rewrite into an imported asset folder.
- The broken `real enough` / `to break` Ghost paragraph was an Omnighost Markdown-to-Lexical conversion bug: source soft wraps must remain one paragraph.
- The broken red quote rail came from source semantics, not textpack damage: `/Users/alexy/src/firstpair/blog/firstpair-manifesto.md` used three blockquotes separated by unquoted blank lines. Pandoc renders that as three `<blockquote>` elements. For one continuous rail with separated statements, use quoted blank separators:

```markdown
> Ideas should outlive their implementations.
>
> Tools should remain replaceable.
>
> Knowledge should remain permanent.
```

Preferred update command, run from a normal Terminal.app session:

```bash
cd /Users/alexy/src/omnighost
scripts/install-epaolo-plugin.sh
```

If driving it from Codex and Terminal.app has the macOS permission grant, use:

```bash
osascript <<'APPLESCRIPT'
tell application "Terminal"
  activate
  do script "cd /Users/alexy/src/omnighost && scripts/install-epaolo-plugin.sh"
end tell
APPLESCRIPT
```

Patch-version bump workflow:

```bash
# Choose the next patch from git history first.
git tag --sort=-v:refname | head -5

next=0.12.1
npm version "$next" --no-git-tag-version --ignore-scripts
node - "$next" <<'NODE'
const fs = require('fs');
const next = process.argv[2];
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
manifest.version = next;
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n');

const versions = JSON.parse(fs.readFileSync('versions.json', 'utf8'));
versions[next] = manifest.minAppVersion;
fs.writeFileSync('versions.json', JSON.stringify(versions, null, '\t') + '\n');
NODE

scripts/install-epaolo-plugin.sh
```

Post-copy verification should compare the repo and vault hashes for all three runtime files and confirm the installed manifest version:

```bash
plugin_dir=/Users/alexy/Documents/epaolo/.obsidian/plugins/omnighost
for file in main.js styles.css manifest.json; do
  shasum -a 256 "$file" "$plugin_dir/$file"
done
python3 - <<'PY'
import json
print(json.load(open('/Users/alexy/Documents/epaolo/.obsidian/plugins/omnighost/manifest.json'))['version'])
PY
```

## Critical Rules & Constraints

### Obsidian Plugin Requirements

**MUST follow all 27 ESLint rules** documented in `.claude/rules/obsidian-plugin-rules.md`:

1. **Memory Management**: Use `registerEvent()`, clean up in `onunload()`
2. **Type Safety**: Use `instanceof`, avoid `any` types
3. **API Best Practices**: Use `requestUrl()` not `fetch()`, use `normalizePath()` for paths
4. **UI/UX**: Sentence case, no default hotkeys, accessible keyboard navigation
5. **Security**: No `innerHTML`, store secrets in Keychain
6. **Compatibility**: No regex lookbehind (iOS < 16.4)

### Ghost API Constraints

1. **Authentication**: Admin API Key format: `id:secret` (split on first colon only)
2. **JWT Generation**: HMAC-SHA256 signature with proper header/payload structure
3. **API Endpoints**: Use Ghost Admin API v5 endpoints
4. **Rate Limiting**: Respect Ghost API rate limits (implement backoff if needed)
5. **Sync Timing**: Only sync posts created after plugin installation (v1 limitation)

### Content Format

1. **Markdown → Lexical**: Convert all Obsidian markdown to Ghost's Lexical format
2. **Preserve Formatting**: Maintain headers, lists, links, images, code blocks
3. **Handle Wikilinks**: Convert Obsidian `[[links]]` to appropriate format
4. **Image Handling**: Convert Obsidian image paths to Ghost-compatible URLs

## Common Tasks & Patterns

### Adding a New Ghost Property

1. Update `GhostPostProperties` interface in `src/types.ts`
2. Add property to template in `src/templates.ts`
3. Update frontmatter parser in `src/frontmatter-parser.ts`
4. Update API client mapping in `src/ghost/api-client.ts`
5. Test with sample post

### Adding a New Command

```typescript
this.addCommand({
  id: 'your-command-id',        // No "command" suffix
  name: 'Your command name',    // Sentence case, no "command"
  callback: async () => {
    // Implementation
  }
});
```

### Accessing Settings

```typescript
// Read settings
const syncFolder = this.settings.syncFolder;

// Update settings
this.settings.syncInterval = 30;
await this.saveSettings();
```

### Working with Files

```typescript
// Get files in sync folder
const files = this.app.vault.getMarkdownFiles()
  .filter(f => f.path.startsWith(this.settings.syncFolder));

// Read file content
const content = await this.app.vault.read(file);

// Parse frontmatter
const { metadata, content: bodyContent } = parseFrontmatter(content);

// Modify file (background)
await this.app.vault.process(file, (content) => {
  return updatedContent;
});
```

### Making Ghost API Calls

```typescript
// Use the GhostAPIClient
const client = new GhostAPIClient(
  this.settings.ghostUrl,
  apiKey
);

// Create/update post
const post = await client.createOrUpdatePost({
  title: 'Post Title',
  lexical: lexicalContent,
  status: 'draft',
  tags: ['obsidian', 'ghost']
});
```

## File Locations & Paths

### User-Visible Files
- **Sync Folder**: Configured by user (default: `Ghost Posts/`)
- **Post Files**: Markdown files with `g_*` YAML properties

### Plugin Files
- **Settings**: `.obsidian/plugins/ghost-writer-manager/data.json`
- **Secrets**: Obsidian Keychain (not in filesystem)

### Development Files
- **Hot Reload Config**: `dev.config.json` (not in repo)
- **Build Output**: `main.js`, `styles.css`, `manifest.json`

## Troubleshooting

### Common Issues

1. **Sync not working**: Check Ghost URL format (no trailing slash), verify API key
2. **JWT errors**: Ensure API key is properly split on first colon only
3. **Hot reload not working**: Check `dev.config.json` vault path
4. **Memory leaks**: Verify all event handlers use `registerEvent()`
5. **iOS compatibility**: Check for regex lookbehind usage

### Debug Commands

Built-in debug commands (Cmd/Ctrl + P):
- "Show Ghost properties of current note"
- "Test JWT generation"
- "View current file data for Ghost sync"
- "Test Ghost connection"

## Documentation References

### External Documentation
- [Obsidian Plugin API](https://docs.obsidian.md/Reference/TypeScript+API/)
- [Obsidian Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Ghost Admin API](https://docs.ghost.org/admin-api/)
- [Ghost Content API](https://docs.ghost.org/content-api/)
- [Obsidian Secret Storage](https://docs.obsidian.md/plugins/guides/secret-storage)

### Internal Documentation
- `.claude/CLAUDE.md` - Project instructions for Claude
- `.claude/rules/obsidian-plugin-rules.md` - All 27 critical plugin rules
- `docs/prd-001-ghost-writer-manager-plugin.md` - Product requirements
- `docs/DEVELOPMENT_GUIDELINES.md` - Detailed dev guidelines
- `docs/KEYCHAIN_SETUP.md` - Secret storage implementation
- `docs/SUBMISSION_GUIDE.md` - Publishing to Obsidian community

## Product Requirements Summary

**Core Features**:
- ✅ One-way sync (Obsidian → Ghost)
- ✅ YAML metadata control (all Ghost properties)
- ✅ Post scheduling system
- ✅ Periodic sync with configurable interval
- ✅ Markdown to Lexical conversion
- ✅ Editorial calendar sidebar view (v0.2.0)
- ⏳ Bidirectional sync (future)
- ⏳ Ghost Pages support (future)

**Out of Scope**:
- Ghost Pages (Posts only)
- Historical sync (only new posts created after plugin install)
- Member/newsletter/theme/analytics management
- Multi-CMS support (Ghost-specific)

## Success Metrics

- **Sync Success Rate**: ≥99% of syncs complete without error
- **Conflict Resolution**: ≥95% of conflicts auto-resolved
- **Data Integrity**: Zero content loss during sync (checksums validated)
- **Time Savings**: ≥10 minutes saved per post vs manual copy/paste

## Contributing Guidelines

1. Follow all 27 Obsidian plugin rules
2. Use TypeScript strict mode (no `any` types)
3. Test on both desktop and mobile if possible
4. Update tests when adding features
5. Update documentation (CLAUDE.md, AGENTS.md, README.md)
6. Set `DEV_MODE = false` before production builds
7. Follow semantic versioning for releases

## Quick Command Reference

```bash
# Development
npm install           # Install dependencies
npm run dev          # Build + watch + hot reload
npm run build        # Production build
npm run lint         # ESLint check

# Version/Release
npm version patch    # Bump patch version
npm version minor    # Bump minor version
git tag -a X.Y.Z     # Create release tag
git push --tags      # Push release
```

## Contact & Support

- **Repository**: https://github.com/firstpair/omnighost
- **Issues**: GitHub Issues
- **License**: MIT

---

Last Updated: 2026-07-15
Agent Version: 1.1.0
