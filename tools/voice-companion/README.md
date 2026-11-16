# Nyvemi local voice companion (debug only)

Standalone Node.js22+ service. No npm packages, cloud API keys, app-file changes,
or automatic startup. Public audio discovery is for **preview only**, not permission
to clone a character or person's voice. The app must separately obtain/record
authorization for any reference it sends to conversion. No consent inference is
made from public availability.

## Setup

Prerequisites:

- Node.js22+.
- Trusted installed Homebrew ffmpeg at `/opt/homebrew/bin/ffmpeg`.
- Original local OpenVoice adapter already running at
  `http://127.0.0.1:8000/v1/audio/convert` for conversion (not required for discovery).
- A separately configured random bearer secret, at least32 URL-safe characters.
  Generate it through your normal secret-management workflow and provision the
  same value into the debug app; do not commit it, put it in a URL, or log it.

Set `NYVEMI_COMPANION_TOKEN` in the process environment, then run:

```sh
node tools/voice-companion/server.mjs
adb -s <explicit-debug-emulator-serial> reverse tcp:4319 tcp:4319
```

This does not configure automatic boot/login startup. Stop with Ctrl-C; remove
the explicit debug mapping when finished. Never bind publicly, forward a router
port, configure release cleartext networking, or copy DeepSeek API keys here.
The server hardcodes127.0.0.1:4319 and rejects all browser Origin headers and any
Host other than `127.0.0.1:4319`. TLS is intentionally absent only on local debug
adb reverse. Use `Authorization: Bearer <companion token>` on every request.

## Contracts

All JSON errors are `{"error":"safe human-readable message"}`. No source paths,
upstream bodies, secrets, query text, or audio are logged.

### GET or POST /health (alias /v1/health)

Authenticated200:

```json
{
  "ok": true,
  "converterReady": true,
  "service": "nyvemi-voice-companion",
  "version": 1,
  "openVoice": "http://127.0.0.1:8000",
  "referenceUsage": "preview"
}
```

A bounded1second GET to fixed127.0.0.1:8000/health supplies converterReady (only ready:true counts). No auth is forwarded; network/parse/size errors return false. Companion ok remains true so search still works while conversion is unavailable.

### POST /v1/reference/resolve

`Content-Type: application/json`

```json
{ "query": "阿狸", "urls": ["https://wiki.leagueoflegends.com/en-us/Ahri/Audio"] }
```

The caller supplies a cleaned role query and optionally up to6 public URLs from
its authorized search flow. Companion performs no model/search API call.
A small explicit name seed supports Ahri, Nahida, Furina, Keqing, March7th.
Unknown roles require URLs; failure is explicit, never replaced with another role.
Max4 unique candidates,45seconds overall. Fandom page patterns map to their exact
conventional public file; BWIKI requires explicit Chinese-language column evidence.
All actual GETs use shared strict public-IP validation and TLS hostname pinning.

Success200:

```json
{
  "label": "阿狸",
  "sourceUrl": "https://wiki.leagueoflegends.com/en-us/Ahri/Audio",
  "wavBase64": "...",
  "usage": "preview"
}
```

Every public game/unknown response is `preview`, never `reference`.
The app's separately authorized Commons/license/manual route may mark its own
approved references; this endpoint does not assert licensing.

ffmpeg converts supported Ogg/MP3/WAV to mono PCM16 WAV24kHz and truncates preview
to30seconds; metadata removed. Input max8MiB, parser HTML max3MiB
(BWIKI max1MiB), decode20seconds, output1.5MB bound. Temporary files have
private directories and are removed even on cancellation.

### POST /v1/convert

```json
{ "sourceWavBase64": "...", "referenceWavBase64": "..." }
```

Both inputs must be canonical Base64 encoding complete RIFF PCM16 mono or stereo WAV,
16/22.05/24/44.1/48kHz, at most30seconds/3MiB each.
The authenticated app is responsible for ensuring the reference is authorized.
Success200 is binary `audio/wav`, not JSON.
A single multipart request with `source`, `reference`, `model=openvoice` goes
only to127.0.0.1:8000. No companion token/cloud key is forwarded. No redirects,
no remote fallback,120seconds maximum. Disconnect cancels work. Returned WAV
is validated, bounded3MiB and at most31seconds (small model rounding allowance).

## Security / limits

- Token compared as fixed-size SHA256 hashes with timingSafeEqual; duplicate
  Authorization/Host rejected; authentication occurs before parsing JSON/work.
- No CORS, browserOrigin accepted nowhere, fixed local binding/destinations.
- Max2 active jobs,9MiB JSON limit,10second body-read limit.
- Public HTTPS443 only: no userinfo, auth/signature query strings, cookies,
  redirects, JavaScript/video extraction, private/reserved/mixed DNS answers.
- Per-preview verified DNS cache, all addresses validated before any connection,
  original TLS SNI/certificate verification intact. On fake-IP-only198.18/15
  system results, fixed bounded Google Public DNS resolution may supply public
  addresses; never used for internal names or private/mixed results.
- Compressed public responses rejected, bounded bodies; HTML may stop after
  a complete literal audio tag. Actual audio always read fully/validated.
- No user audio, query history, credential, or result persistence.

## Tests

```sh
node --test tools/voice-companion/*.test.mjs
```

Tests do not bind any port or launch the service. Public DNS/HTTP and OpenVoice
are mocked; real ffmpeg receives only a generated synthetic WAV. Coverage includes
SSRF, mixed/fake DNS, TLS-pinning request contract, caps, hostile headers,
authentication, WAV validation, preview-only semantics and local-only conversion.
Live public resolver/model-quality verification is separate.
