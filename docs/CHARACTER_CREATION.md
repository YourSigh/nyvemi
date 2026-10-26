# Character appearance creation (0.7.0)

## Entry points

New installations: existing color opening → BYOK chat provider → persona interview → persona generation → **appearance** → wake preview → Chat. `appearancePending` resumes unfinished first creation after restart. Characters created before 0.7.0 keep their existing animated stand-in and enter Chat normally.

Existing characters: Settings → 角色形象. Saving updates only the rig and pending flag; persona, memory, relationship, messages and avatar remain intact.

Three modes share one pipeline:

- Text: three independently cached candidate requests.
- Text + reference: same, with an app-private reference image.
- Animate reference: skip candidate generation and send the uploaded image to decomposition.

The upload picker supports PNG/JPEG/WebP; Seedream's decomposition service currently documents PNG/JPEG input. A WebP that is acceptable for reference generation may need conversion before real decomposition. The supplied Tongza PNG is retained only in ignored `artifacts/character-reference/`, not shipped or hardcoded.

## Mock and real providers

Mock is the default. It creates three deterministic original vector illustrations with independent body, hair, head, arm, eye and mouth layers. It exercises selection, rig building, awakening, persistence and transfer without a network request. It **does not decompose an uploaded photograph or illustration**: direct-reference mode clearly uses sample layered art to demonstrate motion.

Choose 生图设置 → 使用豆包付费接口 to enable Seedream explicitly. The image API key is independent of the chat key and stored in SecureStore, bound to the provider origin. It is never an `EXPO_PUBLIC_*` value and never enters SQLite, the bundle, Git or the APK. A new provider origin requires a matching key.

Default official Ark configuration:

```
Base URL: https://ark.cn-beijing.volces.com/api/v3
Candidates: doubao-seedream-4-5-251128
Decomposition: doubao-seedream-5-0-pro-260628
```

Account model activation is required, independently of creating an API key. An Endpoint ID may replace a model name. Never point an Ark key at an unknown proxy.

