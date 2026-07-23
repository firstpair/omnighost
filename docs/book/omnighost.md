<span id="ch002.xhtml"></span>

<div id="ch002.xhtml_preface" class="section level1">

# Preface

This is a field guide to **Omnighost**, the First Pair Press bridge from Obsidian to Ghost. It still assumes **no prior knowledge**: if you have never heard of Obsidian, never written a note in “Markdown,” and are not sure what a “vault” is, you are in exactly the right place.

The book is written with the **whole Obsidian loop** in mind: phone, tablet, laptop, desktop, and any synced vault that can run the plugin. First Pair Press uses that loop to draft anywhere and publish everywhere: a release note from an iPhone, a long essay from a Mac, an imported project announcement from a `.textpack`, or a photo-heavy post assembled inside a vault.

Omnighost is now part of the First Pair Press publishing stack. It turns notes into live Ghost posts, keeps those posts linked to their source notes, uploads local images, imports packaged drafts with their assets, and fans the same message out through multiple blogs without losing track of which post lives where.

A note on the pictures: the diagrams are drawn fresh for this book, and the phone screenshots are from the author’s own device. Where this book points you to features in detail, it links to the **official Obsidian documentation** at *help.obsidian.md* rather than copying it — that is always the most current source.

Let’s begin.

</div>

<span id="ch003.xhtml"></span>

<div id="ch003.xhtml_what-is-obsidian" class="section level1">

# What Is Obsidian?

Imagine a drawer full of plain text files — one per idea, project, person, or day. Now imagine that drawer is searchable in an instant, that any note can *link* to any other note, and that the whole thing lives on your own device instead of someone else’s server. That, in one sentence, is Obsidian.

More precisely, Obsidian is an app for writing and connecting notes that are stored as **ordinary files on your device**. Three ideas make it tick.

**1. Your notes are plain files.** Each note is a normal text file with a `.md` extension (more on `.md` in a moment). You can open them in any other program, back them up like any other file, and read them in fifty years without needing Obsidian at all. Nothing is locked inside a proprietary database.

**2. Your notes live in a “vault.”** A *vault* is just a folder on your device that Obsidian watches. Everything in that folder — notes, images, sub-folders — is your vault. You can have one vault for everything, or several (work, personal, a journal). A vault is portable: copy the folder, and you’ve copied your whole knowledge base.

![A vault is a folder containing Markdown notes, project folders, and images.](docs/book/diagrams/vault-structure.png)

**3. Notes connect to each other.** The real magic is *linking*. Any note can point to any other note, and Obsidian remembers the connection in both directions. Over time your notes stop being a pile and start being a *web* — a personal Wikipedia where you are the only editor and the only reader.

For First Pair Press, that same plain-file vault is also the press room. A book idea, release announcement, technical note, and public essay can start as ordinary Markdown, collect images beside it, move between devices, and become a web post only when it is ready. Omnighost adds the publishing rail without taking the vault away from Obsidian.

<div id="ch003.xhtml_why-people-like-it" class="section level2">

## Why people like it

- **Local and private.** By default your notes never leave your device unless you choose to sync or publish them.
- **It outlives the app.** Plain Markdown files are about as future-proof as a digital format gets.
- **It grows with you.** Start with a grocery list; end with a research system. The app doesn’t force a structure on you.
- **It’s extensible.** A large community builds *plugins* that add features — including the one in the last chapter of this book.

</div>

<div id="ch003.xhtml_what-markdown-is-the-90-second-version" class="section level2">

## What Markdown is (the 90-second version)

Markdown is a way of writing formatted text using plain characters. Instead of clicking a “bold” button, you wrap a word in asterisks. Instead of a heading style, you start a line with `#`. It looks like this:

``` text
# A heading

This is a paragraph with a **bold** word and an *italic* one.

- a bullet
- another bullet

> a quoted line
```

You don’t have to memorize it — Obsidian shows you the formatted result as you type, and there is a one-page cheat sheet at the back of this book. The point is that the formatting is *part of the text*, so your notes stay readable anywhere.

</div>

</div>

<span id="ch004.xhtml"></span>

<div id="ch004.xhtml_getting-started-on-your-phone" class="section level1">

# Getting Started on Your Phone

Obsidian is free to download. The fastest path on a phone:

1.  Open the **App Store** (iPhone/iPad) or **Google Play** (Android) and search for **Obsidian**. Install it.
2.  Open the app. The first time, it offers to **create a vault** or open an existing one. Choose **Create new vault**, give it a name (e.g. *Notes*), and pick where it lives.
3.  On iPhone you’ll typically choose between storing the vault **on your device** or **in iCloud Drive** (handy if you also use a Mac). On Android you pick a folder. Either is fine to start; you can move it later.
4.  Tap the **+** (new note), type something, and you’ve made your first note.

That’s genuinely it — you now have a working second brain in your pocket.

<div id="ch004.xhtml_a-quick-tour-of-the-screen" class="section level2">

## A quick tour of the screen

On a phone the interface is deliberately spare. A few things to find:

