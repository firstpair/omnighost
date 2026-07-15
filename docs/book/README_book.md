# Omnighost Book Source

This directory contains the manuscript, metadata, illustrated cover and
headboard under `assets/`, the accessible interior title page in `cover.md`,
diagrams, screenshots, and source-specific hooks for *Omnighost for First Pair
Press*.

Build from the repository root:

```sh
docs/book/build.sh
```

The shared FirstPair toolchain produces the primary Typst PDF, a secondary
source-built Neatroff PDF, one renderer-neutral EPUB/MOBI package, single-file
HTML, chapter HTML, and the version manifest under `docs/book/dist/`. See
`PUBLISH.md` for the artifact and validation contract.
