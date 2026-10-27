# Character interaction — 0.9.0

## Controls

- Tap head: relaxed eyes and a small head response; tap body: surprised response.
- Drag: bounded movement inside the stage with gaze/head following the gesture. Relative placement survives keyboard resizing; **归位** restores the center.
- Long press (550 ms) or **⋯**: action menu.
- **投喂**: eight-second quick eating sequence; tapping the bowl starts another serving.
- **招手**, **伸懒腰**, **停一下**: explicitly control motions.
- Idle: occasional look-around or stretch, not repeated eating.

These are local visual responses. Small reaction bubbles do not become chat messages or memories. No model calls or paid artwork requests were needed for this revision. Chat thinking/talking preempts an action. Offscreen/background activity cancels it; reduced-motion mode suppresses idle gestures and head/body sway.

## Rig and rendering

The cached Seedream arm layer is separated into left/right handwear. Matching arm pixels are removed from the outfit layer to prevent duplicate static arms. PSD2Live's local `skeleton_auto` creates the actual skeleton and skin bindings before physics export. The bundled model now has 18 meshes and 34 parameters, including `ParamArmLA/LB/RA/RB` and hand parameters. Driver actions set these parameters; the runtime evaluates mesh deformation and existing hair/clothing physics.

Rice bowl and chopsticks are original SVG props positioned from current transformed wrist/mouth mesh vertices every frame. They are separate visual props, not newly generated artwork or Cubism assets. Generic imported rigs need compatible arm parameters for arm actions; feeding props currently rely on the prepared HandwearL/R and MouthOpen naming convention and are hidden if those anchors are missing.

Only the exact SHA-256/length of the previously bundled 0.8 sample triggers automatic local replacement. Character identity, conversation and memory are preserved. Custom models are never replaced by name. Failure to upgrade is logged and does not prevent startup.

## Validation

Lint, TypeScript, 158 normal tests and Android Debug build pass; three paid tests remain skipped. Coverage includes action termination/preemption, parameter targets, gaze interaction, drag bounds/keyboard resizing, exact-model upgrade and custom model preservation, plus actual WASM geometry/physics and bundle round-trip tests.

The actual WebGL player was used in a desktop browser to verify taps, dragging, recentering and eating with moving arms and attached props. Snapshot: `artifacts/avatar-interaction-clean/feeding-webgl.png`. No phone or emulator self-test was performed. This is a procedural first rig; hand/finger articulation and arbitrary imported-mesh attachment fitting remain basic.

Implementation commit: `83a3285`. No push.

## Installable preview

- `artifacts/Nyvemi-0.9.0-arm64-preview.apk`: app.nyvemi.android, version 0.9.0, versionCode 13, arm64, 46,654,729 bytes.
- SHA-256: `3a87d15ed0a1f0b868f8d4fc96d823c6372adbf6be057b4b30505431ddb0ccc6`.
- Debug and standalone Release builds succeeded. APK signature verifies and matches the previous preview certificate; normal upgrade installation is supported.
- Actual local environment credentials were checked against APK JS/DEX/text/runtime/model entries with no matches.
- Logs: `artifacts/verify-0.9.0.log`, `artifacts/release-0.9.0.log`.