- The **note area** in the middle, where you read and write.
- A **left sidebar** (swipe from the left edge, or tap the menu icon) with your **file list** and **search**.
- A **right sidebar** (swipe from the right) with extras like **backlinks** and the **outline**.
- A **command palette** — a searchable list of *everything* the app can do. You’ll use this constantly; we’ll meet it properly in Chapter 6.
- A **ribbon** of icons for common actions and for plugins.

If you ever feel lost, remember two gestures: **swipe from the left** for your files, and open the **command palette** to search for any action by name.

</div>

<div id="ch004.xhtml_on-editing-modes" class="section level2">

## On editing modes

Obsidian can show a note two ways. **Live Preview** formats text as you write (bold looks bold). **Source mode** shows the raw Markdown characters. Beginners usually live in Live Preview; switch to Source when you want to see exactly what’s in the file. You can toggle between them from the command palette or the note’s “more options” menu.

</div>

</div>

<span id="ch005.xhtml"></span>

<div id="ch005.xhtml_writing-in-markdown" class="section level1">

# Writing in Markdown

You already saw the basics. Here is the working set you’ll use 95% of the time.

**Headings** structure a note. One `#` is the biggest; more `#` make smaller sub-headings.

``` text
# Title
## Section
### Sub-section
```

**Emphasis**:

``` text
*italic*  or  _italic_
**bold**  or  __bold__
~~strikethrough~~
```

**Lists** — bullets with `-`, numbers with `1.`:

``` text
- milk
- eggs

1. wake up
2. coffee
```

**Checkboxes** turn a list into a to-do list. Tap a box in Live Preview to check it off:

``` text
- [ ] write a note
- [x] install Obsidian
```

**Quotes** and **code**:

``` text
> A quoted thought.

Inline `code` for a command. For several lines of code or commands, fence them with three backticks on their own lines, above and below.
```

**Images** can be dropped or pasted into a note; Obsidian stores the file in your vault and writes a link to it for you.

The golden rule: when in doubt, just *type*. Markdown is forgiving, and anything it doesn’t recognize is simply shown as plain text.

</div>

<span id="ch006.xhtml"></span>

<div id="ch006.xhtml_linking-your-thoughts" class="section level1">

# Linking Your Thoughts

This is the chapter that turns a notes app into *Obsidian*.

To link from one note to another, type two square brackets and start typing a name:

``` text
See also [[Books to read]] and [[Garden]].
```

As you type inside the brackets, Obsidian suggests matching notes. Pick one and you’ve made a link. Tap the link later to jump there. If the target note doesn’t exist yet, the link is created “empty” — tap it and Obsidian makes the note for you. This is a lovely way to write: mention an idea now, flesh it out later.

<div id="ch006.xhtml_backlinks-connections-in-reverse" class="section level2">

## Backlinks: connections in reverse

Here’s the part that feels like magic. If note A links to note B, then note B automatically knows that A points at it. Open B, look at its **Backlinks** panel, and you’ll see every note that mentions it — without you ever editing B.

![Backlinks show which notes point at the current note.](docs/book/diagrams/backlinks.png)

Backlinks mean you never lose a thought. Write about your garden in today’s journal, and the *Garden* note quietly collects every mention over the months.

</div>

<div id="ch006.xhtml_the-graph" class="section level2">

## The graph

Obsidian can draw your whole vault as a **graph**: each note is a dot, each link a line. Early on it’s a few scattered dots. After a few hundred notes it becomes a constellation, and clusters appear where your real interests live. The graph is more fun than useful at first — but it’s a great way to *see* your thinking take shape.

</div>

<div id="ch006.xhtml_tags" class="section level2">

## Tags

Sometimes you don’t want a whole note for a topic — you just want a label. Type a `#` followed by a word, with no space:

``` text
Had a great idea on the bus today. #ideas #commute
```

Tags are searchable and clickable. They’re a lighter-weight cousin of links: links connect specific notes; tags gather many notes under a theme.

</div>

</div>

<span id="ch007.xhtml"></span>

<div id="ch007.xhtml_organizing-a-vault" class="section level1">

# Organizing a Vault

There is no single “right” way to organize Obsidian, which is liberating and, at first, slightly terrifying. Three tools help, and you can mix them freely.

**Folders** work exactly as you’d expect — drag notes into them, nest them. Good for coarse separation (Work, Personal, Journal). Don’t over-think folders; linking and search make deep hierarchies unnecessary.

**Tags** (from the last chapter) cut *across* folders. A note in `Work/` can carry `#idea` right alongside a note in `Personal/`.

**Properties** are the most powerful and the least obvious, so they get their own section.

<div id="ch007.xhtml_properties-the-notes-data" class="section level2">

## Properties (the note’s “data”)

Every note can carry a small block of structured information at the very top, called **properties** (the underlying format is called *YAML frontmatter*). It’s fenced by three dashes:

``` text
---
title: Trip to Los Cabos
status: draft
tags: [travel, 2026]
rating: 5
---

The body of the note starts here.
```

