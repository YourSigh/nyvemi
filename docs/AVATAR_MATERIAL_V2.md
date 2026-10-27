# Animation-ready material — 0.10.0

## Root causes

The first coarse decomposition only represented visible pieces. An ornament was cut out as a rectangle without any scalp behind it. Ponytail/crown edges originally met without overlap. Rotating detached sleeve crops exposed holes in the jacket and two versions of the same sleeve. Alpha was also resampled as straight RGBA, allowing transparent white to contaminate dark outlines. Increasing head/arm angles made these asset defects much more obvious. Changing renderer alone cannot recover missing pixels.

## Retained renderer

The existing renderer is already real **WASM parameter evaluation + WebGL indexed meshes**, with UVs, deformers, opacity/masks and physical outputs. It never routes mesh avatars through the legacy full-picture Animated wrapper. PixiJS was reviewed: its [Mesh](https://pixijs.com/8.x/guides/components/scene-objects/mesh) provides geometry/UV/shader control and [Container](https://pixijs.com/8.x/guides/components/scene-objects/container) provides scene hierarchy. Replacing the current player with it would duplicate geometry/physics integration without repairing artwork; no second renderer dependency was added. The p2lrt runtime remains the existing MIT distribution, with the local compiler outside the APK.

## Material and hidden areas

One new front-facing Tongza portrait was generated using the configured Seedream 5.0 Pro endpoint and the user's reference for identity. It retains the silver/pink twin tails, purple eyes, pink/white/black palette and bucket ornament. It has broad hair masses, fewer flyaways and hands separated from the body. Some original outfit ribbons remain; the design is simpler, not fully decoration-free.

A second request produced ten aligned transparent parts: body, neck, head, front hair, two back-hair masses, two sleeves/hands, eyes and mouth. The head has reconstructed blank forehead/face and the neck is independent. Inspection rejected using the raw result directly: roots were too short, and the body still included sleeves despite the requested separation. The pipeline handles those defects explicitly:

- A conservative palette-based scalp cap extends the head underneath opaque crown pixels, preserving the original visible face. This is local underpainting, not an assertion that Seedream reconstructed every hidden pixel perfectly.
- Short hair-root bridges use the hair's own interior palette, limited to the root zone and extending toward the crown. This avoids moving a rectangular crop containing unrelated hair.
- At joins, an additional **31 source-pixel margin** for this 2048px sample grows opaque content only below named opaque occluders. The generic radius is 5% of head width. Visible external silhouettes are not globally dilated. Eyes/mouth retain their feature alpha; all assets use alpha-correct resampling.
- Neck goes behind the chin and collar. Back hair goes behind the face/crown. The bucket remains attached to the crown instead of having a false accessory cutout.
- Original sleeves/hands are placed behind the complete garment and welded into one rest-pose clothing mesh for this small-motion profile. This prevents duplicated sleeve patches and shoulder seams. Separate source sleeve assets are retained in the cached build for later arm calibration; this revision does not claim independent hand articulation.
- Joint overlap is measured and disconnected inputs fail preparation rather than quietly compiling.
- Premultiplied-color interpolation removes transparent-white matte leakage when textures are resized.

The resulting model has **16 meshes / 27 parameters**, head/gaze/eyelid/mouth/body/breath controls and separate low-amplitude ponytail/outfit physics. Face and hair are deformed by model parameters; they are not CSS rectangles being rotated as a substitute for a rig.

## Gentle motion

Idle uses about ±1.1 yaw / ±0.35 roll. Thinking uses approximately -1.8 yaw / -0.6 roll. Default head targets are bounded to ±3 yaw, ±2 pitch and ±1.2 roll, including local reactions; touch gaze uses a small head range. Body sway stays below 0.5. Ponytail/clothing swing magnitudes are reduced. Blink uses a 200ms continuous closure/opening envelope; speech mouth opening is smaller and smoothed. Runtime breathing remains active.

Large eating/wave/stretch actions are kept in the driver behind `motionProfile: 'interactive'` for development, but are not shown in the default gentle profile. Idle no longer triggers stretches. Tap responses, dragging and recentering remain. Thinking/talking still preempt actions; background processing pauses, and reduced motion suppresses sway. The UI layout/keyboard avoidance is unchanged.

## Reproduce and caching

Normal tests use local fixtures/WASM and do not call a provider. Live artwork requires the existing explicit `.env` opt-in and key. This batch made **two requests total** (one portrait, one decomposition), with no automatic paid retry. The provider returned 12 output images including base images; this is not a currency-cost claim. Cache receipts are written before downloads; uncertain requests are not silently retried. No credentials or signed URLs are included in the APK or material report.

```bash
NYVEMI_AVATAR_WORK=artifacts/my-v2 NYVEMI_AVATAR_REQUEST_LIMIT=2 node scripts/vtuber/artwork.cjs source identity.txt reference.png
NYVEMI_AVATAR_WORK=artifacts/my-v2 NYVEMI_AVATAR_REQUEST_LIMIT=2 node scripts/vtuber/artwork.cjs split-complete artifacts/my-v2/portrait.png
npm run avatar:rig -- artifacts/my-v2/layers.json artifacts/my-v2-build avatar
```

The compile fingerprint includes occlusion code as well as source pixels, preparation, PSD export and physics code. Existing characters upgrade only if their local model bytes exactly match the previously bundled 0.8/0.9/0.9.1 sample; personality/history/memory are retained. Custom models are untouched.

## Verification

- 165 normal tests, three paid tests skipped; lint/typecheck and Android Debug build pass at stable phases.
- New fixtures cover alpha-matte edges, under-occluder-only bleed, scalp underpaint preserving the visible face, continuous outfit composition and incomplete-source rejection.
- Default pose bounds and smooth blink trajectories are tested. Legacy manual actions are still tested explicitly in the interactive profile.
- Actual WASM renderer tests cover nine yaw/roll combinations with breath/body/mouth changes. At five reconstructed joints, 3×3 probe windows remain opaque (405 alpha probes). These are regression samples, not proof that every pixel in every imported model is artifact-free. Model digest binds the probes to the actual bundled asset.
- Actual non-affine face deformation, independent gaze, physical response and bundle migration tests still pass.
- Eight-second real-runtime scene preview: `artifacts/avatar-v2-final/gentle-motion.mp4`; sampled idle/thinking/talking/happy/shy/sleepy frames are in the same folder. `assets/avatar/tongza-material.json` records the model digest, overlap report and regression probes.
- No physical-device or emulator self-test, per user preference. Subjective visual quality on the user's Android device remains installation acceptance.

Current limitations: automatic hidden-art reconstruction is partly generative and partly conservative local underpainting; hair/eye separation remains tailored to frontal colored-eye anime styles. Large turns, articulated fingers and independent outfit layers still need more careful authoring. This is a small-motion auto-rig rather than a professionally authored full-motion Cubism model.

## Release

`artifacts/Nyvemi-0.10.0-arm64-preview.apk`: app.nyvemi.android, versionCode 15, arm64, 40,156,621 bytes. SHA-256: `a6b3fe3b6139f3e92c5825e9decc07d2f08f8856568582cb6846babcc61ab408`. Android Debug and standalone Release builds succeeded; APK credential scan passed. Preview certificate matches 0.9.1. No push.

Commits: `ec51dc1` (pipeline/driver), `f9c1f0f` (actual model and opacity probes). Release/docs are committed separately.
