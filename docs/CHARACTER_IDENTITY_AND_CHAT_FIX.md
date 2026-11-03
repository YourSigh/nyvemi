# Character identity and chat repair — 0.14.5

## Image identity

The previous candidate prompt started with “Create one original character” and appended “Design variation” independently to each image. Those instructions conflicted with a request for an existing character. A rig-friendly symmetrical design could also erase an intentionally asymmetric hairstyle. The new prompt keeps the original user description, explicitly preserves a named subject's identity and recognisable design, treats Q/Chibi as proportions rather than a new character, and limits candidate differences to small expression/line/shading changes. Rig simplification must not change identity or impose symmetry/crowns/accessories.

An optional `visual_identity_planning` call extracts a short structured brief through the configured chat provider. It is capped at 600 output tokens/eight seconds, saved with the visual draft before generation, and reused when resuming. Missing/unavailable chat configuration falls back to the literal image request, so a separate Seedream setup still works.

Importantly, text-model confidence is not source evidence. The first real planning probe confidently added unverified hair details. The implementation now permits only feature strings that occur in the user's original description; a named subject must match the user's text too. This validation removes confident inventions. It does not pretend to verify canonical artwork. Uploaded references remain primary, especially for precise hair/accessory design. No Nahida/Tongza-specific feature list is hardcoded in product logic.

New drafts use a versioned prompt cache. Existing drafts retain legacy cache keys so received paid responses/downloads can resume without a new POST. The explicit “换一批候选图（重新付费）” action creates a persistent batch ID after an in-app confirmation. Retrying that batch reuses its ID/results. An unfinished batch cannot be bypassed by repeatedly requesting regeneration. Errors reload the latest draft for normal continuation. Previously saved descriptions also prefill later appearance edits; the saved character is replaced only when saving the new look.

The old three images are deliberately not regenerated on upgrade. To evaluate a new generation for the same description, use the explicit new-batch action; it consumes the user's Seedream quota. This round did not issue an Ark/Seedream generation or decomposition request, so no claim is made that the new paid images have visually passed. Named-character fidelity still depends on the image model and reference quality.

## Chat failure

`DSH turn did not complete` discarded the upstream turn reason. The screenshot alone therefore does not identify an HTTP/configuration/runtime/step-limit cause. This round found and repaired a concrete RN compatibility gap: its abort-controller polyfill loses `abort(reason)`, while the upstream DSH turn closer reads `signal.reason.kind`. The mobile compatibility layer now retains the first abort reason and supplies an AbortError for a reasonless cancellation.

The DSH wrapper preserves the structured turn reason and last host-model failure. User-facing errors distinguish authentication, credit/rate limits, invalid model/request, unavailable service, timeout, output/step limits and runtime compatibility. Developer diagnostics retain a bounded technical detail after credential redaction. Raw DSH internals and credentials are not displayed in chat. Failed messages remain retryable under the same user-message ID; a retry does not duplicate that message. This does not claim the reporter's exact device session or API configuration was reproduced.

## Validation

- `tests/dsh-mobile.test.ts` runs the bundled official DSH in a separate VM without Node globals, native AbortSignal helpers, TextEncoder or Promise.withResolvers, using RN's actual AbortController. It covers change-theme → wait, HTTP failure classification, step budget and canceled-turn closure. It is a mobile profile, not actual Hermes execution on a phone.
- Agent integration covers authentication failure → redacted diagnostic → retry of the same user message → successful bubble.
- Appearance tests cover identity constraints shared by three candidates, brief persistence/reuse, explicit new batches, unfinished-batch protection, legacy received-response cache reuse, optional-plan failure and filtering invented canonical features.
- Real DeepSeek acceptance used six calls for an initial identity brief plus the embedded DSH round “换成淡绿色主题”, then a resumed round “17乘23是多少”. The theme became mint and visible test messages were “换好啦，淡绿色，看着挺清爽的🌿” and “391”. Artifact: `artifacts/live-appearance-chat.json`.
- After grounding validation was added, one further real planning request returned the named subject and only original-input features (“原本发型”, “绿眼睛”, “白绿服装”). Artifact: `artifacts/live-appearance-identity-verified.json`. Total seven DS requests in this task; no paid image calls and no phone/emulator test.

The real chat probe used injected local tool effects rather than native screenshot animation/notifications. It verifies model/tool protocol and session continuation separately from device rendering.

## Build and commits

- Chat/runtime phase: `89ef34e`; lint/typecheck, full regression and Android Debug checks passed before commit.
- Final checks: lint, typecheck, 298 offline tests (11 optional live tests skipped), Expo/Hermes compilation, 2 Kotlin JVM tests, Android Debug and Release builds pass. Seven real DS calls used 12,662 input tokens and 389 output tokens in total.
- Standalone ARM64 preview: `artifacts/Nyvemi-0.14.5-arm64-preview.apk`, versionCode 29, 40,997,561 bytes. Existing preview signer retained; signature, embedded-JS and known-development-credential scans pass.

SHA-256: `7b65fd7acc24e1eabbc2ff12c487e5927b8fd068578d7faf7700e554d5725651`.
