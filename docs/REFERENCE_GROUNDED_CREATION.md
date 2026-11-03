# Reference-grounded character creation — 0.16.0

## Behavior

The former path passed a name plus rig-oriented instructions to three independent image requests. More identity instructions could not supply an actual visual reference. The new optional `AppearanceDirector` is injected into the production Seedream provider; offline tests continue to inject Mock providers.

1. The configured chat provider (DeepSeek Flash by default) extracts a typed identity brief and up to two search phrases. Names and explicit requirements must be grounded in the user's original words. It cannot invent URLs or canonical features.
2. Named characters search public web pages and public image-result metadata. Image locations must exist in the fetched material. A dedicated subject/illustration image query runs even when official homepages yield several generic logos. Source contributions are limited so repeated homepage art cannot crowd out relevant pictures.
3. Up to three downloaded references are checked with actual multimodal input. Features come from visible images. Uncertain results remain visibly uncertain. Community sources are labeled with their actual source and are not claimed to be authenticated official artwork.
4. The app displays the subject, reference pictures and source links. The user selects and confirms a reference. This stage can run without a drawing Key and issues no Seedream generation request. Original characters also get a planning checkpoint. User-uploaded pictures take priority, including alternate outfits or deliberate recolors.
5. Seedream receives the confirmed picture as `image`, plus a concise instruction and visible feature observations. Candidate results are persisted before any fallible vision review. A candidate that passes can also serve as a shared visual anchor for subsequent images; later requests receive both references.
6. DS compares candidate images with the reference and user requirements. `match`, `uncertain`, `mismatch` and missing review states are distinct. Only `match` can proceed to paid decomposition. Images that fail are retained for inspection; there are no automatic extra generations.

The phone still plays the existing character Runtime. This feature does not add mobile rig compilation or claim that the raster decomposition is a complete mesh compiler.

## Recovery and cost

- New drafts use prompt version 3. Existing draft versions and paid request/download keys remain intact.
- Reference research, confirmation ID, candidate images and per-image reviews are stored with the local draft. Referenced files are pinned by visual cleanup.
- A failed DS review cannot erase the paid image. Continuing completes missing images/reviews; rechecking an already complete batch issues no Seedream POST and does not require an image Key.
- A successful review is not repeatedly invoked by an ordinary retry. An explicit recheck is a separate user action.
- Changing a confirmed reference after a batch starts is blocked. Explicit new batches keep the same confirmed research when the input is unchanged, then show the planning/confirmation step again.
- An uncertain paid POST still requires reconciliation, preserving the previous no-automatic-double-charge behavior. Changing drafts does not erase receipts.
- Research failure is explicit: upload a reference or retry reference lookup. It never turns into unannounced name-only generation.
- DS calls have bounded output and time limits and are metered under identity planning, reference selection/review and candidate review purposes. Saving settings does not invoke a model.
- No login or accounts are used for reference retrieval. Keys and cookies are not sent to public sources. Downloads reject private/literal-IP destinations and uncontrolled redirects, bound byte counts and timeouts, and store image files locally. Page content and image text are data, not executable instructions.

## Tests and real evidence

Regression tests cover reference confirmation before billed image creation, original-character planning without an image Key, actual multimodal request serialization/usage, first approved-image anchoring, reference+anchor payloads and cache reuse, paid image retention across failed reviews, rejection before decomposition, reference-source discovery/URL validation, logo crowd-out, and UI recovery/recheck without a drawing Key. Existing legacy-cache and user-history tests are retained.

`node scripts/test-live.cjs --visual-research` explicitly enables a probe capped at four DS requests per invocation. It never calls an image-generation endpoint. Default `npm test` skips it. Local evidence is written beneath ignored `artifacts/`.

Real testing on 2026-11-03 used the request “q版的原神纳西妲，可爱一点”. The first probe exposed an insufficiently explicit JSON contract; later probes exposed homepage logos suppressing dedicated image results. Both were repaired and the latter has a regression test. Four invocations used 11 DS requests in total (1 + 3 + 3 + 4), including failures/fallback checks. No Seedream generation/decomposition was made during these probes.

The final four-request probe found and read three references from 米游社 / 52PK source pages, retained source links, and reached `awaiting_reference`. DS identified visible hairstyle/eyes/outfit features. A deliberately wrong Nyvemi letter icon was submitted as a candidate and classified `mismatch`. Artifact: `artifacts/live-visual-research.json`; inspected source image: `artifacts/nahida-reference.jpg`.

This validates the real search/multimodal transport and a clear negative example. It does **not** prove that an actual Seedream-generated Q character has passed visual acceptance. An additional single-image paid check was requested separately because the earlier image-test authorization had been exhausted. No extra paid image request is made without that authorization.

## Limits

Public search and source sites can redirect, block access, change HTML, or return unsuitable material. The user can always supply a picture. DS visual review can miss details or reject a good design; it is an aid rather than ground truth. The final source and generated picture still need human confirmation. The app does not promise exact reproduction of every named character. No canonical character appearance list is hardcoded.

No phone or emulator interaction was performed, as requested. Device-specific layout and the final generated look remain installation acceptance items.

API reference checked: [Seedream image API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh) — image and multi-image inputs are supported; the default Pro model does not provide built-in web search, so search is handled separately by the app.

## Delivery

- Lint and TypeScript: pass.
- Offline suite: 318 passed, 12 optional live tests skipped.
- Android Kotlin unit-test task, Debug and standalone Release: pass.
- Final real DS probe: pass (four calls, three retrieved/checked references, wrong-image rejection). Total DS calls across the four repair probes: eleven. No Ark generation or decomposition calls in this task at delivery time.
- APK: `artifacts/Nyvemi-0.16.0-arm64-preview.apk`, versionCode 31, 37,322,747 bytes. Original preview signing certificate retained. Embedded-JS, developer-asset/preset and local-credential checks pass.
- SHA256: `abb91b6cf45207a3b17addf77e0b9f7e86d7e70aadbe0e2e02735e82f0f0a730`.
