# UI review and repairs — 0.14.2

This review inspected every registered screen and the shared navigation, form, keyboard and theme paths. It preserves the existing character runtime, one-third stage, chat, DSH and local data. It is a source/component/domain regression review, not a claim of physical-device E2E coverage.

## Findings and changes

### Theme changes

The prior theme transaction disabled all touch input while awaiting native capture/reveal/cleanup and persistence. Native animation had a watchdog, but JS awaited its promises without deadlines; a missing bridge callback could leave the JS interaction shield active indefinitely. Interpretation could also wait for the provider's 90-second timeout. These are identifiable hang paths, rather than a claimed reproduction on the reporter's device.

The existing Theme route only implemented the first-run opening. There was no dedicated settings editor in this revision. A settings entry and explicit `mode: settings` now use the current preference, expose an editable description and save without consuming an opening draft or navigating to character creation.

- Interpretation is cancellable and bounded at eight seconds; recognizable colors have the existing local fallback. Canceling never initiates a fallback or saves the new theme.
- Each transition stage has a deadline; cleanup itself cannot block returning touch control. Reduced-motion behavior and the 2.2-second diagonal reveal remain.
- Leaving the app cancels the active transaction. Native operations carry IDs: stale cleanup cannot dismiss a newer animation, and canceled IDs cannot create a late overlay.
- The persistence stage receives cancellation and checks it inside its SQLite transaction. Failed capture/save keeps the old visible theme. A failed reveal after a successful save keeps the chosen theme and releases interaction.
- The settings editor can be canceled/backed out of during interpretation. Only the actual reveal blocks navigation/touches.

### Forms, keyboard and alignment

- Shared form pages have an explicit flexible viewport, safe-area content padding, and space between the focused caret and keyboard toolbar. Only the focused page performs keyboard-aware scrolling and renders its toolbar. Navigation blur dismisses the keyboard.
- The toolbar supplies previous/next field actions and “收起”, including for numeric keyboards without a Done key. Single-line fields submit/blur; multiline fields retain newlines.
- `closeKeyboard` now dismisses focus even when keyboard visibility reports false, avoiding an input retaining focus as a theme transition begins.
- Shared fields merge caller styles instead of replacing all base layout. Single-line text uses centered vertical alignment and consistent padding; multiline forms retain top-aligned paragraph layout. Technical identifiers/keys avoid autocorrect.
- Buttons center their label vertically/horizontally and remove Android's extra font padding. Chat text/voice/photo controls use the same 48-point minimum height. Choice chips and settings rows get consistent label alignment; long switch labels can wrap without pushing switches offscreen.

## Screen coverage

| Area                           | Reviewed path / validation                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Welcome, Provider              | Opening preference, saved provider/key, form container, long action labels and keyboard dismissal                                |
| Theme                          | Opening and settings are distinct; component tests cover editing, persistence, cancel/retry and no unwanted character navigation |
| Create, Generate               | Existing interview/persona regressions retained; answer input/chips and shared action layout checked                             |
| Appearance                     | Existing candidate/rig/save regressions retained; form, mode choices and keyboard changes apply; no paid generation run          |
| Chat                           | Existing keyboard/stage layout retained; aligned composer controls, image/text/voice paths inspected; chat/theme regressions run |
| Settings                       | Main rows, notification toggles, quiet hours/numeric fields, RSS form and name-confirmed reset inspected                         |
| MediaSettings, Plugins         | Shared form/toolbar, secret fields, wrapping switches, plugin workflow and media regressions                                     |
| Usage                          | Numeric price fields share keyboard controls; existing usage/price tests run                                                     |
| Memory, Experiences, Developer | Scroll/read/error paths inspected; existing memory/experience/diagnostics regressions retained                                   |
| Transfer                       | Existing bundle/photo/plugin import/export regressions retained; no provider credentials exported                                |

## Regression evidence

- Stage 1: lint/typecheck, 263 tests, Kotlin JVM tests and Android Debug build passed; commit `6f176c4`.
- Stage 2: lint/typecheck, 266 tests, Kotlin JVM tests and Android Debug build passed; commit `d162758`.
- Added component tests exercise the actual ThemeScreen with SQLite and the actual ThemeProvider with injected native callbacks. They verify a stuck capture can be retried, stuck reveal/cleanup release the global touch shield, background cancellation uses the matching operation ID, and hidden form pages remove their toolbar.
- Core transition tests inject stalled input/capture/persistence/paint/reveal/cleanup. Theme-service tests check bounded interpretation and canceled persistence.
- Tests use fake clocks and Mock model/native ports; no paid API requests, phone or emulator were used in this round. Native IME geometry, OEM font rendering, real screenshot/reveal smoothness, microphone/gallery/system-dialog behavior remain device acceptance checks. The APK is provided for that validation.

## Final build

Lint, typecheck, all 269 offline tests (9 optional live tests skipped), Expo/Hermes compilation, 2 Kotlin JVM tests and Android Debug/Release builds pass. No new lint warnings were introduced; Gradle still reports existing deprecations.

Standalone ARM64 preview: `artifacts/Nyvemi-0.14.2-arm64-preview.apk`, versionCode 26, 40,985,905 bytes. The APK includes its JS bundle, passes signature verification with the existing preview certificate, and contains no detected local development credentials or `.env` entries.

SHA-256: `5a1deae3c0a5b1bf011a702da65842e1f7fe31be41102c3092d567ad830d8917`.
