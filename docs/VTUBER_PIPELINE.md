# VTuber mesh pipeline — 0.8.0

This revision delivers a real **PSD2Live mesh/deformer/parameter/physics model** and an Android player. It does not turn a single PNG or a set of flat image Views. The reference character was generated from the user's Tongza image, simplified, split, locally prepared into a layered PSD, automatically rigged and inspected in the actual runtime.

## Boundaries

**The automatic compiler currently runs on the local development computer.** Android imports/plays its output offline and includes the verified Tongza sample. The desktop JVM compiler has not been ported into the phone. The image-generation screen labels unbound artwork as material; generating a picture there is not falsely presented as having generated a mesh model. Mobile-only one-click image → rig is unfinished, and requires a compiler port or a separately designed build service. No Nyvemi server has been added.

The real chain that ran:

```
user reference + description
→ 3 Seedream 5.0 Pro candidates
→ selected candidate 1
→ Seedream standard 6-part decomposition
→ local eye/iris/lash and hair-region preparation (14 source layers)
→ layered RGB8 PSD
→ pinned PSD2Live auto meshing / deformer / parameter generation
→ independent ponytail, outfit and accessory swing presets
→ .psd2live editable project + .p2lrt 2.0 + WebGL export
→ Nyvemi WebView (offline WASM + WebGL)
```

## Why PSD2Live / p2lrt

