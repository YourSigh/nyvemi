# OpenVoice V2 Android CPU prototype

Optional offline **tone conversion**, not a local TTS model. DeepSeek still produces
speech (and may charge); this converter changes that same cached waveform locally.
There is no model server, remote conversion request, automatic model download,
permission change, or model weight in the base APK/repository.

## Provenance and reproducibility

- Official source: https://github.com/myshell-ai/OpenVoice at
  `74a1d147b17a8c3092dd5430504bd83ef6c7eb23` (MIT).
- Official converter: https://huggingface.co/myshell-ai/OpenVoiceV2 at
  `f36e7edfe1684461a8343844af60babc2efbb727`, `converter/config.json` and
  `converter/checkpoint.pth` only. Checkpoint SHA-256:
  `9652c27e92b6b2a91632590ac9962ef7ae2b712e5c5b7f4c34ec55ee2b37ab9e`.
- Self-export with Python 3.11.14, torch 2.15.0, ONNX 1.19.1, opset 17;
  desktop/Android ONNX Runtime 1.23.2. Dependencies from PyPI/Maven Central.
  No community-exported graph or community exporter is executed.
- Encoder SHA-256: `64bd5e39bc92b1265e35eeb73e9e30558de6c54f15c176bff6f9b7543a0a2c91`.
- Converter SHA-256: `19ced6f4232d212e21ebd8562bd10eae7b5731610587dcdb691c1cedcf2f7507`.
- ONNX Runtime Android AAR SHA-256:
  `82048d1f462218adae4ba76477089ab0ba76093d84f733540066db1a8ba6b827` (MIT).

`export.py` verifies the original checkpoint hash. It exposes the official latent
noise as an input so `tau=0.3` can be tested with identical noise, rather than
quietly changing the official default to deterministic `tau=0`. It exports only
encoder/converter; OpenVoice's separate optional watermark stage is **not
implemented**. No watermark is stripped from inputs. This is not a full
watermarked-production OpenVoice distribution.

Example with an existing trusted converter-only Python environment, official
checkout and cached 24 kHz mono PCM16 speech (never trigger paid synthesis for a test):

```sh
python tools/openvoice-android/export.py \
  --official-root "$OPENVOICE_SOURCE" --checkpoint-dir "$CONVERTER_DIR" \
  --output "$WORK/models" --pcm "$CACHED_PCM"
python tools/openvoice-android/pack.py "$WORK/models" "$WORK/openvoice-v2-local.zip"
python tools/openvoice-android/test_frontend.py --official-root "$OPENVOICE_SOURCE" \
  --output "$WORK/frontend-tests" --cached-pcm "$CACHED_PCM"
bash tools/openvoice-android/build-harness.sh "$WORK/harness"
# Only after coordinating exclusive access to the explicit test device:
bash tools/openvoice-android/run-device.sh "$WORK/harness" "$ADB_SERIAL" "$WORK/models" \
  case-encoder/manifest.json case-1.00/manifest.json case-4.00/manifest.json
```

The full `OpenVoiceWav` CLI additionally expects `source.wav` (cached speech) and
`reference.wav` (synthetic fixture) beside the model files. Run it with the same
`app_process64` classpath/library-path setup as `run-device.sh`, passing the model
directory. It writes on-device resampled PCM, spectrograms, embeddings, explicit
noise, output PCM/WAV and timing metrics. `PipelineAcceptance` tests cancellation,
fresh reuse, finite results and closed-session rejection. Do not commit artifacts.

## App behavior and limits

Voice settings has an experimental model ZIP importer and a separate, default-off
local switch. Import accepts exactly the two known graph names/hashes, bounds
unpacked data to 140 MiB, rejects duplicate/path/unknown entries, loads both models
before replacing a working pack, and stores them in app-private files. The tested
ZIP is 122,872,634 bytes (117.2 MiB), unpacked graphs 131,310,602 bytes (125.2 MiB).
Import and enabled preference persist across restarts; importing alone does not
turn the switch on. No large pack is published or uploaded by this change.

Use an authorized local PCM16 WAV reference, then explicitly enable local mode.
Source is limited to 10 seconds per segment; reference to 30 seconds. Supported
input rates: 16/22.05/24/44.1/48 kHz, mono/stereo. Output is mono 22.05 kHz WAV.
Missing models, unsupported audio, oversized segments or inference failures reuse
that one DeepSeek synthesis; there is **no automatic reference upload to remote
conversion while local mode is selected**, and no second synthesis fee. Existing
explicit remote mode is retained when local mode is disabled. Stop cancels native
ORT work and discards late results. Inputs/output use temporary app-private cache.

The Android frontend uses a tested 64-lobe windowed-sinc resampler, not librosa
`soxr_hq`. STFT follows the official periodic Hann / reflect-pad / linear-magnitude
contract, but full default-librosa pipelines are not sample-identical. Reference
embeddings are computed per conversion, not yet persistently cached. CPU only;
no GPU/NPU claim, no long-running battery/thermal or subjective voice-quality claim.

## Measured acceptance, 2026-11-17

Redmi K80 Pro ARM64, shell ART process, four CPU threads, cached 4-second Stella
speech and synthetic harmonic reference. No paid request or production APK change.

- True on-device WAV → resample/STFT → source/reference encoders → converter → WAV.
- Preprocess 242 ms, encoders 14 ms; converter 2008/2099/2029 ms (first + two warm).
- Cold converter load 292 ms; peak process RSS 460,172 KiB (~449 MiB), including ART.
- Official Python with **the same on-device-resampled audio and noise**:
  STFT max absolute error 7.63e-6, encoder 5.31e-6, waveform 3.14e-5 / RMSE 7.53e-7.
- Cancel active inference: 15.9 ms; subsequent conversion 2022 ms, correct output.
- Own sinc vs soxr on cached speech: resampled waveform RMSE 0.00165, max 0.03196.
- Java WAV format/bounds/mixing/anti-alias tests and native Java/Kotlin build pass.

These numbers establish actual on-device execution, not an acoustic latency or
voice similarity measurement. APK integration acceptance is recorded separately
from the shell benchmark; never equate a host test with a device test.

### Isolated app bridge acceptance

The signed `app.nyvemi.qa` APK passed on the same phone without replacing the
production package: bad-SHA ZIP rejected; valid import yields available=true,
enabled=false; explicit enable runs the real TypeScript driver → native bridge →
local conversion (2487 ms) → 176,172-byte WAV → Android MediaPlayer, with complete
playback. Cancellation during conversion returned false without fallback or late
playback. Missing local reference reused the same cached synthesis. Tests also
assert no remote conversion on enabled-local failure or synthesis-time mode change.

After testing, the synthetic reference was removed and local mode disabled. A
force-stop/restart retained the validated pack and disabled preference. The test
pack remains only in the isolated QA app, not the production app. This is a
fixture-driven acceptance, not a paid network-chat or subjective quality test.
`npm run verify` passed: lint, TypeScript, 580 tests (17 intentionally skipped),
native unit tests and ARM64 debug assembly. No Git push, production installation,
model upload or extra paid synthesis occurred.
