# First-run color flow — 0.14.4

## Root cause

Welcome's “就这个感觉” only called `rememberOpening(description)` and navigated to Provider. It never called `ThemeProvider.apply`. Interpretation/reveal happened later on the Theme screen, after model setup. Thus pressing the first confirmation left the visible app in the default pink-white theme. Earlier component tests covered the settings editor and theme transaction, but not the Welcome → Provider path.

The new `tests/theme-onboarding.test.ts` reproduced that path before the patch: all five opening acceptance cases failed, with no selected theme persisted. Evidence is retained in `artifacts/theme-onboarding-before-fix.log`.

## Design and implementation

1. Clear color requests use local semantic parsing first. “淡蓝色，安静一点”, purple, mint, black/white/gray and other supported color families work immediately before BYOK configuration. No model or credential lookup is needed for this path.
2. A local theme generator produces the full palette, including readable text/button colors. The model returns semantic attributes rather than arbitrary HEX values. Existing contrast tests still cover every supported combination.
3. On confirmation, close the keyboard → prepare the existing diagonal reveal → persist and apply the palette → finish the 2.2-second reveal → navigate to Provider with `skipTheme: true`. Opening completion and theme save are one SQLite transaction. Provider setup goes directly to character creation and never overwrites that palette.
4. Mixed hues or abstract descriptions still use the model's semantic interpretation when configured. With no configured model, the screen explains that it needs more detail and offers “连接模型帮我理解”; this explicit path remembers the description, opens provider setup, then applies the interpreted theme. It does not silently accept the pink default as a successful interpretation.
5. Existing cancellation/deadline guards remain. Failed interpretation/capture/save stays on Welcome with a retryable error. Only the reveal locks all interaction; request preparation can be canceled. Skipping preserves the current palette.

The local parser handles neutral modifiers such as blue-gray/pink-white, negation, simple English color names, and preserves current dark mode/unchanged qualities for later hue-only changes. Mixed chromatic requests go to the model instead of selecting a color by regular-expression ordering. It remains a bounded parser, not a replacement for general language understanding.

## Verification

The component acceptance uses the actual WelcomeScreen, ProviderScreen, ThemeScreen, ThemeProvider, ThemeService, palette generator and SQLite storage, with native capture/keyboard/animation ports and network mocked. Assertions check the actual context accent color, not just the preference JSON:

- No-Key blue selection changes the visible palette before Provider navigation.
- Provider saving goes to Create, keeps the same palette, and a fresh ThemeProvider restores it from persisted data.
- Purple, mint and dark-neutral choices change the default accent without invoking a provider.
- An abstract description does not silently save pink; the explicit model-setup path completes the original description and applies its structured result.

A one-request real DeepSeek acceptance also passed through `node scripts/test-live.cjs --theme`. “像雨后石板路反着路灯的光，干净克制。不要粉色和糖果感。” produced a calm, low-saturation, dark/cool blue preference with confidence 0.86. The local generator created the palette; saving and reinterpreting reused the result without a second request. Usage: 240 input tokens, 31 output tokens; no Ark call. Artifact: `artifacts/live-theme.json`.

No phone or emulator was used, as requested. Native reveal smoothness and OEM rendering remain device acceptance items; the navigation, palette application, persistence and real semantic-model response were validated separately.

## Build

Lint, typecheck, 283 offline tests (10 optional live tests skipped), Expo/Hermes compilation, 2 Kotlin JVM tests and Android Debug/Release builds pass. The standalone ARM64 preview is `artifacts/Nyvemi-0.14.4-arm64-preview.apk` (versionCode 28, 40,989,509 bytes). Existing preview signing identity is retained; signature, embedded-JS presence and known-development-credential scans pass.

SHA-256: `059a95cf6aab339e74c0a16fb0802f4789f2ccf6e5e453b1454f47982fd224ba`.
