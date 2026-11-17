# OpenVoice V2 Android CPU prototype

Optional offline **tone conversion**, not a local TTS model. DeepSeek still produces
speech (and may charge); this converter changes that same cached waveform locally.
The standard ARM64 release bundles the verified licensed converter. There is no
model server, automatic model download, permission change or model weight in Git.

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

Voice settings has local preparation for the bundled pack, a manual ZIP fallback,
and a separate default-off local switch. Import accepts the two known graph names/hashes
plus the pinned license/notice texts (old two-graph packs remain compatible), bounds
unpacked data to 140 MiB, rejects duplicate/path/unknown entries, loads both models
before replacing a working pack, and stores them in app-private files. The tested
licensed ZIP is 122,874,105 bytes (117.2 MiB), unpacked graphs 131,310,602 bytes (125.2 MiB).
Import and enabled preference persist across restarts; importing alone does not
turn the switch on. The pack is bundled locally in the APK; no online model host or downloader is used.

Use an authorized local PCM16 WAV reference, then explicitly enable local mode.
Source is limited to 30 seconds and internally segmented near eight-second low-energy
boundaries when longer than ten seconds; reference is limited to 30 seconds. Supported
input rates: integer 8–96 kHz, PCM16 mono/stereo. Output is mono 22.05 kHz WAV.
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

## Download-on-demand ARM64 release (0.20.19)

The standard release is built with `npm run android:release`, pins ARM64 and
rejects model/ABI overrides. It does not download or embed weights. The APK check
rejects bundled ONNX graphs/model ZIPs, Qwen weights and audio/QA fixtures; it
requires standalone JS, ONNX Runtime and a package below 200,000,000 bytes.
The existing release configuration still uses its development signing certificate.

The separately distributed, licensed v1 archive remains 122,874,105 bytes with
SHA-256 `9f6d7822c57371227e70803481c7c8cddcbbc5848f0d9e8234bbe941f3bb64e6`.
Public download is pinned to ModelScope repository `YourSigh/nyvemi-openvoice-android`,
revision `0d1ddd2f60fd1bc4cd4bc6ee032fc34f422e8d51`, file
`openvoice-v2-android-1.zip`. Only `modelscope.cn` and the observed exact CDN
host `cdn-lfs-cn-1.modelscope.cn` are accepted; temporary redirect URLs are
not persisted or logged. The anonymous fixed-revision range was verified
separately before configuring this endpoint.

It contains exactly two exported graphs, the original MIT license and provenance
notice; no reference recordings, embeddings, API keys or TTS engine. Downloads
are explicit, resumable and verified before import; valid prior installations
remain usable and manual file import remains available. No startup auto-download
or automatic reference authorization/application is introduced.

Production 0.20.19 (version code 64) is 62,325,809 bytes (62.33 MB / 59.44 MiB),
SHA-256 `378ef31ee6d78a1da10c2d61a42f5c2a6b747513f0987f396c8e106f427deef4`.
Its DEX contains the pinned public revision and exact allowed CDN hostname;
APK signature and no-model/no-fixture checks passed. Offline full verification
passed 608 tests (17 skipped), 23 native tests and ARM64 debug assembly.
The native transfer has a real loopback HTTP Range pause/resume test, checksum
rejection and preservation of an existing installed sentinel. This is not a
substitute for the separate real-phone public-network acceptance.

Real Redmi acceptance (isolated fresh app, 2026-11-17): started with no model;
cellular anonymous ModelScope -> approved CDN transfer completed four exact
HTTP ranges, 122,874,105 bytes, and the phone computed the pinned full SHA-256
before ORT installation. Download completed in about eight seconds. Manual
pause/resume was not exercised on that fast phone transfer; only the controlled
HTTP acceptance above covers pause/resume. The same isolated phone test then passed authorized synthetic-reference preview,
explicit application and post-restart reuse with cached source TTS. This proves
local conversion using the freshly downloaded model, not a new paid TTS request
or public-character voice similarity. The installed production app and
its user data were not overwritten.

The following bundled-package acceptance is retained as historical evidence,
not the current packaging instructions or download acceptance.

## Historical bundled ARM64 release (0.20.17–0.20.18)

Keep the verified licensed input outside Git, for example
`artifacts/openvoice/openvoice-v2-android-1.zip` (ignored). `pack.py` generates it
with fixed metadata and the original MIT license plus provenance notice. Archive
SHA-256: `9f6d7822c57371227e70803481c7c8cddcbbc5848f0d9e8234bbe941f3bb64e6`.

```sh
NYVEMI_OPENVOICE_PACK="$PWD/artifacts/openvoice/openvoice-v2-android-1.zip" npm run android:release
```

