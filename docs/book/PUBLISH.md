# Omnighost Book Build

`book.build.json` is the canonical configuration for *Omnighost for First Pair
Press*. The repository wrapper delegates to FirstPair's pinned toolchain:

```sh
docs/book/build.sh
```

The source-owned preparation hooks render committed Mermaid diagrams when they
are stale and assemble `docs/book/build/firstpair/omnighost.tr` from the ms
cover plus Pandoc's ms body. The shared builder then creates:

- `docs/book/dist/omnighost.pdf` with Pandoc and Typst;
- `docs/book/dist/omnighost-troff.pdf` with source-pinned Neatroff and utmac;
- renderer-neutral `omnighost.epub`, `omnighost.mobi`, `omnighost.html`, and
  `omnighost-chapters/`;
- stable and hash-stamped aliases plus a machine-readable `VERSION.md`.

The EPUB repair hook keeps the custom cover first in the spine, removes the
empty generated title page, and sets the Kindle-facing title to
`omnighost (<package-version>)`. The source validator checks that layout and
metadata after the shared build.

The plugin version comes from root `package.json`. Builds do not publish,
deploy, upload, or copy artifacts to iCloud.