Each line is a **key** and a **value**. Obsidian shows these as a tidy **Properties panel** at the top of the note, with the right input for each type — a checkbox for yes/no, a date picker for dates, a list editor for lists.

![A note’s Properties panel on a phone. The keys on the left (here prefixed `ghost_`) each have an editor on the right — text, checkboxes, and lists. Long key names are truncated; tap one to see it in full.](docs/book/media/file2.png)

Why bother? Because properties make notes *queryable and automatable*. Plugins read them, dashboards filter on them, and — as you’ll see in the final chapter — a publishing plugin uses them to decide a post’s title, visibility, and schedule. For now, just know that the block at the top of a note is where the *structured* information lives, separate from the prose below it.

</div>

</div>

<span id="ch008.xhtml"></span>

<div id="ch008.xhtml_finding-things" class="section level1">

# Finding Things

A vault is only as good as your ability to get back to a note. Obsidian gives you three fast paths, and all three are reachable from the phone.

**Search** (the magnifying glass in the left sidebar) looks through the full text of every note. It supports quoted phrases and simple operators, but plain words get you a long way.

**Quick Switcher** jumps to a note by name. Open the command palette and run “Quick switcher,” type a few letters of a note’s title, and hit it. This is the single fastest way to navigate once you know roughly what you’re looking for.

**Command Palette** is the master key. It’s a searchable list of *every* command in the app and its plugins — “Toggle Live Preview,” “Open graph view,” “Create new note,” and hundreds more. You don’t need to memorize menus; you just remember a word or two and search. On a phone it’s usually a toolbar icon or a swipe-down; bind it to something comfortable and use it for everything.

> Tip: most actions you’ll read about in this book — including the Omnighost commands later — are run from the command palette by typing part of their name.

</div>

<span id="ch009.xhtml"></span>

<div id="ch009.xhtml_making-obsidian-yours-plugins" class="section level1">

# Making Obsidian Yours: Plugins

Out of the box, Obsidian is intentionally modest. Its power comes from **plugins**, and there are two kinds.

![](docs/book/media/file3.png)

**Core plugins** are made by the Obsidian team and ship with the app. They’re just toggled on or off in **Settings → Core plugins**. Many features you’ve already met — Backlinks, Graph view, Daily notes, Templates, Outline — are core plugins. If something seems missing, check here first; it may simply be switched off.

**Community plugins** are built by other people and published to an in-app directory. They unlock workflows the core app never tries to cover: calendars, task boards, spaced-repetition flashcards, and the Ghost publishing plugin in the next chapter.

<div id="ch009.xhtml_turning-on-community-plugins-safely" class="section level2">

## Turning on community plugins safely

The first time you want a community plugin, Obsidian asks you to acknowledge that these are third-party add-ons (sensible — they run real code). Once you’ve turned the feature on, you can **Browse** the directory, install a plugin, and **enable** it. Each plugin lives in your vault under a hidden `.obsidian/plugins/` folder, so it travels with the vault.

A few habits keep this pleasant:

- **Install what you’ll use**, not everything that looks interesting.
- **Read the plugin’s page** for what permissions or setup it needs.
- **Update occasionally** — plugins improve, and updates are one tap.

There’s also a popular community plugin called **BRAT** that installs and auto-updates plugins straight from a GitHub repository. It’s the easiest way to run a plugin that isn’t (yet) in the official directory — which is exactly how you’ll install Omnighost on a phone in the final chapter.

</div>

</div>

<span id="ch010.xhtml"></span>

<div id="ch010.xhtml_syncing-across-devices" class="section level1">

# Syncing Across Devices

Most people want the same notes on their phone and their computer. Because a vault is just a folder, you have several ways to keep it in step.

![](docs/book/media/file4.png)

**Obsidian Sync** is the official, paid service. It’s the most reliable option, encrypts your notes end-to-end, handles conflicts gracefully, and works across every platform with no fiddling. If syncing matters to you, it’s the least painful choice.

**iCloud Drive** (Apple devices) is free and built in: put the vault in iCloud and your iPhone, iPad, and Mac share it. It works well for one person on Apple gear, though it can be slower to settle than Sync and is less forgiving if two devices edit the same note at the same moment.

**Other options** exist — third-party cloud drives, or **Git** for the technically inclined (which also gives you a full history). These are more setup but more control.

Two pieces of advice regardless of method:

- **Pick one sync method** and stick with it. Layering two (say iCloud *and* Sync) is how conflicts are born.
- **Keep a backup.** Sync is not a backup — it faithfully copies your mistakes too. Because your vault is plain files, any normal backup works.

</div>

<span id="ch011.xhtml"></span>

<div id="ch011.xhtml_publishing-to-the-web-with-omnighost" class="section level1">

# Omnighost and the First Pair Press Web

So far your notes have stayed private. This chapter is about the other direction: taking a note you wrote in Obsidian and **publishing it as a post on a real website** — and, crucially, **updating** that post later from the same note, without creating duplicates. For First Pair Press, the tool is **Omnighost**: a practical web-publishing rail from any Obsidian platform to one Ghost blog or many.

