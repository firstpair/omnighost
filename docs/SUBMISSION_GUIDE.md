# Obsidian Community Plugin Submission Guide

This guide walks through the process of submitting Omnighost to the Obsidian Community Plugins directory.

## Prerequisites Checklist

Before submitting, ensure you have:

- [x] Public GitHub repository: `https://github.com/firstpair/omnighost`
- [x] Initial release published with:
  - [x] `main.js` - Compiled plugin code
  - [x] `manifest.json` - Plugin metadata
  - [x] `styles.css` - Plugin styles (if any)
- [x] `README.md` with clear installation and usage instructions
- [x] `versions.json` - Maps plugin versions to minimum Obsidian versions
- [x] Valid `manifest.json` with all required fields
- [x] Plugin ID in manifest matches repo name format
- [x] Git tag matching version in manifest

## Repository Requirements

### Required Files in Root

1. **manifest.json** ✅
   ```json
   {
     "id": "omnighost",
     "name": "Omnighost",
     "version": "0.12.9",
     "minAppVersion": "1.11.4",
     "description": "Publish and update Ghost CMS posts from Obsidian on desktop and iOS...",
     "author": "Alexy Khrabrov",
     "authorUrl": "https://github.com/alexy",
     "isDesktopOnly": false
   }
   ```

2. **versions.json** ✅
   ```json
   {
     "0.1.0": "1.0.0"
   }
   ```
   Format: `"<plugin-version>": "<minimum-obsidian-version>"`

3. **README.md** ✅
   - Must include installation instructions
   - Usage examples
   - Configuration details

4. **LICENSE** (Recommended)
   - MIT License recommended
   - Required for community trust

## Submission Process

### Step 1: Verify Release

1. Go to the current release page, for example: https://github.com/firstpair/omnighost/releases/tag/0.12.9

2. Ensure the release includes:
   - `main.js` (43KB)
   - `manifest.json` (346B)
   - `styles.css` (2.6KB)

3. Verify the git tag exists:
   ```bash
   git tag -l
   # Should show the release tag that matches manifest.json
   ```

### Step 2: Fork obsidian-releases Repository

1. Go to: https://github.com/obsidianmd/obsidian-releases

2. Click **Fork** button (top right)

3. Clone your fork:
   ```bash
   cd ~/Sites  # or your preferred directory
   git clone git@github.com:diegoeis/obsidian-releases.git
   cd obsidian-releases
   ```

### Step 3: Add Plugin to community-plugins.json

1. Open `community-plugins.json`

2. Add your plugin entry (alphabetically sorted by `id`):
   ```json
   {
     "id": "omnighost",
     "name": "Omnighost",
     "author": "Alexy Khrabrov",
     "description": "Publish and update Ghost CMS posts from Obsidian on desktop and iOS with image upload, scheduling, and YAML metadata control.",
     "repo": "firstpair/omnighost"
   }
   ```

3. **Important**: Keep the list alphabetically sorted by `id`

### Step 4: Commit and Push

```bash
git add community-plugins.json
git commit -m "Add Omnighost plugin"
git push origin main
```

### Step 5: Create Pull Request

1. Go to your fork of `obsidian-releases`

2. Click **Contribute** → **Open pull request**

3. Fill in the PR template:

   **Title**: `Add Omnighost plugin`

   **Description**:
   ```markdown
   ## Plugin Information

   - **Plugin Name**: Omnighost
   - **Author**: Alexy Khrabrov
   - **Repository**: https://github.com/firstpair/omnighost
   - **Initial Version**: 0.12.9
   - **Description**: Publish and update Ghost CMS posts from Obsidian on desktop and iOS with image upload, scheduling, and YAML metadata control.

   ## Checklist

   - [x] I have read the [plugin submission guidelines](https://github.com/obsidianmd/obsidian-releases/blob/master/plugin-review.md)
   - [x] My repository is public
   - [x] I have a valid `manifest.json` in the root
   - [x] I have a `versions.json` in the root
   - [x] I have a `README.md` with installation and usage instructions
   - [x] I have published an initial release with `main.js`, `manifest.json`, and `styles.css`
   - [x] The `id` in my manifest matches my repository name format
   - [x] My plugin does not violate Obsidian's policies

   ## Features

   - Publish and update Ghost CMS posts from Obsidian
   - Desktop and iOS support
   - Multiple Ghost blogs
   - Image publishing to Ghost
   - Post scheduling with `g_published_at` property
   - Automatic sync on file save (debounced 2s)
   - Periodic sync based on configurable interval
   - Full YAML frontmatter control for Ghost metadata
   - Markdown to Lexical format conversion
   - JWT authentication with Ghost Admin API
   - Status bar indicator

   ## Testing

   This plugin has been tested with:
   - Obsidian Desktop (macOS)
   - Ghost CMS v5.x
   - Various markdown content including images, code blocks, and formatting
   ```

4. Click **Create pull request**

### Step 6: Wait for Review

The Obsidian team will review your submission. This typically takes:
- **1-2 weeks** for initial review
- May require changes/fixes
- Team will comment on your PR with feedback

### Step 7: Address Feedback

If the team requests changes:

1. Make changes in your plugin repository
2. Create a new release if code changes are needed
3. Update your PR fork if changes are needed in `community-plugins.json`
4. Comment on the PR when ready for re-review

## Common Review Points

The Obsidian team checks for:

1. **Security**
   - No hardcoded secrets
   - Proper use of Obsidian's `requestUrl` instead of fetch
   - No eval() or dangerous code execution

2. **Code Quality**
   - TypeScript with proper typing
   - No console.log in production (console.warn/error is OK)
   - Proper error handling

3. **User Experience**
   - Clear error messages
   - Proper loading states
   - No blocking operations

4. **Documentation**
   - Clear README
   - Installation instructions
   - Configuration guide

## After Approval

Once approved:

1. Plugin appears in Community Plugins browser
2. Users can install directly from Obsidian
3. Updates are automatic when you release new versions

## Updating the Plugin

For future releases:

1. Update `version` in `manifest.json`
2. Add entry to `versions.json`:
   ```json
   {
     "0.1.0": "1.0.0",
     "0.2.0": "1.0.0"
   }
   ```
3. Create GitHub release with new tag
4. Include updated `main.js`, `manifest.json`, `styles.css`
5. Users will auto-receive update

## Useful Links

- Plugin Guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Plugin Review Docs: https://github.com/obsidianmd/obsidian-releases/blob/master/plugin-review.md
- Community Plugins List: https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json
- Plugin Stats: https://obsidian-plugin-stats.vercel.app/

## Support

If you have questions:
- Obsidian Discord: https://discord.gg/obsidianmd
- Forum: https://forum.obsidian.md/
- GitHub Discussions: https://github.com/obsidianmd/obsidian-releases/discussions

---

**Ready to submit?** Follow the steps above and good luck! 🚀