Sources: [Ark image generation API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh), [Seedream 5.0 Pro](https://docs.volcengine.com/docs/ark/seedream-5-0-pro?lang=zh). The documented layer response uses `data.name`, `data.description`, `data.z_index` and `data.bounding_box.normalized` with 0–1000 coordinates. Layers have alpha PNG output and positions relative to the output base canvas.

## Rig and rendering

The provider requests a neutral front-facing full-body illustration with both eyes open, separated arms, clear structure and a simple background. Decomposition requests independent facial features and completion beneath removed parts. The renderer omits the base/background, sorts layers by z, positions their bounds on a shared canvas and reuses the existing `useCharacterMotion` Runtime. It supports breathing, blinking, thinking, talking, happy and sleepy. The preview follows a deterministic closed-eye → open-eye → blink → breath/movement sequence before allowing save.

This is **2D cutout animation**, not Cubism `.moc3`, mesh deformation, 3D or a professional rig. Eye closure and mouth opening use layer transforms. Facial feature layers must actually be separate from the completed head; body, head, eyes and mouth are required. Missing required roles fail validation instead of presenting a flat image as a finished rig. Semantic names alone cannot prove the quality of inpainting: real output still needs visual acceptance. Complex poses, plush toys, a wink and decorative backgrounds are difficult inputs. No automatic multi-call repair loop is enabled: an unsuitable decomposition stops, preserving its paid response for inspection. Preview offers an explicit paid body-only repair; once completed for a selection, it is reused instead of repeatedly charging.

## Cache, interruption and cost

Cache identity includes operation/prompt version, endpoint/models, description, reference content hash and candidate index. It never includes a key. Successful candidates are saved individually. Identical successful operations reuse cached local images. Returned responses are persisted before downloading signed image URLs. Download failures can retry without issuing another generation POST, provided the provider URL remains valid. An expired download URL with no local copy requires manual recovery; the app does not silently pay again.

A POST interrupted before its response is persisted remains `started`/uncertain. It will not automatically repeat, even after restart. Resolve it against the provider's records before retrying under a new explicit operation. Provider responses with definitive client rejection can be retried after correcting settings. Startup releases abandoned local operation leases while preserving payment receipts. All image work runs in the app's single JS runtime, not in a separate background image worker.

Three candidates cost three requests. One decomposition can produce a base plus up to sixteen layers and may be billed as multiple generated images. App usage totals for text models do not currently price image calls; inspect the provider console for image charges. Raw successful usage metadata is preserved in the private request cache.

## Real smoke test

Edit `.env` (gitignored), based on `.env.example`:

```
NYVEMI_ARK_API_KEY=...
NYVEMI_ARK_ENABLE_LIVE_TESTS=1
NYVEMI_ARK_LIVE_MAX_REQUESTS=2
```

Then `npm run test:live:images`. Optional `NYVEMI_ARK_REFERENCE` selects a local PNG; the default is the supplied ignored Tongza reference. This Node-only test uses a durable SQLite cache and a persistent batch request counter in `artifacts/live-images/`. Re-running preserves the cap. Reset that counter only when intentionally authorizing another paid test batch. `npm run test:live:images -- --repair-body` explicitly adds one body-only repair allowance, capped at three requests for this approved batch; it must only be used with approval for that extra request. `npm test` skips paid tests, regardless of `.env` contents. Keys never enter build inputs; use `EXPO_NO_DOTENV=1` for builds.

On 2026-10-26, the first real decomposition request reached Ark but returned HTTP 404 / `ModelNotOpen` for `doubao-seedream-5-0-pro-260628`. No real layer output was produced. After the user activated it, the second request produced a base and six independent transparent parts. Composite review found an upper-torso gap; the user explicitly authorized one extra targeted body repair. That third request produced a base plus a replacement body. The final composite has the missing shirt filled and both eyes open. The two successful responses reported 9 generated images in total (including bases) and 148,824 output tokens; this is provider usage metadata, not a currency charge estimate. Further cached replays made no generation POST. Real three-candidate image generation was deliberately not called in this paid test batch.

## Transfer and erasure

A character with a rig exports Bundle v3: JSON plus deduplicated raster layer files. It carries neither request receipts nor image settings nor keys. v1/v2 bundles remain importable. New limits: 100 MB ZIP/uncompressed total, 12 MB JSON, 12 MB per layer, 5 MB avatar, 32 layers. The importer validates references, file names, asset signatures, role requirements and bounded vector content before writes. It remaps asset locations into private files and cleans newly written assets if the transaction fails. Older apps cannot read v3.

Reset still requires the exact current character name. Image generation/erasure leases prevent races. It removes the character's draft and prunes unused source/candidate/layer files and cache results, retaining files used by another character. Uncertain payment receipts remain to prevent accidental duplicate charging.

## Validation boundaries

Automated tests cover partial candidate recovery, content caching, paid download recovery, ambiguous request suppression, role/bounds checks, deterministic awakening, portable asset round-trip, missing-asset rejection, cleanup ownership and key origin binding. Android Debug and standalone arm64 Release builds are checked. No physical-device self-test is performed for this revision. The user must validate the installed UI and real generated-image quality after model activation.

## Reusing the verified reference without paying again

The real test exports `artifacts/reference-character.nyvemi-look`, an artwork-only ZIP containing the rig and six raster layers. Copy it to Android, open Settings → 角色形象 → 导入分层形象文件, preview awakening and save. First-run appearance setup has the same import button. This changes no persona, memories or conversation and does not need an image API key. It also works while the default provider remains Mock.

The generic `.nyvemi-look` reader/writer validates filenames, total sizes, references and roles, writes private files and removes new files on failure. It contains no character persona or request receipts. User artwork and API outputs remain ignored local artifacts rather than hardcoded app assets.

The final acceptance for this revision is lint/typecheck, 146 passing automated tests with 3 paid tests skipped in the normal suite, Android Debug/arm64 Release builds, successful real decomposition plus targeted repair, and cache-only paid-test replay. The character UI and motion feel still require the user's installation check.

## Release artifact

- APK: `artifacts/Nyvemi-0.7.0-arm64-preview.apk`, package `app.nyvemi.android`, versionCode 11, arm64, 35,913,573 bytes.
- SHA-256: `c4f6be451bd809130b5dffa38f3d728842c6956e34ada682471ff38b227117ed`.
- Release bundle build succeeded; v2 APK signature verifies. This is a preview using the existing debug certificate, not a store-production signing key. Its certificate matches the previous 0.6.0 preview, allowing an ordinary update.
- APK DEX/JS entries were checked against the actual local environment keys: no matches. Artwork exports contain only their rig manifest and image layers.
- Install, then use Settings → 角色形象 → 导入分层形象文件 and select `reference-character.nyvemi-look`; wait for awakening, save, and test talking/thinking states in Chat. No reset, new persona or model image call is required.

## Development commits

| Commit    | Stable phase                                                                      |
| --------- | --------------------------------------------------------------------------------- |
| `dba5dfa` | Provider contracts, default Mock, durable image requests and local assets         |
| `b968106` | Existing motion Runtime adapter and awakening timeline                            |
| `10e7876` | First-run appearance step, three modes and later appearance replacement           |
| `b415803` | Character Bundle v3, image cleanup, bounded real test harness                     |
| `93c666e` | Restart recovery and actionable model activation errors                           |
| `c2ed94c` | Secure image key bound to the provider origin                                     |
| `1ccaac8` | Real layer naming fix, body-only repair, artwork-only import and regression tests |

Every stable phase ran lint, typecheck, the normal test suite and Android Debug build before its commit. Final release packaging and this validation record are committed separately. Nothing was pushed.