<div id="ch011.xhtml_what-is-ghost-and-what-does-the-plugin-do" class="section level2">

## What is Ghost, and what does the plugin do?

**Ghost** is a popular publishing platform — think of it as software that runs a blog or newsletter, like a leaner, modern WordPress. A Ghost site has *posts*, each with a title, body, tags, an excerpt, a visibility setting (public or members-only), and a publish date.

**Omnighost** connects your Obsidian vault to one or more Ghost sites. You write in Obsidian as usual; the plugin pushes the note to Ghost as a post. Publish the same note again and it *updates the existing post in place* rather than spawning a copy. If you run several blogs, one note can publish to one site, several sites, or stay out of sync entirely.

![Omnighost reads an Obsidian note and local images, creates or updates the Ghost post, and writes post identifiers back to the note.](docs/book/diagrams/omnighost-flow.png)

The flow is worth understanding because it explains the whole plugin:

1.  The note’s **properties** (a set of keys, by convention prefixed `ghost_` or `g_`) tell Omnighost which blog(s) to target, whether the post is a draft or published, who can read it, when it should go live, and which tags/images to use.
2.  On the **first publish**, the plugin creates the post and writes that blog’s **id**, Ghost editor URL, and public URL back into the note’s properties.
3.  On **later syncs**, it reads those stored ids and updates the exact same Ghost posts. In multi-blog notes, each target blog gets its own id and URL keys.
4.  Any **local images** in the note are uploaded to Ghost and the links rewritten, so pictures actually appear on the web.

</div>

<div id="ch011.xhtml_what-omnighost-now-gives-the-press" class="section level2">

## What Omnighost now gives the press

The current Omnighost is no longer just a “send this note to Ghost” button. It is a full publishing manager for a small press that writes in public:

- **Publish from any Obsidian platform.** Draft on desktop, revise on iPad, finish on iPhone, and sync from the same vault.
- **Manage many Ghost blogs.** Add one blog per publication channel, each with its own site URL, Admin API key, folder, automatic sync setting, and interval.
- **Choose one blog or many.** Use `g_blog`, the blog picker, or folder routing to decide whether a note goes to one site, several sites, or none.
- **Update in place.** Omnighost stores per-blog Ghost ids and public URLs, so repeated syncs revise the live posts instead of making duplicates.
- **Publish images.** Local Markdown images and Obsidian image embeds upload to Ghost, then the note is rewritten to use the hosted image URLs.
- **Promote covers when needed.** The first body image can become the Ghost feature image and disappear from the body, which is useful for announcement cards.
- **Avoid repeat image uploads.** Images are cached by content hash, so unchanged assets are reused on later syncs.
- **Skip unchanged posts.** Omnighost compares the finished Ghost publication, reports `Unchanged`, and avoids a needless update when nothing managed by the plugin has changed.
- **Record publication provenance.** Every managed post carries a reproducible SHA-256 and, when desktop Git is available, the source note’s Git version.
- **Import textpacks.** A `.textpack` can carry Markdown, images, and Omnighost metadata into the vault as a sync-ready draft.
- **Import or link existing Ghost posts.** A Ghost site can be pulled back into the vault, one post or one blog at a time, so Obsidian remains the editorial source.
- **Update itself from GitHub.** A command replaces the complete three-file plugin bundle from the repository’s current `main` branch and rolls back if installation fails.
- **Clean up safely.** Bulk delete uses a checklist, optional per-post confirmation, and local archives; remote posts are never deleted silently.
- **Plan the calendar.** The editorial calendar view shows published and scheduled posts for the month.

That mix matters for First Pair Press because publishing is rarely one note to one site. A book release, a project milestone, or a manifesto may need a main press announcement, a project-specific post, a personal note, and a newsletter-oriented version. Omnighost keeps the source material in Obsidian and remembers every live destination.

</div>

<div id="ch011.xhtml_installing-it-on-any-obsidian-platform" class="section level2">

## Installing it on any Obsidian platform

Omnighost is distributed as a community plugin. The easiest route before community-directory release is the **BRAT** plugin mentioned earlier:

1.  Install and enable **BRAT** from the community plugin directory.
2.  Run the command **“BRAT: Add a beta plugin for testing”** and give it the plugin’s repository (e.g. `firstpair/omnighost`).
3.  Enable **Omnighost** under **Settings → Community plugins**.

That works on desktop and mobile Obsidian. You can also install it by hand: copy the plugin’s `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/omnighost/` in your vault. Because the plugin lives inside the vault, the same First Pair Press vault can carry its publishing tools from Mac to iPad to iPhone.

</div>

<div id="ch011.xhtml_connecting-to-your-site" class="section level2">

## Connecting to your site

In **Settings → Omnighost**, the first section is **Ghost blogs**. Add one block per Ghost site. Each blog has:

- a display **Name**;
- a **Site address** such as `https://yourblog.com`;
- an **Admin API Key**, which you create in Ghost admin under *Settings → Integrations → Add custom integration* and paste into that blog’s key field;
- a vault **Folder** for that blog’s posts;
- an **Auto-sync this folder** toggle; and
- an optional per-blog **Sync interval**.