Upstream: [tsunehimatoi/psd2live](https://github.com/tsunehimatoi/psd2live), pinned revision `692986728e2b7b9254a41a22bdce1656bc0c12f9` (3.6.7).

The compiler actually ran from source with JDK 21. It generated the model and the compiler's public headless MCP operations added repeatable physics presets. No official Cubism proprietary binary is used. The GPLv3 desktop compiler remains outside the APK. The bundled p2lrt WASM runtime and web player are MIT, with provenance and license in `vendor/psd2live-runtime/`.

Sources: [layer specification](https://github.com/tsunehimatoi/psd2live/blob/master/docs/en/spec/PSD_LAYER_SPEC.md), [runtime](https://github.com/tsunehimatoi/psd2live/blob/master/docs/en/spec/RUNTIME.md), [format](https://github.com/tsunehimatoi/psd2live/blob/master/docs/en/spec/P2LRT_V2.md), [swing generation](https://github.com/tsunehimatoi/psd2live/blob/master/docs/en/guide/SWING.md).

## Verified model

| Property                             | Actual generated value |
| ------------------------------------ | ---------------------- |
| Source parts after local preparation | 14                     |
| ArtMeshes                            | 17                     |
| Mesh vertices                        | 6,980                  |
| Deformers                            | 24                     |
| Parameters                           | 26                     |
| Physics groups                       | 7                      |
| Compiler web export losses           | none reported          |

Parameters include:

- Head: `ParamAngleX`, `ParamAngleY`, `ParamAngleZ`.
- Eyelids: `ParamEyeLOpen`, `ParamEyeROpen`.
- Gaze: `ParamEyeBallX`, `ParamEyeBallY` (irises separate from eye whites/lashes).
- Mouth: `ParamMouthOpenY`, `ParamMouthForm`.
- Body: `ParamBodyAngleX/Y/Z`, lean/proportion; current chat motion drives Z gently.
- Breathing: `ParamBreath`.
- Hair: `ParamHairFront`, `ParamHairBack`, plus `ParamSwingPonyL_1/2` and `ParamSwingPonyR_1/2`.
- Accessory and outfit: `ParamSwingAccessory`, `ParamSwingClothes`.

The chat driver deliberately does **not** write hair/cloth physics output parameters. It sets head/body inputs; the runtime advances the pendulums. `idle → thinking → talking → emotion → idle` uses the existing character state bus. States have different gaze, eye openness, mouth form and head poses. Targets are smoothed; blink timing and talking mouth envelopes are procedural. There is no audio-amplitude lip sync, camera tracking, true 3D head model or official `.moc3` integration in this revision.

## Tongza simplification

Retained: silver-white hair fading into pink twin ponytails, purple eyes, pink/white/black palette, the unmistakable bucket-shaped ornament with a face, cute mischievous chibi proportions.

Removed/simplified: plush toy, bag, floating background decorations, many crossed ribbons and small charms; simplified jacket and skirt, larger hair masses, upright head, relaxed separate hands, neutral front pose. Candidate 1 was selected because its ornament still reads as a bucket; candidates 2/3 drifted toward a top-hat shape.

Seedream's fine 16-part decomposition was rejected twice by output moderation, with no parts returned. The tool stopped repeating that strategy. A standard, fully clothed 6-part decomposition succeeded. Local alpha/color analysis separated eyes and ponytails without further paid calls. The eye analysis infers dominant source color; it is not restricted to purple, with a green-eye regression fixture. This is a heuristic for approximately frontal colored-eye chibi art, not a universal segmentation model. Hair roots, left/right assignments, feature contours and large head angles require inspection for each new style. The initial full-outfit layer still includes legs, so its low-amplitude cloth swing is basic rather than a hand-tailored skirt simulation.

Source generation prompt asks for a full upright front view, both eyes open, relaxed hands away from torso, naturally separated legs, clear hair structure, reduced fine strands/attachments and plain background. The generated character is fully clothed. Prompt and reference are sent only to the configured official Ark endpoint; keys stay in `.env` for Node tools or Keystore for app calls.

This development batch made 7 API attempts: one unavailable 4.5 model ID, three successful candidate generations, two rejected fine decomposition requests, one successful standard decomposition. Successful responses reported 10 generated images total including the base. Currency cost must be checked in the provider console; no balance is fetched. Local preparation, compiler reruns, physics fitting, renderer tests and previews make no API calls.

## Reproduce with another character

From the repository root, install dependencies and fill the gitignored `.env` image fields. `NYVEMI_ARK_ENABLE_LIVE_TESTS=1` is mandatory for paid artwork calls. Use a separate `NYVEMI_AVATAR_WORK` directory per character/batch. The tool's conservative batch cap is seven attempts, including errors; it is not an automatic retry loop. Default Seedream model is the account-verified 5.0 Pro; the former 4.5 identifier returned a not-found error in this account.

```bash
npm run avatar:setup
NYVEMI_AVATAR_WORK=artifacts/my-character npm run avatar:candidates -- description.txt reference.png
# Inspect candidate-1.png / candidate-2.png / candidate-3.png and choose one.
NYVEMI_AVATAR_WORK=artifacts/my-character npm run avatar:split -- artifacts/my-character/candidate-1.png
npm run avatar:rig -- artifacts/my-character/layers.json artifacts/my-character-build avatar
```

Reference is optional in the candidates command. `avatar:setup` downloads the pinned open-source compiler into ignored artifacts. JDK 21 and Python 3 are needed; macOS tooling currently uses `lsof`/`ps` for owned-server cleanup, so the wrapper is not yet a portable Windows script. `PSD2LIVE_HOME` and `PSD2LIVE_JAVA_HOME` override compiler/JDK locations. The rig command is local only: preparation, PSD conversion, headless compiler, physics presets, editable project, runtime export and owned process cleanup. Its fingerprint includes source pixels and preparation code; an identical completed build is reused. A different build must use a new output directory to avoid overwriting edited projects.

The paid request receipt is persisted before downloading. Started/uncertain requests never silently repeat. Image downloads use origin fingerprints to avoid confusing new artwork with an old display filename. API keys are not cached. Output responses and signed image URLs are private, ignored build data.

Artifacts in a build folder:

- `<name>.psd` — prepared layered artwork.
- `<name>.psd2live` — editable generated rig and physics edits.
- `web-physics/<name>.p2lrt` — single-file embedded-texture runtime model.
- `web-physics/index.html` — compiler's standalone WebGL preview.
- `compile-receipt.json` — source/compiler fingerprint.

## Android integration and use

Settings → 角色形象 → **试试简化桶砸皮套**, wait for awakening and save. Existing persona, messages and memories remain intact. Or import another `.p2lrt`; no API request is needed. The sample is bundled for offline testing, not hardcoded into the generator or state driver.

`CharacterStage` routes mesh assets to `MeshAvatarStage`; it does not mount the old `useCharacterMotion`/whole-picture Animated wrapper for mesh characters. The renderer loads pinned runtime assets and the private model from disk, instantiates WASM and uploads actual vertex geometry to WebGL. A bounded, typed state message drives parameters; the model cannot inject HTML or JavaScript. CSP disables network access; file access is disabled. Background/offscreen updates pause. Reduced-motion mode suppresses idle sway. The wake preview/save waits for the runtime to report ready; a failed model is not treated as a finished character.

Character area is approximately **one third** of the usable phone screen; conversation gets the larger share. Keyboard avoidance still keeps both regions visible.

Bundle v4 embeds the `.p2lrt` asset and remaps its location on import; v1–v3 remain readable. Header, chunk ranges, decompressed size and referenced assets are bounded. Erasure/asset cleanup retains models owned by another character or live draft. Mesh files are capped at 48 MB. Old cutout assets remain backward compatible and are labelled as unbound material rather than mesh models.

## Validation

- Normal suite: 154 passing tests, 3 paid tests skipped; lint/typecheck and Android Debug build passed at each stable phase.
- Actual WASM model tests: required parameter families, separate ponytail meshes, non-uniform face edge-length changes under head yaw (not a whole-image rotation/scale), gaze moving irises without moving face geometry, physics responding over time.
- Portable model round-trip with the real embedded-texture file.
- Synthetic green-eye fixture → separated source parts → valid layered PSD.
- Real local toolchain → generated model; identical second build reports cached reuse.
- Actual WebGL UI: 26 parameters / 17 meshes ready, talking and sleepy visibly change. `artifacts/vtuber-validated/webgl-final.png` records the final model.
- Actual runtime state sequence: `artifacts/vtuber-validated/tongza-preview.mp4` (software renderer on the same model and driver).

No physical-device self-test was performed, as requested. Android WebView/GPU behavior, long-session battery use, extreme poses, subjective naturalness and final appearance still need user installation acceptance. This is an automatically generated first rig, not a professionally hand-refined VTuber model.

## Release artifact and commits

- `artifacts/Nyvemi-0.8.0-arm64-preview.apk`: package `app.nyvemi.android`, versionCode 12, arm64, 42,612,965 bytes.
- APK SHA-256: `e429cfc4acd7a0dabf580d931a9fd6b192d7fe9338b435eccb268c67dcb3f69b`.
- Android Debug and standalone Release builds succeeded. The preview signature verifies and matches the 0.7.0 certificate for an ordinary upgrade.
- APK JS/DEX/text/runtime/model entries were scanned against the actual local environment keys: no matches. No phone self-test was performed.
- Local compiler servers created for generation have been stopped. The separate read-only browser preview is a development deliverable, not an app backend.

Stable development commits:

| Commit    | Phase                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| `e882877` | Resize character region to one third and test keyboard layouts                                                       |
| `6636365` | Offline mesh runtime, typed state driver, preview/import/save and Bundle v4                                          |
| `ff5ebbf` | Seedream/local source preparation, layered PSD, automatic rig, independent physical groups and actual geometry tests |

The version, documentation and final artifact record are committed separately. No commits were pushed.
