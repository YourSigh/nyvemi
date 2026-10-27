# Actions and material generalization — 0.10.1

## What is available

The current gentle model supports nodding, shaking the head, winking one eye and smiling from the **⋯** menu, in addition to tap responses, bounded dragging and recentering. Thinking/talking preempt actions and all actions terminate. Menus are built from actual movable parameter ranges. A model missing the corresponding controls does not display a fake working action. Switching back to the gentle profile cancels an incompatible action.

The current Tongza garment is one continuous rest-pose mesh, so large feeding/waving/stretching actions are still not released in the gentle profile. Restoring those needs independently connected shoulder/elbow/hand rigging, hidden clothing coverage and prop attachment calibration. Declaring an arm parameter is not sufficient evidence that such an action is visually ready. The older interactive driver is retained for development.

## Bugs found and corrected

The supposedly generic local portrait prompt still explicitly requested silver/pink twin tails, purple eyes and a bucket. The decomposition also required two rear hair masses. Those identity choices now belong only to a character's description/reference. The mobile body-repair prompt also no longer insists on skirt/stocking elements.

Generic preparation now:

- Normalizes supported layer-name aliases/case instead of requiring one exact spelling.
- Requires head, neck, body, two-eye artwork and mouth. Front hair, a single rear-hair mass, separated rear masses and sleeve parts are optional according to the design. No rear hair is invented for short-haired/bald characters. Ambiguous single-plus-split rear hair fails clearly.
- Infers each separated root's direction from its position relative to the head, rather than assuming that the provider's left/right names refer to screen sides.
- Uses relative interior luminance to choose hair-root color, instead of assuming pale hair. Existing skin pixels remain the basis for scalp underpaint.
- Includes a grayscale/dark-eye fallback. Side-profile, closed-eye-only or unrecognizable artwork must be repaired; no stock Tongza image is silently substituted.
- Checks image-part limits, canvas/bounds, duplicate names and disconnected joints before compiling.
- Adds physics only for hair parts actually present.
- Before writing a completed compile receipt, checks required facial controls, finite geometry at small poses, nonempty software renders and actual face/iris/mouth geometry response to parameters. Results are written to `runtime-report.json`. These are structural/render checks, not an AI art-quality score.

## What was actually verified

No paid API requests were made in this iteration. Four deterministic, differently shaped/colorized **synthetic fixtures** went through the real preparation → layered PSD → PSD2Live compiler → WASM renderer:

| Fixture        | Shape/palette variation                                             | Meshes | Parameters |
| -------------- | ------------------------------------------------------------------- | -----: | ---------: |
| short-black    | short dark hair, black eyes, tan skin, merged outfit                |     14 |         23 |
| long-brown     | one long rear mass, brown hair, green eyes, separate source sleeves |     13 |         25 |
| dark-skin-blue | dark skin, dark split rear masses, blue eyes                        |     14 |         27 |
| bald-gray      | no hair layers, gray eyes, merged outfit                            |     12 |         23 |

All four produced finite visible frames and actual vertex changes for head, gaze and mouth. They do not contain Tongza's identity or bucket. Source fixtures are in `tests/fixtures/avatar-materials.cjs`; generated proof lives under ignored `artifacts/generic-build-<id>/` (`runtime-report.json`, editable project and `.p2lrt`). The ordinary test suite creates temporary fixtures without a network or compiler dependency.

```bash
node tests/fixtures/avatar-materials.cjs artifacts/generic-fixtures
npm run avatar:rig -- artifacts/generic-fixtures/long-brown/layers.json artifacts/my-generic-check avatar
node scripts/vtuber/verify-runtime.cjs artifacts/my-generic-check/web-physics/avatar.p2lrt artifacts/my-generic-check/runtime-report-recheck.json
node scripts/vtuber/preview.cjs assets/avatar/tongza.p2lrt artifacts/small-actions.mp4 actions
```

Normal validation: 172 passing tests, 3 paid tests skipped; lint/typecheck and Android Debug build pass. Real bundled Tongza action preview: `artifacts/actions-0.10.1/small-actions.mp4`, with sampled nod/shake/wink/smile frames. No phone/emulator self-test.

## Current boundary

The strongest real generated-art visual acceptance is still Tongza. These four fixtures show that the code no longer requires her specific palette or twin tails, but they do **not** prove that arbitrary Seedream outputs are attractive or correctly layered. More real generated short-haired/long-haired/male/different-skin characters need per-model visual acceptance before claiming broad production reliability. Image generation may still produce inconsistent layers; failing checks stops completion instead of making a universal-quality promise.

The supported production contract is approximately frontal, two-open-eye humanoid/anime art. Animal quadrupeds, strongly asymmetric/side-view/occluded designs, unusual eye layouts, and arbitrary 3D/photoreal input are not covered by the automatic preparation heuristics.

Rig compilation still runs on the local development computer. Android can generate/store image material and import/play `.p2lrt`; the mobile-only image-to-rig compiler is not implemented. No server has been added. This remains a material-processing and player pipeline with explicit acceptance boundaries, not a finished universal mobile auto-rigger.

## Release

`artifacts/Nyvemi-0.10.1-arm64-preview.apk`, app.nyvemi.android, versionCode 16, arm64, 40,157,013 bytes; SHA-256 `7c76e20e9e879a6f4746e30d9334466050188a7b1ecc184cb66f0bcda6c8d242`. Debug/standalone Release builds and actual-local-key scan of APK text/JS/DEX/model/runtime entries passed. Preview certificate matches 0.10.0. Implementation commit: `5e2839a`. No push.