Tap **Save key** for each blog. Omnighost stores the key in Obsidian’s secure keychain and immediately tests the connection. A good connection greets you by the Ghost site’s name. If two blogs accidentally share the same keychain secret, settings warns you, because the wrong key will fail with a Ghost 401.

You may enter a bare address such as `yourblog.com`; Omnighost treats it as `https://yourblog.com`. Only specify `http://` deliberately when you are connecting to a local or otherwise non-TLS Ghost installation.

For First Pair Press, think of each blog block as one public voice: the press site, a project site, a research notebook, a partner publication, or a newsletter-facing Ghost instance. Each one gets its own credentials and folder, but the writer stays in one Obsidian vault.

</div>

<div id="ch011.xhtml_the-properties-that-control-a-post" class="section level2">

## The properties that control a post

Each note you publish carries a few special properties. With the current default prefix they read `ghost_…`; many people shorten the prefix to `g_…` so the names fit better on a phone. The essentials:

- `g_blog` — a list of blog names or domain keys. Omit it to use the default blog.
- `g_published` — a checkbox. **Off** keeps the post a *draft*; **on** publishes it.
- `g_post_access` — the visibility: `public`, `members`, or `paid`.
- `g_published_at` — a date, used only when you want to *schedule* a post for the future.
- `g_slug` — the post’s URL ending. Leave it empty to derive one from the title.
- `g_tags`, `g_excerpt`, `g_feature_image`, `g_cover_from_first_image` — tags, a short summary, a cover image, and the optional “use the first body image as cover” behavior.
- `g_no_sync` — a per-note safety switch. Turn it on to skip that note.
- `g_id_example_com`, `g_url_example_com`, `g_public_url_example_com` — written *by the plugin* after a successful publish to `example.com`. You don’t edit these; they’re how Omnighost finds that blog’s post again and how you reach it on the web.

Older notes may have clean keys like `g_id` or map keys like `g_ids`. Omnighost migrates those forward as it syncs. The command **Normalize blog references (use domain keys)** rewrites blog references to stable domain-based keys, so renaming a blog does not break note-to-post links.

</div>

<div id="ch011.xhtml_the-easy-way-the-properties-modal" class="section level2">

## The easy way: the properties modal

Editing those keys by hand in the native Properties panel works, but the values are free text — easy to mistype `Public` when Ghost wants `public`. Omnighost adds a dedicated **Edit ghost properties** dialog (open it from the ghost ribbon icon, the editor’s right-click menu, or the command palette) with proper controls:

- **Status** — a dropdown: *Draft*, *Publish now*, or *Schedule* (which reveals a date field).
- **Visibility** — a dropdown: *Public*, *Members only*, or *Paid*.
- Toggles for *Featured* and *Use first image as cover*.
- Plain text for *Tags*, *Slug*, *Excerpt*, *Feature image*.
- If you have more than one blog configured, a **Blogs** checklist for choosing exactly where this note publishes.
- A status line showing whether the post is **Published** (with the live URL and a copy button) once it has actually gone out.
- Two buttons: **Save** (write the properties) and **Save & sync** (write *and* publish in one tap).

Because the choices are dropdowns, you can’t accidentally enter an invalid value. That single dialog is the recommended way to publish.

</div>

<div id="ch011.xhtml_a-first-publish-start-to-finish" class="section level2">

## A first First Pair Press publish, start to finish

1.  Write a note. Give it a real title — either a `# Heading` at the top or a sensible filename, because the title drives the post’s web address.
2.  Add the images, diagrams, screenshots, or cover art that should travel with it.
3.  Open **Edit ghost properties**.
4.  Pick the target blog or blogs.
5.  Set **Status** to *Publish now*, **Visibility** to *Public*.
6.  Tap **Save & sync**.
7.  Watch the status line flip to **Published** with a live link, and tap the copy button to grab the URL.

Here’s the result on the open web — a note written on a phone, now a public post:

![The same note published as a public post on a Ghost site, viewed in a mobile browser. The subscribe box at the bottom is Ghost’s standard newsletter call-to-action on public posts — not a paywall.](docs/book/media/file6.png)

To **change** the post later, edit the note and **Save & sync** again. The plugin finds the existing post by its stored id and updates it — same URL, no duplicate. You can also run **Sync current note to ghost** from the command palette, or use the periodic folder sync if it is enabled for that blog.

When the managed post is already identical, Omnighost skips the Ghost update and reports **Unchanged**. By default it fetches the live post and compares the fields it manages, so an edit made directly in Ghost is detected rather than hidden by an old stored hash.

</div>

<div id="ch011.xhtml_publication-provenance" class="section level2">

## Publication provenance

Omnighost calculates a canonical SHA-256 for the finished Ghost publication. The digest covers the title, converted body, status, visibility, featured flag, slug, excerpt, feature image, ordered tags, and scheduled time. It is stored in hidden per-post Ghost metadata, giving the plugin a reproducible way to decide whether the note and live post still agree.

