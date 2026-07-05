# Design: publishing large photos to a Vercel-hosted Ghost API

Status: **design** — written 2026-07-04 against fromcafe cleanup phase 4a
(`f02e15d`) and the in-progress Cloudflare upload proxy (`fromcafe/proxy/`,
untracked at time of writing). The fromcafe upload path is being actively
reworked by another session; nothing here modifies fromcafe, and the
fromcafe-side items below are inputs to that session, not commitments.

## Problem

Vercel rejects request bodies over ~4.5 MB **at the edge, before application
code runs**. For a Ghost Admin API implemented on Vercel (fromcafe is the
known instance), `POST /ghost/api/admin/images/upload` therefore hard-caps at
4.5 MB — historically a *silent* drop, now an explicit 413 after the cleanup.
Photos straight off a phone camera routinely exceed this.

Ulysses is closed source, so its uploads can only be fixed server/infra-side
(that is the proxy's reason to exist). Omnighost is our code, so it can also
speak a smarter protocol directly.

## The two rails

### Rail 1 — the upload proxy (client-agnostic; being built now)

How it works (from `proxy/src/index.ts`):

1. fromcafe's edge middleware inspects `Content-Length` on
   `/ghost/api/admin/images/upload`. Middleware runs before the body-size
   limit applies, so it can act on oversized requests: it **307-redirects**
   them to the Cloudflare Worker.
2. The Worker (100 MB request ceiling on the free plan) re-validates the
   Ghost Admin JWT by calling `POST {APP_ORIGIN}/api/ghost/proxy-auth`
   (it holds no key material), streams the multipart file into Vercel Blob
   using fromcafe's exact naming scheme (`ghost-upload_<name>_<sha256-16>`),
   and returns the Ghost-shaped `{ images: [{ url, ref }] }`.

Ulysses follows the 307 natively — that is the whole trick.

**Omnighost on rail 1.** Obsidian's `requestUrl` *should* follow a 307 with
body replay (Electron `net` on desktop, `URLSession` on iOS both do), in
which case Omnighost works the day the proxy ships, with **zero plugin
changes**. This must be verified on both platforms; if either transport
refuses to replay the body, the fallback is ~15 lines in
`GhostAPIClient.uploadImage`: don't auto-follow, catch the 307, read
`Location`, and re-POST the same multipart body there. Same JWT, same
response shape, no new protocol.

### Rail 2 — Vercel Blob client upload (Omnighost-native; the "chunking mechanism")

Vercel's sanctioned bypass: the client uploads **directly to Blob storage**
(`blob.vercel-storage.com`), which is not behind the 4.5 MB function limit;
only a small token mint request touches a Vercel function. Large files go up
in chunks via Blob's multipart protocol. This is the `@vercel/blob/client`
flow, and it needs both ends instrumented — possible here because both ends
are ours.

Sequence:

1. **Capability discovery** (once per blog, cached): Omnighost reads
   `GET /ghost/api/admin/site/`. fromcafe advertises
   `site.fromcafe_capabilities: ["blob-client-upload-v1"]`. Real Ghost lacks
   the key → Omnighost never attempts rail 2 against real Ghost.
2. **Token mint**: `POST /ghost/api/admin/images/upload-token/` (new route,
   normal Ghost JWT auth) with `{filename, content_type, size_bytes,
   sha256}`. Server enforces the MIME allowlist, a hard ceiling (suggest
   100 MB to match the proxy), and returns a scoped client token for
   pathname `ghost-upload_<name>_<sha256-16>` — the same convention as the
   direct route and the Worker, so dedupe and naming stay uniform. Built on
   `@vercel/blob`'s `generateClientTokenFromReadWriteToken`; the token is
   single-pathname, short-lived, and grants no reads or deletes.
3. **Direct upload**: Omnighost PUTs the bytes to Blob with that token —
   single request up to ~50 MB, Blob multipart (create part … complete,
   ~8 MB parts) above that. All via `requestUrl`; no bundled dependency —
   the Blob client protocol is three small REST calls.
4. **Register + respond**: on completion Omnighost calls
   `POST /ghost/api/admin/images/register/` `{pathname, sha256, ref}` and
   the server answers with the standard Ghost `{ images: [{ url, ref }] }`
   after recording the image exactly as the direct route would. (Vercel's
   `onUploadCompleted` webhook is unreliable on localhost and adds a
   callback dependency; an explicit register call keeps the client in
   control and the server stateless.)

Omnighost-side shape (`src/ghost/api-client.ts` + `image-uploader.ts`):

- `uploadImage()` keeps today's path for files < 4 MB.
- ≥ 4 MB **and** capability advertised → rail 2.
- ≥ 4 MB, no capability → attempt direct upload anyway (the proxy's 307 may
  save it); on 413, surface the existing clear error.
- The content-hash → URL cache is unchanged — it keys on bytes and stores
  the final URL, whichever rail produced it.

## Choosing between the rails

| | Rail 1 (proxy 307) | Rail 2 (Blob client upload) |
|---|---|---|
| Plugin changes | none (or tiny 307 handler) | new token/upload/register path |
| Server changes | middleware + Worker (underway) | two small routes + capability advert |
| Extra infra at publish time | Cloudflare Worker hop | none |
| Size ceiling | 100 MB (Worker plan) | Blob limits (~TB with multipart) |
| Works for Ulysses | **yes** | no |
| Works against real Ghost | n/a (real Ghost has no limit problem) | auto-disabled via discovery |

Recommendation: **ship rail 1 first** — it is nearly done, fixes every
client at once, and Omnighost likely needs nothing. **Add rail 2 after the
fromcafe cleanup settles**, as the native path that removes the Worker hop
and the 100 MB ceiling for the one client we fully control. They are not
exclusive; discovery makes Omnighost prefer rail 2 when advertised and fall
back to rail 1 (or a clean 413) otherwise.

## Work items

**Omnighost (this repo)**
1. Verify `requestUrl` 307-with-body behavior on desktop and iOS against the
   deployed proxy; add the explicit 307 re-POST to `uploadImage` if needed.
2. Rail 2 client: capability probe (cache per blog), `uploadImageLarge()`
   (token → PUT/multipart → register), routing by size+capability. iOS
   memory care: slice the `ArrayBuffer` per part, never duplicate the whole
   file.

**fromcafe (the other session — after its cleanup lands)**
3. Capability advert in `/ghost/api/admin/site/`.
4. `images/upload-token` route (JWT-authed token mint, pathname pinned to
   the shared naming convention).
5. `images/register` route (record + Ghost-shaped response; reject if the
   blob at `pathname` is missing or its hash mismatches).

**Proxy (the other session — already underway)**
6. Nothing extra for Omnighost. One request: keep the Ghost-shaped error
   bodies, so Omnighost's existing error surfacing works unmodified.

## Test plan

- 3 MB photo → direct route (both rails idle) — regression guard.
- 8 MB photo → rail 1: desktop + iOS, verify one Blob object, correct URL
  in the post, cache hit on re-sync.
- Same 8 MB photo → rail 2 (once live): verify identical pathname (dedupe
  across rails), draft → publish flow, and that real Ghost blogs never see
  a token-mint attempt.
- 60 MB photo → rail 2 multipart; kill the app mid-upload and re-sync:
  no orphaned post-side state (an orphaned partial blob is acceptable and
  garbage-collectable by pathname convention).
