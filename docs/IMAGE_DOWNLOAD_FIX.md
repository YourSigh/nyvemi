# Android image download repair — 0.14.3

## Root cause

`src/appearance/native.ts` used `AbortSignal.timeout(60000)` when downloading generated images, and `AbortSignal.any(...)` when a caller supplied cancellation. React Native 0.83's `Libraries/Core/setUpXHR.js` installs `abort-controller/dist/abort-controller`; that implementation has neither static method. Download therefore threw `TypeError: AbortSignal.timeout is not a function`, shown on Hermes as `undefined is not a function`.

The earlier provider tests injected an ImageAssets download stub. Node's AbortSignal also implements these newer methods, and Hermes bytecode compilation does not validate their runtime availability. Those checks missed the actual native-adapter failure.

## Repair

- Download uses `AbortController`, an abort listener and a 60-second timer, matching the primitives available on Android. Its listener and timer are disposed on completion, error, timeout and cancellation.
- Cancellation before download makes no CDN request. Cancellation during the request propagates to the download controller. Files are validated before returning an image; invalid output is rejected and failed image inspection removes the file.
- No model/API settings or request cache IDs changed. A received generation response is still persisted before download. Retry can resume that response without another paid generation POST; cached local assets remain reusable.
- CDN requests carry no API Authorization header. Download/timeout errors explain that the received generation result is retained, instead of surfacing an unhelpful JavaScript exception.

## Regression evidence

`tests/image-download-native.test.ts` executes the production `imageAssets` adapter with the same AbortController/AbortSignal implementation registered by React Native. Filesystem, native image metadata and network are injected fixtures; this is not a phone test or a real Seedream image-quality test.

Before the patch, all five initial regressions failed at the unsupported static calls. `artifacts/image-download-before-fix.log` records the exact TypeError. After repair, six cases cover:

1. Download and file validation without either static AbortSignal helper, including no credentials sent to CDN.
2. A generation response received before a failed CDN download, then retrying after a new provider instance without another generation POST.
3. All three candidates through the native adapter and reusing the completed draft.
4. Stalled download timeout with no retained timer or file.
5. Already-canceled work making no request.
6. Active cancellation propagating and removing the parent listener/timer.

No paid Ark/Seedream request, phone or emulator was used in this development round. Installing the APK and retrying the same description/settings will preferentially reuse existing received responses; do not clear app data to recover this error. A provider CDN URL that has expired can still fail independently of this JavaScript repair.

## Build validation

Lint, typecheck, all 275 offline tests (9 optional live tests skipped), Expo/Hermes compilation, 2 Kotlin JVM tests and Android Debug/Release builds pass. Standalone ARM64 preview: `artifacts/Nyvemi-0.14.3-arm64-preview.apk`, versionCode 27, 40,986,929 bytes. The existing preview signing certificate is unchanged; signature verification, embedded-JS presence and known-development-credential scanning pass.

SHA-256: `d0667fdf0f4c31752fe696daf599a0a2bccc96271b8805c06a9204961fc5843a`.