The standard release script requires that local input, pins ARM64, stages only the
validated pack and rejects Qwen model/alternate ABI overrides. It never fetches a
model. Development builds can omit it and retain manual import. The APK verifier
requires the exact archive and four inner hashes, standalone JS/ORT, ARM64 only,
no Qwen weights or audio fixtures, and a strict total below 200,000,000 bytes.
The ordinary asset/credential release check also runs. Current project release
signing still uses its existing development certificate, not a store-release key.

Measured standard release APK: **185,230,106 bytes (185.23 MB / 176.65 MiB)**,
including the bundled model. The Qwen engine license/native libraries remain, but
its 761 MB weight is absent and its UI stays hidden. This is package size, not
installed storage: first local preparation adds about 125 MiB private model files,
in addition to the APK, Android code/native-library storage and app data. Preparation
streams the ZIP from APK assets, avoiding a second 117 MiB private ZIP copy.

An explicit “想要流萤的声音” request now offers one local preparation action when
the model is missing, rather than requiring a server. It does not download, change
the voice, enable conversion or automatically apply an unapproved public sample.
After preparation the user imports authorized reference audio and enables local
conversion separately. Existing search is separate and still requires its configured
service; model installation does not supply character recordings.

Bundled acceptance: isolated ARM64 emulator starts available=false/bundled=true/
enabled=false; actual `prepareBundledLocalVoice` validates and loads both models in
3026 ms, then available=true/enabled=false; repeated preparation 8 ms, force-stop/
restart preserves ready/off. Natural-language recognition (including the exact
Chinese request), no implicit preparation/search, and one-action component behavior
are unit/component tested, not an emulator full-chat UI run. `npm run verify` passes
585 tests (17 skipped), native tests and ARM64 assembly. Redmi/production app untouched.

## 0.20.18 phone-native reference workflow

`NyvemiPublicVoiceReferences` ports the original web parser/decoder workflow onto
Android: anonymous HTTPS to allowlisted BWIKI pages/CDN, exact character/Chinese
column validation and bounded downloads; platform MediaCodec normalizes public
MP3/Ogg recordings to 22.05 kHz PCM16. No Mac endpoint, provider credential, whole
chat message, cookie, or audio upload is involved in this lookup. A small exact
same-character Chinese Fandom archive fallback reuses the original web paths;
it is not a license grant and never replaces a missing voice with another person.

Natural named requests search once and cache candidates. A pending request resumes
after bundled-model preparation. Candidates retain labels and provenance; raw
preview, explicit converted audition, and application are separate states.
Converted audition is a manual action that may incur one ordinary DeepSeek TTS
request; it uses `previewLocalVoice` without changing enabled state or persistent
role settings. Failure/cancellation plays no replacement audio. Applying verifies
the expected candidate ID, records the user's explicit rights assertion, enables
local conversion and reuses that exact reference on later requests.

The public reference cache is bounded separately from saved user references.
No external model hosting/downloader or public deployment was added. Old explicit
remote companion support remains advanced/optional, not a prerequisite for the new
primary path. Source availability and audio quality must be reported separately
from converter execution, with real-phone workflow evidence before claiming success.

### 0.20.18 actual Redmi workflow acceptance

An isolated `app.nyvemi.qa.web` build used actual ChatScreen/ChatService named
requests and actual Android public-source retrieval, not a desktop companion.
Firefly's exact Chinese Fandom archive and Kafka's Chinese BWIKI clip were found,
downloaded, decoded to 22.05 kHz and completely played as **raw source auditions**.
The public actor clips were not applied by the test operator.

A distinctly labelled authorized synthetic candidate then completed strict
pre-application converted preview (2222 ms conversion; enabled remained false and
no role reference was applied), explicit same-ID application, force-stop/restart
persistence, and the real chat playback queue's local conversion (2676 ms). An
unknown-role request failed clearly without replacing the selected reference;
a later chat conversion still succeeded (2213 ms). Cached official TTS was used;
no paid speech request or production-phone overwrite occurred. This does not
claim subjective actor similarity or a live cloud-LLM conversational test.

The final production ARM64 0.20.18 package is 185,230,106 bytes, SHA-256
`c52bf9bba3ee391caf2abdb9e70d0de6dc70af6045791962a56a0632ca115531`.
Asset/credential checks and the model archive/four content checks pass. Final
TypeScript/lint and 600 tests pass (17 skipped); native policy tests/build pass.
New long-clip segmentation and all integer 8–96 kHz frontend rates are covered by
pure tests; long-clip phone inference/seam quality was not separately auditioned.
