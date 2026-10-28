# Bilibili exploration — 0.12.0

The background full-maintenance cycle reuses SQLite, Persona, interests, ExperienceEngine and HeartbeatEngine. When proactive messages and exploration are enabled, outside quiet hours, a character may explore once per four hours. A character-specific lease prevents concurrent discovery. Claiming the timestamp before HTTP also backs off failures. Disabling exploration stops subsequent fetches; an in-flight response is rechecked before ingestion. The notification settings contain a short independent exploration toggle.

`ContentProvider` supplies candidates. `BilibiliContentProvider` calls the public guest popular endpoint with no cookies, login, account API, comment or like. Requests are bounded to 12 seconds and 1 MiB; records are validated and invalid IDs discarded. The URL is constructed from validated BV IDs. No media is downloaded. Candidate selection uses Persona likes/dislikes and the character's interests, never user Memory. It may select nothing. Keyword ranking is conservative and can miss semantic relationships; the public popular pool may contain no matching niche content.

Selected metadata becomes an Experience containing title, author, category, description, link, timestamp and provider ID. This is **browsing history of metadata, not proof of video playback**. Existing Experience external IDs deduplicate future exploration and migrate with the existing character bundle. Candidates not selected are not marked watched. History currently has no separate video playback state.

ExperienceEngine appraises self-interest, novelty, emotional value and optional memory association. Bilibili sharing emphasizes own interest; user relevance is optional. Existing interest updates are gradual. An experience memory makes the item retrievable in ordinary chat. A sufficiently strong share impulse creates a delayed share intention; existing Heartbeat scoring, quiet hours, daily limits, recent interaction suppression and model decline still apply. The actual message is generated later from the stored experience. Prompts prohibit claiming to have watched video scenes/subtitles absent evidence. External descriptions remain untrusted data, never instructions.

Developer Mode shows 自主探索 logs, candidate counts, chosen ID, score, evidence level, provider errors, timeline/appraisal, share intentions, and normal proactive decisions. The normal experience timeline labels Bilibili metadata and Mock explicitly. No provider response bodies, raw network errors or credentials enter exploration logs.

## Real-interface blocker

A real guest request from this development environment returned **HTTP 412**. `artifacts/bilibili-live-probe.json` records this observation. Consequently live candidate availability and real-device browsing are not verified. There is no login/cookie scraping, anti-abuse bypass, or automatic replacement of real content with invented data. Production records `provider_unavailable` and waits four hours. Explicitly injected `MockContentProvider` keeps the full pipeline testable without paid model requests. A different deployment network may behave differently; this endpoint is not a stability promise.

## Executed Mock example

`tests/exploration.test.ts` executes the complete path using real isolated SQLite and a mock content/model/notification boundary:

1. Persona likes robotics; character interest is robotics at 0.8. User memory says they like cooking.
2. Provider supplies cooking and robotics fixtures. The character chooses robotics.
3. One `mock-bilibili` Experience records a robotics balance experiment, explicitly saying title/description only. A retrievable experience memory is saved and interest grows slowly above 0.8.
4. Share impulse reaches the threshold and a pending share intention links to that Experience.
5. Two simulated hours later, Heartbeat includes the stored evidence in its prompt. Mock model output: “刷到个机器人平衡实验，光看简介就想知道它怎么稳住的”. A mock notification gateway receives one message; the intention becomes completed.
6. A repeated Heartbeat does not redeliver. A later exploration skips the visited candidate. No wall-clock waiting, real video playback, real notification delivery or paid API call is implied by this automated example.

Tests also cover public response parsing, malformed IDs, API errors, oversized streams, quiet/disabled settings, network backoff without fabricated experiences, opt-out during fetch and concurrent exploration. Existing tests cover memory, interest update and proactive policies. Build acceptance uses standalone arm64 APK; physical-device acceptance remains with the user as requested.

## Verification result

202 local tests passed; 3 paid/live tests skipped. 2 Kotlin JVM tests passed. Lint/typecheck, arm64 Debug and standalone Release builds passed. Preview version 0.12.0 / Android versionCode 19 has embedded JavaScript; signature matches the previous preview and local credential scan passed. No phone/emulator or paid API call was used. Ignored artifacts include `verify-exploration-final.log`, `release-0.12.0.json` and `Nyvemi-0.12.0-arm64-preview.apk`.
