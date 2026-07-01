# Omnighost Book Publishing Workflow

Use this runbook when updating or rebuilding **Obsidian on the Go**, the local
book recovered from `docs/book/dist/obsidian-0.1.0-a9ae50.epub`.

## Source layout

- Manuscript: `docs/book/omnighost.md`
- Cover source: `docs/book/cover.md`
- Metadata: `docs/book/metadata.yaml`
- Mermaid diagram sources: `docs/book/diagrams/*.mmd`
- Rendered diagram PNGs: `docs/book/diagrams/*.png`
- Screenshots extracted from the EPUB: `docs/book/media/*.png`
- Build script: `docs/book/build.sh`
- Diagram render script: `docs/book/render-diagrams.sh`
- EPUB fixer: `docs/book/fix_epub_layout.sh`
- EPUB validator: `docs/book/check_epub_metadata.sh`
- Artifacts: `docs/book/dist/`

## Artifact contract

Stable deliverables:

- `docs/book/dist/obsidian-typst.pdf`
- `docs/book/dist/obsidian-typst.epub`
- `docs/book/dist/obsidian-troff.pdf`
- `docs/book/dist/obsidian-troff.epub`
- `docs/book/dist/VERSION.md`

Versioned delivery links are generated on each build:

```text
docs/book/dist/obsidian-typst (<package-version>-<short-commit>).epub -> obsidian-typst.epub
docs/book/dist/obsidian-typst (<package-version>-<short-commit>).pdf  -> obsidian-typst.pdf
docs/book/dist/obsidian-troff (<package-version>-<short-commit>).epub -> obsidian-troff.epub
docs/book/dist/obsidian-troff (<package-version>-<short-commit>).pdf  -> obsidian-troff.pdf
```

`VERSION.md` records:

```yaml
version_stamp: <package-version>-<short-commit>
built_at: YYYY-MM-DD
kindle_name_typst: obsidian-typst (<package-version>)
epub_file_typst: obsidian-typst.epub
pdf_file_typst: obsidian-typst.pdf
epub_link_typst: obsidian-typst (<package-version>-<short-commit>).epub
pdf_link_typst: obsidian-typst (<package-version>-<short-commit>).pdf
kindle_name_troff: obsidian-troff (<package-version>)
epub_file_troff: obsidian-troff.epub
pdf_file_troff: obsidian-troff.pdf
epub_link_troff: obsidian-troff (<package-version>-<short-commit>).epub
pdf_link_troff: obsidian-troff (<package-version>-<short-commit>).pdf
```

MOBI conversion is optional and only runs when `ebook-convert` is installed.

## Metadata rules

The visible title stays clean:

```text
Obsidian on the Go
```

The Kindle/catalog title is versioned:

```text
obsidian-typst (<package-version>)
obsidian-troff (<package-version>)
```

Keep those surfaces separate:

- Cover, NCX, navigation title, and visible table of contents: `Obsidian on the Go`
- OPF `dc:title` and title-sort metadata: `obsidian-typst (<package-version>)` or `obsidian-troff (<package-version>)`
- Stable artifact names: `obsidian-typst.{epub,pdf}` and `obsidian-troff.{epub,pdf}`
- Versioned delivery links: `obsidian-typst (<package-version>-<short-commit>).{epub,pdf}` and `obsidian-troff (<package-version>-<short-commit>).{epub,pdf}`

The version comes from root `package.json`.

## Mermaid diagrams

Diagrams are source-controlled as `.mmd` files and rendered to PNGs committed
next to them. The manuscript references the PNGs so GitHub, EPUB, PDF, and blog
extracts all see stable images.

Render all diagrams:

```sh
docs/book/render-diagrams.sh
```

The render script uses `mmdc`, `docs/book/puppeteer-config.json`, and the local
`node_modules/.bin` first. On Termux, Chromium must run with `--single-process`;
that is already in the Puppeteer config.

## Build

From the repository root:

```sh
docs/book/build.sh
```

The build script:

1. Reads the plugin version from `package.json`.
2. Reads `title_stem` from `docs/book/metadata.yaml`.
3. Renders Mermaid `.mmd` files to PNG.
4. Writes `docs/book/dist/VERSION.md`.
5. Builds `docs/book/dist/obsidian-typst.pdf` from the Typst cover and Pandoc's Typst PDF engine.
6. Builds `docs/book/dist/obsidian-typst.epub` with the `obsidian-typst` Kindle-facing metadata.
7. Builds `docs/book/dist/obsidian-troff.pdf` from the roff/ms cover and Pandoc-generated roff/ms body.
8. Builds `docs/book/dist/obsidian-troff.epub` with the `obsidian-troff` Kindle-facing metadata.
9. Repairs EPUB cover/nav ordering and Kindle-facing metadata for both EPUBs.
10. Creates versioned EPUB/PDF symlinks for both suffixes from `VERSION.md`.
11. Validates EPUB metadata and layout for both EPUBs.
12. Builds `obsidian-typst.mobi` and `obsidian-troff.mobi` only if `ebook-convert` exists.

## Required validation

After a build:

```sh
expected_typst_title=$(awk -F': ' '/^kindle_name_typst:/ { print $2 }' docs/book/dist/VERSION.md)
expected_troff_title=$(awk -F': ' '/^kindle_name_troff:/ { print $2 }' docs/book/dist/VERSION.md)
docs/book/check_epub_metadata.sh docs/book/dist/obsidian-typst.epub "$expected_typst_title"
docs/book/check_epub_metadata.sh docs/book/dist/obsidian-troff.epub "$expected_troff_title"
git diff --check
```

For PDF page numbering:

```sh
pdftotext -f 1 -l 1 docs/book/dist/obsidian-typst.pdf -
pdftotext -f 2 -l 2 docs/book/dist/obsidian-typst.pdf -
pdftotext -f 1 -l 1 docs/book/dist/obsidian-troff.pdf -
pdftotext -f 2 -l 2 docs/book/dist/obsidian-troff.pdf -
```

Expected:

- Page 1 extracts cover text and no standalone page number.
- Page 2 contains the table of contents/body and starts body numbering.

## Blog diagrams

When turning a book section into a blog post, keep the same convention:

- write diagram source as `diagrams/<name>.mmd`;
- render and commit `diagrams/<name>.png`;
- reference the PNG from Markdown.

Do not rely on raw Mermaid blocks for Ghost/mobile delivery; materialized PNGs
are the portable format.