On desktop, Omnighost can also record the source note’s Git version. If the note belongs to a Git repository and has changed, the plugin commits that note only; it never pushes. If Git is unavailable, unsafe to use, or the publish happens on mobile, the publication still has its directly comparable SHA-256.

The **Publication provenance** setting controls what readers see:

- **Visible version and credit** shows a linked Omnighost credit, the Git version when available, and the publication SHA-256.
- **Visible credit only** shows the linked credit while keeping version details out of the article.
- **Hidden provenance** adds no reader-facing line; the version details remain in Ghost’s per-post code-injection metadata.

Hidden means non-visible, not secret or cryptographically signed. Keep **Verify published content directly** on if posts may also be edited in Ghost. It is enabled by default and compares the managed live fields even when the stored hash says the post is current. Turning it off permits a faster hash-only check, but direct Ghost edits may be missed.

</div>

<div id="ch011.xhtml_publishing-to-more-than-one-blog" class="section level2">

## Spreading the word through multiple blogs

Omnighost can manage several Ghost sites at once. For First Pair Press, this is the feature that turns a finished note into a real publicity surface.

![One note can route through Omnighost to several Ghost blogs, each with its own folder, key, and post identity.](docs/book/diagrams/multi-blog-routing.png)

In **Settings → Omnighost**, the **Ghost blogs** section lets you **Add blog**. Each one gets its own name, site address, Admin API key (a keychain secret), folder in your vault, sync toggle, and optional interval. One blog is marked the default (★), and a **Test** button confirms each connection by name.

Blog folders nest under one root. By default each blog’s folder derives from its site address as **`Ghost Posts/<domain>`** — `Ghost Posts/chief.sc`, `Ghost Posts/collected.ga` — so all your publishing lives under a single top-level folder. Leave a blog’s **Folder** field blank for the automatic path, or type your own to override it. If your blogs predate this layout and sit in scattered folders, the **Organize folders by domain** button in settings moves every blog’s notes (archives included) into place with links intact, and re-points the folders — nothing changes until you confirm.

To choose where a note goes, run the command **“Set blog(s) for this note.”** A checklist appears; tick one or more blogs and confirm. Your choice is saved in the note’s **`g_blog`** property and sticks. If you tick several blogs, syncing the note publishes — and later updates — *all* of them at once. The last blog you pick becomes the default for the next new note.

The folders themselves also route. A note with no `g_blog` property publishes to the blog whose folder it sits in — drag a draft into `Ghost Posts/chief.sc/` and that is where it goes. Notes directly under the root belong to the default blog. An explicit `g_blog` always wins over location.

Selective sync has two levels. For one note, set `g_no_sync: true` and Omnighost leaves it alone. For a whole blog folder, turn off **Auto-sync this folder** in that blog’s settings; manual sync still works when you ask for it.

A typical First Pair Press announcement might start as one note:

```yaml
---
g_blog: ["firstpair.press", "chief.sc", "collected.ga"]
g_slug: "omnighost-first-pair-press"
g_tags: [first-pair-press, omnighost, publishing]
g_excerpt: "Omnighost turns an Obsidian vault into the web publishing rail for First Pair Press."
g_cover_from_first_image: true
g_published: true
---
```

On sync, Omnighost creates or updates one Ghost post per blog and writes back separate identity keys for each target. That means the press can spread the same news across several audiences while preserving one source note and one edit loop. If the subtitle changes, the image needs a better caption, or a date moves, a second sync updates every linked post in place.

To bring an existing site into Obsidian, run **“Import all posts from a ghost blog,”** choose one or more blogs, and every post arrives as a note in that blog’s folder, already tagged with its `g_blog` and per-blog id/URL keys. To import one post, use **Import post from ghost** with the Ghost editor URL. To connect an existing note to an existing Ghost post, use **Link note to ghost post** and choose whether Ghost overwrites the note or the note syncs up to Ghost.

One thing to know: a note’s identity on each blog is its stored id, with the slug as the fallback before the first id is written. Keep slugs stable once a note is published widely. If you remove a blog from `g_blog` after the note has already published there, the next interactive sync warns about the orphaned Ghost post. You can delete it on Ghost, keep it by re-adding that blog, or decide later.

</div>

<div id="ch011.xhtml_importing-textpacks" class="section level2">

## Importing textpacks

A **textpack** is a small zip that bundles a Markdown post together with its images — the format writing apps like Ulysses use to move documents between devices. Omnighost imports textpacks directly, which makes it the last mile for drafts prepared elsewhere: a post written in a project repo, exported from a book pipeline, or polished in another writing app travels to your phone as one file and leaves it as a publishable First Pair Press draft.

There are two ways in:

- **Import textpack** (command palette) opens a file picker. Choose the pack and a target blog, and the note is created on the spot.
- Save the pack **into the vault** from any share sheet — in the Files app, long-press the pack, then *Share → Save to Files → your vault*. Omnighost imports it automatically: a scan at startup catches packs that arrived while Obsidian was closed, a live watcher catches ones saved while it is open, and the pack file itself moves to trash once the note exists. This is the practical route on iOS, where Obsidian cannot appear in the Files app’s “Open With…” menu. The behavior is governed by the **Auto-import textpacks** toggle (on by default), and an **“Import textpacks found in vault”** command runs the same sweep by hand.

