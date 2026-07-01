# Book Build Notes

This directory contains the recovered source for **Obsidian on the Go**.

The source was reconstructed from `docs/book/dist/obsidian-0.1.0-a9ae50.epub`
with Pandoc, then updated for current Omnighost features.

## Prerequisites

`docs/book/build.sh` needs:

- `pandoc`
- `typst`
- `groff` with the PDF output device
- `pdfunite` and `pdftotext` from Poppler
- `zip`, `unzip`, and `perl`
- Mermaid CLI `mmdc`
- Chromium/headless shell for Mermaid rendering

On this Termux machine, `mmdc` renders through
`/data/data/com.termux/files/usr/bin/headless_shell` using
`docs/book/puppeteer-config.json`.

## Source files

- `omnighost.md` — manuscript
- `cover.md` — Typst, roff/ms, and HTML cover blocks
- `metadata.yaml` — Pandoc metadata
- `diagrams/*.mmd` — editable Mermaid sources
- `diagrams/*.png` — rendered diagrams referenced by the book
- `media/*.png` — screenshots extracted from the EPUB

## Diagrams

Edit a diagram in its `.mmd` file, then run:

```sh
docs/book/render-diagrams.sh
```

Commit both the `.mmd` and `.png`. The book references PNGs so the same image
works in EPUB, PDF, GitHub, Ghost, and mobile readers.

## Build

From the repository root:

```sh
docs/book/build.sh
```

Outputs go to `docs/book/dist/`:

- `obsidian-typst.epub`
- `obsidian-typst.pdf`
- `obsidian-troff.epub`
- `obsidian-troff.pdf`
- `VERSION.md`
- versioned symlinks for EPUB/PDF
- optional `obsidian-typst.mobi` and `obsidian-troff.mobi` when `ebook-convert` is installed

See `docs/book/PUBLISH.md` for the full release contract and validation steps.
