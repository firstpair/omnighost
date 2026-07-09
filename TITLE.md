# Title Contract

Omnighost treats a post title as publishing metadata, not body content. A note
can still contain a Markdown H1, but the H1 is a separate title slot with an
explicit policy.

## Title Slots

- **Metadata title**: the top-level YAML `title` property. This is the preferred
  Ghost title field and the most editable place in Obsidian Properties.
- **Heading title**: the first leading Markdown H1 in the body, such as
  `# My post title`. "Leading" means it appears before other body content after
  optional frontmatter whitespace.
- **File title**: the Obsidian filename. This is navigation/fallback only, not
  the primary publishing contract.

## Import Policy

Textpack import analyzes both metadata title and heading title.

Manual import shows:

- **Primary title on import**: choose metadata title or first H1 heading.
- **Update secondary title**: when the chosen source differs, rewrite the other
  title slot to match before duplicate cleanup.

The imported note always gets a top-level `title` property equal to the chosen
publishing title. If the leading H1 matches that final title, Omnighost removes
the H1 from the imported body to avoid showing the same title twice in Obsidian.

Default import behavior is:

1. Use the first leading H1 when one exists.
2. Otherwise use the metadata title.
3. Otherwise use the textpack name.
4. Update the secondary title before duplicate cleanup.

Auto-import uses the default import behavior without opening a modal.

## Sync Policy

Settings include:

- **Sync title source**: metadata title or first H1 heading.
- **Update secondary title on sync**: rewrite the non-primary title slot to match
  the title sent to Ghost after a successful sync.

Ghost title precedence on sync is:

1. Configured primary source, when present.
2. The other title source, when present.
3. Obsidian filename.

Slug generation uses the resolved Ghost title when `g_slug` is unset.

## Practical Guidance

For low-duplication Obsidian notes, use `title` as the canonical publishing
title and avoid a matching body H1. Start the body with the header image,
subtitle, deck, or first section.

If a manuscript/textpack uses an H1 as its visible source title, import with
"First H1 heading" selected. Omnighost will promote that H1 into `title` and
remove the duplicate body heading.