Either way the result is the same: the note lands in the blog’s folder with its Ghost properties already set, and its images are placed under `assets/<slug>/` next to it — they upload to Ghost automatically on the first sync, like any other local image. The note arrives as a *draft*, so nothing is published until you decide.

A pack can also carry its own publishing instructions — blog, slug, title, tags, excerpt — embedded in the bundle’s `info.json` under Omnighost metadata. Packs prepared with the companion `textpack.py` script target the right blog by themselves: save the file, open Obsidian, review the draft, sync, done.

Those companion-script packs can also preserve source provenance across the handoff. The script safely commits the source Markdown and referenced local images, then embeds the Git commit and a payload SHA-256. Omnighost verifies the payload on import. Publishing controls, blog routing, and Ghost id/URL write-backs do not invalidate the inherited source version; changing authorial metadata, body text, or imported asset bytes does. The Git claim is self-attested rather than a signature, so treat it as traceability, not proof that an untrusted pack came from a particular repository.

This is how First Pair Press can connect repo-native writing to mobile publishing. A project can build a textpack with rendered diagrams, screenshots, and metadata; iCloud or another sync path drops it into the vault; Omnighost imports it; the editor checks the note on whichever Obsidian device is in hand; and the same note can then publish to the press blog, the project blog, or both.

</div>

<div id="ch011.xhtml_import-fidelity" class="section level2">

## Bringing Ghost posts back cleanly

Ghost’s editor stores rich blocks rather than Markdown, so importing requires a conversion in the other direction. Current Omnighost keeps fenced code and blockquotes bounded correctly: prose, headings, and images that follow a Python or other code block stay outside its closing fence, and paragraphs after a quotation are no longer swallowed into the quote. Multi-paragraph quotations remain together.

If an older import looks like one enormous code block or quotation, update Omnighost and import that Ghost post again. The repair is in the importer; it does not rewrite an already damaged note automatically.

</div>

<div id="ch011.xhtml_bulk-delete-and-safe-cleanup" class="section level2">

## Bulk delete and safe cleanup

Publishing tools need a careful delete story. Omnighost never deletes remote posts silently.

![Bulk delete is a checklist workflow with final confirmation, optional per-post prompts, and local archive support.](docs/book/diagrams/bulk-delete.png)

Run **“Bulk delete posts (local notes + ghost)”** to choose one or more blogs. Omnighost lists the linked notes and Ghost posts it can find. Nothing is preselected — tick exactly the posts you want gone, or use the **Select all** checkbox at the top of the list. When you confirm, Omnighost deletes only the selected Ghost posts. It also removes the selected local notes.

If **Archive deleted notes** is on, local notes move into an archive subfolder inside their blog folder instead of going to trash. Omnighost stamps them with archive metadata and `g_no_sync: true`, so archived notes are not accidentally re-published. If the archive option is off, the notes go to Obsidian trash.

Two extra settings control how cautious the workflow is:

- **Prompt on folder delete** — if you delete a folder of synced notes, Omnighost opens the same checklist for their linked Ghost posts. The notes are already gone locally, but the Ghost posts are still untouched until you confirm. Notes that merely *moved* elsewhere in the vault are tracked and never offered — deleting an old, emptied folder after reorganizing brings up nothing.
- **Confirm each remote delete** — during a bulk delete, Omnighost shows each post and blog name with **Delete**, **Skip**, and **Stop**.

</div>

<div id="ch011.xhtml_when-something-goes-wrong" class="section level2">

## When something goes wrong

Ghost validates posts, and when a field is off it returns a precise message. Reading that message is the fastest way to fix it:

![A Ghost validation error surfaced in Obsidian. The text names the exact problem — here, a slug longer than Ghost’s 191-character limit — which points straight at the fix.](docs/book/media/file7.png)

A few common cases and what they mean:

- **“Successfully connected” shows the wrong name, or connection fails** — that blog’s Ghost URL or Admin API Key is wrong. Re-enter them in the blog block; the greeting confirms the right site.
- **A slug-length error** (as pictured) — the note had no heading, so the title fell back to a long first paragraph. Give the note a short `# Heading` or set `g_slug` explicitly.
- **The post looks “paywalled” but you set it public** — check the body: if the *content* is visible and only a *Subscribe* box sits at the bottom, that box is Ghost’s normal newsletter call-to-action on public posts, not a lock. Confirm the visibility in Ghost admin to be sure.
- **It shows “Published” but you got an error** — newer versions tie the green “Published” badge to a real published URL, so a failed sync won’t falsely show green. If yours does, update the plugin.
- **A blog sync says the key is missing** — each blog needs its own stored Admin API key. Paste the key into that blog’s **Admin API key** field and tap **Save key**.
- **An imported note is “chopped” or later text sits inside a code block or quote** — update Omnighost, then re-import the post. Current releases close imported fenced-code and blockquote runs at the correct boundary.

