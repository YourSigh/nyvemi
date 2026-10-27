# Avatar seam repair — 0.9.1

The user's screenshot showed the exact rectangular cut made by the coarse hair partition. The previous accessory layer contained surrounding hair as well as the ornament, and the scalp underneath was absent. Independent deformation exposed the rectangle. The front/ponytail partition also had zero overlap, exposing straight gaps when the parts moved differently.

## Changes

- Keep the ornament and crown on one continuous mesh. A coarse six-part source cannot reliably recover the hidden scalp, so no rectangular accessory layer is fabricated. The bucket follows head parameters; its separate pendulum is intentionally removed.
- Overlap ponytail roots with crown artwork and use smooth alpha transitions instead of adjacent hard cuts. Shared source pixels cover the join while the existing independent ponytail physics runs.
- Recompile the cached source locally using the same PSD2Live skeleton/mesh/deformer pipeline. The sample has 17 meshes, 33 parameters, independent arms and ponytail/outfit physics. Feeding, tapping, dragging and the one-third keyboard-responsive layout remain available.
- Upgrade exact known built-in 0.8 and 0.9 model bytes on startup, preserving identity, chat and memory. Custom imported models are retained.

## Verification

- Source regression fixture checks that the coarse pipeline does not cut out a rectangular headwear layer, all opaque hair source pixels retain at least 98% composed coverage, and adjacent parts share actual overlap.
- Actual WASM geometry, gaze and physics tests remain passing.
- Same-pose before/after renders: `artifacts/seam-before.png`, `artifacts/seam-after.png`. Stronger yaw/pitch/roll inspection: `artifacts/seam-feather.png`.
- Eight-second idle/thinking/talking/happy/shy/sleepy sequence using the actual runtime/driver: `artifacts/avatar-seam-final/seam-fixed-motion.mp4`; sampled frames in that directory.
- Lint, typecheck, 158 tests and Android Debug build passed before commit `8bd0272`; three paid tests skipped. No paid API calls or physical-device self-test.

Overlap is a practical repair for this frontal chibi source, not a claim that arbitrary artwork has professional hidden-layer reconstruction. Extremely large angles and arbitrary imported rigs still need artwork-specific inspection.

## Release

`artifacts/Nyvemi-0.9.1-arm64-preview.apk`, app.nyvemi.android, versionCode 14, arm64, 48,424,385 bytes. SHA-256: `aa53e4a12f63cb2184096c25cc149ef8550cf5c1fc3b5194d06fa57346d97cd1`. Android Debug and standalone Release builds succeeded. Actual local credential scan of APK JS/DEX/text/model/runtime entries passed. Preview signing certificate matches 0.9.0. No push.
