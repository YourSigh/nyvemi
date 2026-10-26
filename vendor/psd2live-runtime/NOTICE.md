# PSD2Live runtime

Upstream: https://github.com/tsunehimatoi/psd2live
Pinned commit: `692986728e2b7b9254a41a22bdce1656bc0c12f9` (3.6.7).

`player.txt` is the unmodified MIT web player from `targets/web` (renamed for Metro asset loading).
`runtime.wasm` is the upstream bundled MIT runtime WebAssembly from the same commit.
`LICENSE` is the upstream runtime MIT license. These are deliberate vendored runtime dependencies, not generated application build outputs.

The GPLv3 desktop compiler is run separately, not embedded in the Android APK. No official Live2D Cubism proprietary runtime is used or redistributed.