</div>

<div id="ch011.xhtml_updating-from-github" class="section level2">

## Updating from GitHub

BRAT remains the easiest automatic update route, but Omnighost can now replace its own installed bundle. Open the command palette and run **Update from GitHub**. The command downloads the current `main.js`, `manifest.json`, and `styles.css` from `firstpair/omnighost` on GitHub, stages all three, clears stale temporary or backup files left by an earlier attempt, and then replaces the installed files as one update. Even an unchanged file is refreshed, so the three-file bundle cannot become a mixture of releases.

If downloading or installing any file fails, Omnighost restores the previous bundle. After a successful update, restart Obsidian or reload the app so it runs the new `main.js`.

This command tracks the repository’s **main branch**, not a separately reviewed app-store release. Use it when you trust that repository and want its newest build. The command itself first appeared under the temporary name **Update from Codex**; current releases call it **Update from GitHub**.

</div>

<div id="ch011.xhtml_why-updater-is-the-whole-point" class="section level2">

## Why updating is the whole point

Plenty of tools can *post* from a note. The hard part — and the reason this plugin exists — is *re-posting the same note without making a mess*, especially when the same announcement appears on several blogs. Omnighost keeps a stable link between one note and each of its Ghost posts: edit the note, sync, and the live posts change in place. The First Pair Press vault stays the single source of truth, and the web stays in step with it.

</div>

</div>

<span id="ch012.xhtml"></span>

<div id="ch012.xhtml_where-to-go-next" class="section level1">

# Where to Go Next

You now have the whole loop: capture ideas as notes, connect them with links, organize lightly with folders, tags, and properties, find anything in a tap, extend the app with plugins, sync across your devices, and — when a note is ready for the world — publish it through Omnighost to the First Pair Press web.

A few directions from here:

- **Lean on the official docs.** The most current, detailed reference is at *help.obsidian.md*, with developer material at *docs.obsidian.md*. When a menu or setting looks different from this book, trust the docs — apps move fast.
- **Build the press blogs deliberately.** Add one Ghost blog at a time, test its key, give it a clear folder, and publish one safe draft before turning on periodic sync.
- **Package announcements as textpacks.** For repo-driven projects, make the `.textpack` the handoff format so Markdown, images, and Omnighost metadata travel together.
- **Use multi-blog publishing when the audience overlaps.** A release can reach the press site, a project blog, and a personal channel from one source note.
- **Back up.** Your notes are plain files; treat them as precious and copy them somewhere safe.

Most of all: keep the loop alive. Write in Obsidian, review the properties, sync through Omnighost, then keep improving the source note as the public story evolves.

</div>

<span id="ch013.xhtml"></span>

<div id="ch013.xhtml_appendix-a-markdown-cheat-sheet" class="section level1">

# Appendix A: Markdown Cheat Sheet

``` text
# Heading 1        ## Heading 2        ### Heading 3
**bold**           *italic*            ~~strikethrough~~
- bullet           1. numbered         - [ ] / - [x] task
> quote            `inline code`       [[Link to a note]]
#tag               ![alt](image.png)   [text](https://link)

(For multi-line code, fence it with three backticks on their own lines.)
```

</div>

<span id="ch014.xhtml"></span>

<div id="ch014.xhtml_appendix-b-omnighost-property-reference" class="section level1">

# Appendix B: Omnighost Property Reference

With the default prefix the keys begin `ghost_`; many users shorten it to `g_`. The table below uses `g_` for compactness. If your prefix is `ghost_`, read `g_published` as `ghost_published`, and so on.

| Property | Type | Meaning |
|----|----|----|
| `g_blog` | list of names or domains | Which blog(s) the note publishes to (default if absent) |
| `g_published` | checkbox | Off = draft, on = published |
| `g_post_access` | `public` / `members` / `paid` | Who can read it |
| `g_published_at` | date | Future date schedules the post |
| `g_featured` | checkbox | Mark as a featured post |
| `g_slug` | text | URL ending (empty = from title) |
| `g_tags` | list | Post tags |
| `g_excerpt` | text | Short summary (max 300 chars) |
| `g_feature_image` | text | Cover image URL |
| `g_cover_from_first_image` | checkbox | Use the first body image as the cover |
| `g_no_sync` | checkbox | Skip this note when syncing |
| `g_id_<blog>` | written by plugin | The Ghost id for one target blog, using a domain-based suffix |
| `g_url_<blog>` | written by plugin | The Ghost editor link for that blog’s post |
| `g_public_url_<blog>` | written by plugin | The live, public web address for that blog’s post |
| `g_archived` | written by plugin | True when a bulk-deleted local note is archived |
| `g_archived_at` | written by plugin | When the note was moved into the archive folder |
| `g_archived_from` | written by plugin | The note’s original vault path before archive |

Legacy single-blog notes may contain `g_id`, `g_url`, or `g_public_url`. Omnighost reads them for compatibility and migrates toward per-blog keys on later syncs.

</div>
