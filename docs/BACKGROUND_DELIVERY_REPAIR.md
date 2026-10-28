# Background delivery repair — 0.11.1

## Confirmed code defect

A focused React Navigation screen remains mounted when Android backgrounds the app. ChatScreen had an unconditional minute timer updating `lastActiveAt`. With an active headless runtime, this kept marking the user as present, so the policy's `recent_active_chat` gate could suppress contextual proactive messages indefinitely. The app-level tracker already checked visibility; the redundant screen tracker did not.

The screen timer is removed. One app-level tracker checks visibility before entering SQLite and again inside its serialized transaction. Regression tests simulate 40 background ticks: activity stops changing, and the recent-activity suppression eventually clears. Returning to the foreground correctly renews activity. Quiet hours, caps and user-space preferences remain enforced. This explains a real suppression path; it does not establish which Android/OEM restriction affected every previously reported delivery.

## Native dispatch

- The optional, user-started `specialUse` foreground service retains the visible status notification and stop action. It now uses a native coroutine scheduler, rather than an indefinite Headless JS session with JS sleeps/intervals.
- Fast finite headless tasks check requested messages, conversation continuations and reconnect intentions about every 30 seconds while the process/CPU is awake. Slow full maintenance has a separate native lane about every 10 minutes, with a minute retry after execution failure. Cadence uses monotonic elapsed time.
- A unique native periodic WorkManager job runs at the Android minimum of 15 minutes with a connected-network constraint. It can create the React runtime without an Activity. Old hourly Expo work is retired only after durable native registration succeeds; its task definition stays available during upgrade.
- Each run has a unique receipt, a timeout, same-key in-process deduplication and a bounded partial wake lock released on success/error/cancellation. Fast/requested work is bounded to 150 seconds and full maintenance to 480 seconds. WorkManager retries failed callbacks. A finished maintenance callback means the checks completed, not that a message was necessarily sent. Existing intention delivery only acknowledges terminal durable task state.
- Existing per-intention OneTimeWorkRequests and native service deadline dispatch remain. SQLite leases and deterministic notification IDs prevent duplicate model/delivery work across dispatch paths. No key is copied out of SecureStore.
- A failing fast task category does not skip other categories or durable-work reconciliation. Native diagnostics retain startup, JS execution and receipt/failure stages, including execution with the UI backgrounded. Developer Mode offers a native one-time work enqueue in Debug builds.

## Limits

Android allows background HTTP calls; it does not promise continuous CPU/network access. Native coroutine delays also wait when the CPU sleeps. A foreground service does not guarantee immunity from Doze/OEM restrictions; the short wake lock protects an execution once dispatched, not the idle interval before it. WorkManager is deliberately inexact. Unrestricted battery settings may help; no UI setting promises permanent survival. Force-stop prevents background work until the user opens the app again. This implementation adds no exact alarm, vendor-specific permission bypass, silent media, accessibility service or server.

A message delivered immediately after resuming may be delayed background dispatch, a pending response finishing, or an eligible thought being evaluated later. Native run timestamps, source and per-intention logs now help distinguish these cases.

## Automated verification

- TypeScript regression tests: background activity freeze, foreground renewal and SQLite-queue visibility race; fast-before-slow ordering, failure isolation, finite repeated ticks; background/cold-runtime headless callback, error receipt and legacy registration migration; background-health explanations and privacy allowlists.
- Kotlin JVM tests: monotonic cadence, immediate first run, ten-minute successful cadence, one-minute error retry, fresh-service recovery.
- Existing proactive tests continue covering quiet hours, suppression, caps, expiration, storage leases and idempotent delivery.
- `npm run verify`: lint, typecheck, all local tests, Kotlin JVM tests and Android arm64 Debug build.
- Standalone arm64 Release built separately; installation/device acceptance is left to the user as requested. No phone/emulator and no paid API calls were used.

## User acceptance with the standalone APK

1. Update without clearing data. In notification settings, enable system/character notifications and 常驻陪伴; check that its ongoing notification is visible. If Android restricts the app, choose 不限制/allow background operation in battery settings.
2. Say “一分钟后随便给我发一条消息吧”, wait for the scheduled acknowledgment, press Home, and leave the UI backgrounded. A due request should be dispatched without reopening the app when Android permits CPU/network execution; the one-minute window is not an exact-alarm guarantee.
3. Tap the delivered notification and verify the matching chat message appears once. For a delayed/missing message, expand 来信故障排查 and share diagnostics: native `startedAt`, `finishedAt`, source, stage, work state and decision reason contain no chat content/API key.
4. Separately test unsolicited follow-up after a meaningful conversation, outside quiet hours and cooldowns. Most checks should still skip. Merely returning to the chat should not be necessary to create a background run. A successful maintenance run may correctly decide to stay quiet.
5. Test lock screen and longer idle separately from ordinary Home/background. Also test network loss/recovery, stop/re-enable of 常驻陪伴 and process restart. Force-stop is a separate expected limitation.

No automated test is presented as proof of OEM-specific elapsed-background delivery.

## Build result

- 195 TypeScript tests passed; 3 live/paid tests skipped. 2 Kotlin JVM tests passed.
- Lint/typecheck, arm64 Debug and standalone arm64 Release all passed.
- `Nyvemi-0.11.1-arm64-preview.apk`: versionCode 18, 40,186,521 bytes.
- SHA-256: `6f70005806e75955fc1cff833698692739bc024e649f9d3a53206aba86b27f69`.
- APK signature verified and matches 0.11.0; embedded JavaScript confirmed. Local credential scan passed. No key is bundled.
- Logs/receipt are local ignored artifacts: `verify-background-final.log`, `release-0.11.1.log`, `release-0.11.1.json`.
