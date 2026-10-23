# Nyvemi

**A life that remembers you.**

Nyvemi is a local-first AI companion that remembers, experiences, grows, and reaches out on its own.

_An AI that lives between conversations._

Android first, built with React Native, TypeScript and an Expo Development Build. The interface uses a soft pink-and-white palette. License: **AGPL-3.0-only**, matching PairNest.

Nyvemi does not simulate consciousness. It implements persistent state, memory, experience, interest and proactive behavior. A role can retain an unfinished conversation topic, encounter a relevant experience later, and decide whether it is worth reaching out. It is not a scheduled “good morning / have you eaten?” bot.

## Current status

This is an early MVP implementation, not a completed real-device field trial. **0.3.1:** conversational timer recognition and native one-time WorkManager delivery have passed local logic tests and Android compilation; this revision has not been tested on a device or with a paid model. Earlier emulator results below apply to earlier implementations. The core loop has a deterministic integration test using a clearly identified local HTTP model fixture. Android compilation, installation, React Native startup, SQLite creation and WorkManager registration/execution have been checked on an API 35 ARM64 emulator. The optional foreground companion notification was opened and stopped through the emulator UI, and remained active after returning to the launcher. A real DeepSeek test has passed the complete 12-round interview, persona generation, streamed chat, relationship-memory extraction and contextual proactive generation against isolated SQLite. Notification delivery in that test is a test double, with a simulated clock. Full interview UI completion, launcher shortcut confirmation and hours-long background behavior still require device acceptance testing. See [acceptance matrix](docs/ACCEPTANCE.md).

## Local-first and BYOK

There is no Nyvemi account, backend, payment service or cloud sync. Persona, conversation, memory, relationship state, interests, experiences, intentions and settings live in device SQLite. Avatars are app-private files.

You choose the model service and supply your own key. Requests send the relevant persona, bounded conversation context and selected memories to that service. **Local-first does not mean inference is offline.** RSS requests contact only feeds you configure. No analytics or crash-reporting backend is configured.

API keys use Expo SecureStore backed by Android Keystore. They do not belong in SQLite, source, ordinary preferences, diagnostics or character exports. Do not put keys in Base URLs, Git or chat messages. Prompt logging is off by default; Developer Mode can record private conversation context locally, with known credentials redacted.

## Provider setup

On first launch: Welcome → Provider → character questions → generation → Chat.

- Provider: OpenAI-compatible.
- Base URL: the API root, often `https://provider.example/v1`; do not append `/chat/completions`.
- API Key: stored securely; blank preserves the saved key only for the same origin. Switching provider origins requires entering the new service's key.
- Model: the service's model identifier.
- Use **Test connection** to make one small request; model usage is billable by your provider.

The adapter exposes `chat`, `streamChat`, and schema-validated `structuredOutput<T>`. Native streaming uses `expo/fetch`. Provider requests have timeouts, bounded output, sanitized errors and usage metrics. Adapters for Gemini and image generation are future work; `ImageProvider` is reserved. OpenRouter or a compatible local service can use the existing adapter.

### DeepSeek

Choose the DeepSeek preset: Base URL `https://api.deepseek.com`, model `deepseek-flash`, and your DeepSeek key. Ordinary companion chat sends `thinking: { type: "disabled" }` to the DeepSeek host. Model identifiers remain editable. See [DeepSeek API documentation](https://api-docs.deepseek.com/guides/thinking_mode/).

For Ollama or a LAN endpoint, use its OpenAI-compatible `/v1` API. Local/private IPv4 HTTP URLs are allowed; public endpoints require HTTPS. An emulator can reach the host at `http://10.0.2.2:PORT/v1`. For a server without auth, use `local` as the key placeholder.

## Persona and natural chat

Creation is a 12-round conversational interview: one question at a time, a short model acknowledgement, then the next question. Progress is explicit; all but the name can be skipped. A local draft survives interruption, and a review/edit step precedes final persona generation. Appearance, relationship, tone, independent interests, boundaries and a venting scenario are covered. Offline acknowledgements are explicitly labeled as local guidance. It uses natural questions rather than personality percentages. The model generates a validated Persona. A **桶砸** development persona is also available; it skips persona generation, but does not invent model responses or bypass BYOK for chat.

Chat uses a private-messenger layout with avatars, timestamps, local history, streaming and 0–6 reply bubbles chosen by context. A complete reply is validated before any assistant bubble appears; generation only shows a typing status. Intentional silence creates no placeholder bubble and still preserves the user turn for memory extraction. Additional bubbles appear about 400–1000 ms apart. Failed requests can be retried without duplicating the user message. Requests and multi-part replies survive interruption with recoverable state. Older history loads on demand; model prompts remain bounded to 16 recent messages and up to 8 selected memories.

## Memory and relationship

`MemoryRepository` handles CRUD, near-duplicate merging, expiration and open-loop completion. A replaceable `MemoryRetriever` ranks Chinese bigrams / English keywords, recency, importance, type and access count. Candidate retrieval is bounded; this version has no vector database or embeddings.

Meaningful rounds create durable extraction jobs. Structured extraction produces semantic/episodic memories, relationship preferences, open loops and persona feedback. Jobs retry with backoff; user feedback can change response preferences without editing a personality dashboard. A follow-up being sent does not itself prove the underlying real-world event is complete. The user or subsequent conversation analysis completes it. An explicit request to stop proactive contact pauses proactive messaging; disliking a stock phrase alone does not.

## Proactive engine

A heartbeat first cleans expired data and evaluates local gates: enabled setting, quiet hours, recent activity, minimum interval, daily limits, due intentions and notification permission. It then scores relevance, urgency, emotional value, novelty, relationship value and interruption cost. Most runs skip without any model request.

Only a sufficiently strong candidate generates a short contextual message. The engine checks activity and intention state again after generation. A persistent notification outbox makes delivery recoverable and idempotent. Tapping a notification, or opening its character chat, promotes the pending proactive message into normal conversation history. Developer Mode explains each evaluated decision.

New characters enable proactive messages according to the interview initiative answer; an explicit opt-out remains off. Existing settings are preserved. Default quiet hours: 23:00–08:00; at most 2 per character/day; 180-minute character interval; 30-minute recent-activity suppression. This MVP also enforces a global cap of 4/day and 30 minutes between different characters. These are conservative hard caps in this version.

## Experience engine

Sources implement `ExperienceSource`:

- `LocalTimeExperienceSource`: time-of-day/weekend context; deliberately too weak to trigger routine greetings.
- `ConversationExperienceSource`: important shared episodic events.
- `RSSExperienceSource`: up to 5 configured HTTPS feeds, polled at most every 4 hours while proactive behavior is enabled.

RSS/Atom is bounded text input, not a source of instructions. Deduplicated experiences are appraised for self-interest, user relevance, novelty, emotional value and memory association. A strong share impulse creates a future Share Intention; the sending language is generated later. Character interests change slowly, and user relevance alone does not copy a user's taste into the character. Rule-based appraisal can miss semantic associations; embeddings and richer appraisal are future options.

## Android background limitations

`expo-background-task` uses Android WorkManager, registered from a globally defined TaskManager task. The configured minimum delay is about 60 minutes. It is **not an exact timer**. WorkManager and this Expo version require network connectivity for the job. Doze, battery restrictions, vendor behavior and force-stop can postpone or prevent execution. Reopen after force-stop; boot/unlock behavior should be tested on the target device. No exact alarms or server push is used. An optional user-started foreground companion session is available as described below.

See [Expo BackgroundTask](https://docs.expo.dev/versions/v55.0.0/sdk/background-task/) and [Android WorkManager](https://developer.android.com/topic/libraries/architecture/workmanager).

Use a standalone APK with embedded JavaScript to test the closed-app loop. A Debug Development Build normally depends on Metro; it is not sufficient evidence of standalone background behavior.

## Usage and estimated cost

**用量与费用** is available from Provider and character settings. It shows today/month/all-time token counts, per-model and per-currency totals, and the latest requests. The SQLite usage ledger is independent of bounded developer logs. Input, output and cached-input counts come from provider responses, including final SSE usage. Missing usage is unknown, not zero. Interrupted requests retain any usage already received.

Configure input/cache-hit/output rates per million tokens for each Base URL + model. Costs are estimates using a saved per-request price snapshot; changing a rate does not rewrite history. Unpriced requests and unknown cache splits are clearly identified. There is no balance lookup, shared-key usage, pre-upgrade history reconstruction or character-bundle billing export.

DeepSeek fixed-tariff presets were checked on 2026-10-22 against the [official RMB pricing page](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/). Select peak/off-peak rates deliberately; the app does not automatically resolve holidays or future price changes. Existing model settings are preserved; new presets use `deepseek-flash`.

## Optional persistent companion session

In character settings, choose **开启常驻陪伴** while the app is foregrounded. This is separate from **允许她主动来信**. A private, silent ongoing notification names the character and reflects actual memory processing, experience ingestion or message generation; idle/quiet/offline states are explicit. The notification opens that character's chat and has **结束常驻**. Ending this session preserves ordinary WorkManager behavior; disable proactive messaging to pause all spontaneous contact.

The local Kotlin service and globally registered Headless JS task use the same visible-session pattern studied in the local countdown project. A minute loop checks status, with at most one local cycle every ten minutes; model calls still require normal intent and interruption gates. Android may kill/restrict the service and force-stop still wins. The session uses a wake lock while running and increases battery consumption. No silent audio or exact-alarm tricks are used. Completing creation starts it when the interview allows initiative and notification permission is granted; existing characters can enable it in settings. Manually ending a session does not restart it automatically. The session is device-specific and is not exported with the character.

Android 14+ uses `specialUse` with a stated use case, since this app does not relay text messages between devices. This declaration is subject to Google Play review; it is not a claim of approval. See [Android foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types).

## Avatar and desktop character

Upload a local avatar in character settings; otherwise an initial-based placeholder is used. **Add her to desktop** requests an Android pinned shortcut. Confirm the system launcher prompt. It opens `nyvemi://chat/CHARACTER_ID` in the same app. Pinned shortcuts require Android 8+ and a supporting launcher. No per-character APK is compiled. Notification and shortcut behavior is implemented in the local Kotlin module under `modules/nyvemi-android`.

## Export / import

A `.nyvemi` v1 file is a ZIP containing `manifest.json` and, optionally, `avatar.bin`. It includes Persona, relationship memories/state, interests, conversation, memory, open loops, future intentions, experiences, notification history, queued extraction and character settings. It excludes Provider config, API keys, diagnostics and device-specific paths.

The UI supports one current companion. Import is available after confirming a reset of the existing companion; it never silently overwrites one. The underlying bundle importer validates ownership/references and writes transactionally. IDs are remapped, the avatar becomes app-private, and proactive behavior is paused until you configure the new device. Current limits: 20 MB ZIP, 12 MB JSON, 5 MB avatar, and 100,000 records per entity collection. Bundles are **not encrypted**; protect them like private chat backups.

## Architecture

```mermaid
flowchart LR
  UI[React Native UI] --> Services[Application services]
  Services --> DB[SQLite repositories + migrations]
  Services --> Provider[Replaceable LLMProvider]
  Worker[Android WorkManager] --> Experiences[Experience sources + appraisal]
  Experiences --> Intentions[Future intentions]
  Worker --> Policy[Local gates + scoring]
  Intentions --> Policy
  Policy --> Provider
  Policy --> Outbox[Persistent notification outbox]
  Outbox --> Native[Kotlin notification / shortcut]
  Native --> UI
```

`src/domain`: models/schemas · `src/storage`: migrations/adapters · `src/providers`: model interface/adapter · `src/characters`, `src/chat`, `src/memory`: domain services · `src/proactive`: heartbeat/intentions/scoring/quiet-hours/policies · `src/experience`: sources/appraisal/interests · `src/transfer`: portable bundles · `src/ui`: views · `modules`: Android bridge.

React components do not create tables. Storage, provider, retrieval and experience sources have replaceable boundaries. [Architecture decisions](docs/ARCHITECTURE.md) · [development record](docs/DEVELOPMENT.md).

## Development

Tested with Node 24, npm 11, JDK 17, Android SDK/build-tools 36 and an API 35 ARM64 emulator. Install Android Studio/SDK, accept SDK licenses and set `ANDROID_HOME` for your machine.

```bash
npm ci
npx expo prebuild --platform android
npm run android
```

This project requires a Development Build, **not Expo Go**. `android/` is regenerated and ignored. Local native module source/config plugins are tracked; native outputs are ignored.

```bash
npm run lint
npm run typecheck
npm test
npm run format:check
./scripts/verify.sh
```

Normal tests use Node's SQLite and deterministic providers/HTTP fixtures. They do not call paid APIs or contain real keys. `npm run test:live` is a separate, explicitly billable test that reads an ignored `.env` or `.env.local`, using `NYVEMI_TEST_API_KEY` (or `DEEPSEEK_API_KEY`), with optional `NYVEMI_TEST_MODEL` / `NYVEMI_TEST_BASE_URL`. See `.env.example`. Keys never use an `EXPO_PUBLIC_` prefix or enter the APK. Live test output uses synthetic dialogue and is saved under ignored `artifacts/`. Developer Mode includes local notification testing, heartbeat history, usage, prompts, queue retry, and a Debug-only real Worker trigger. A local test notification is explicitly labeled and counts toward notification history/caps.

## Build

```bash
npx expo prebuild --platform android --no-install
cd android
./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
NODE_ENV=production ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The generated Expo project's release build currently uses the development signing key for sideload testing. It is not a Play Store signing setup. Configure your own release signing before distribution. The standalone release APK embeds JavaScript and does not need Metro. Do not commit APKs, AARs, build caches, keys or credentials. First builds may download large React Native/Gradle artifacts.

## Privacy and limitations

- SQLite is not SQLCipher-encrypted in this version. Android app-private storage and disabled app backup are used; a compromised/rooted device is outside this protection.
- BYOK inference sends selected context to your chosen provider. Provider errors are sanitized; usage may be unknown when a provider omits token counts.
- Prompt diagnostics are optional, local, bounded and can be cleared. They can contain conversation content.
- Keyword retrieval and rule appraisal are approximate. Model-generated memories can be wrong; review/forget them in Memory Preview.
- Background execution, notification tap routing, pinned-shortcut confirmation, import file pickers and OEM behavior need continued real-device acceptance testing. Automated core tests are not a substitute for those checks.
- No vectors, encrypted bundle format, automatic cloud sync, native text-to-speech, voice calling, consciousness or exact-time delivery.
- `npm audit` still reports inherited Expo/RN toolchain advisories (recorded in the development log). No forced Expo downgrade is applied. Do not expose Metro or test servers publicly.

## Roadmap

Real-device background reliability/acceptance → release signing → retrieval quality/local embeddings → richer experience appraisal → optional encrypted bundles → additional provider/image adapters.

Live2D, 3D, real-time voice, QQ/WeChat, phone-control agents, browser agents, social networks, accounts, payments, servers, cloud sync, agent swarms and dynamic APK generation are outside this MVP.

## Settings and restarting a companion

Use the gear at the top left of Chat. The notification section shows app/channel availability, the current reason a proactive message may be suppressed, and the latest heartbeat result. It links directly to Android app notification settings and battery optimization settings, with a clearly labeled system-notification test that does not call a model or write a chat message. Permission is requested on first app entry; after a denial, the system settings link remains available. Proactive toggles save immediately.

There is no “meet another character” action. **清空当前角色并重新创建** first explains the irreversible scope, then requires the exact current name before the final action becomes enabled. It removes the current persona, conversation, memories, experiences, intentions, related diagnostics/notification records, avatar, and desktop shortcut access. Provider credentials and the usage ledger remain. Exported backup files are not deleted. SQLite erasure markers prevent late asynchronous results from resurrecting erased state; busy conversations/background tasks must finish before reset.

### 明确约好的稍后来信

说“芜湖，一分钟后随便给我发一条消息吧”“你过一分钟来找我”等直接请求时，应用会检查通知、开启可见陪伴，保存本地任务，等待 Android WorkManager 确认登记成功后才确认约定。支持 10 秒至 24 小时的相对时间请求（秒、分钟、小时，中文或阿拉伯数字），最多同时等待三条。聊天顶部显示约定时间及取消入口；清空角色同时取消原生任务。内容到期才根据人格和最近对话生成，不是预先写好的提醒。生成与系统通知失败会退避重试，复用已有 outbox，避免重复生成；通知成功后可在聊天中直接看到。

这类用户明确请求的来信独立于普通主动聊天，不受最近聊天、静默时段和每日主动消息上限拦截。每条约定使用唯一原生一次性 WorkManager 任务，冷启动时直接启动对应 Headless JS，再检查 SQLite 并投递；成功回执依据持久化状态，不能把 JS 函数结束当成通知成功。可见常驻会话存活时另有原生截止时间回调，JS 10 秒检查仅保留为补充。重开 App 会补登记旧版未过期任务，不推迟原截止时间。无到期任务时不调用模型。结束常驻不会取消已约定的来信，需要点击聊天顶部的取消。

这不是精确闹钟。断网、Doze、系统杀进程、强行停止或厂商电池限制仍可能延后执行；强行停止后要重新打开 App。超出约定时间一小时的任务过期。导入角色不会重放旧安装尚未送出的定时任务。Developer Mode 的未来意图、通知历史与 Heartbeat 可追踪排程和失败原因。0.3.1 的手机后台送达效果仍由用户安装验证，不能将本地替身测试等同于实机送达。

聊天生成期间只在顶部显示“正在输入…”。完整回复生成并校验后，分段消息依次淡入并轻轻上移；本地历史不会重复播放入场。聊天列表从底部锚定，以便键盘出现时最新消息和输入框一起上移。

### 从你喜欢的颜色开始

首次开场会问“你喜欢什么颜色呀？”，可以回答“淡粉色，柔和、不太艳”或“蓝灰色，安静一点”。回答先保存在本机；连接 BYOK Provider 后，模型只输出颜色、氛围、饱和度、明暗和冷暖等结构化语义，本地 Theme Engine 生成整套配色。背景、文字、按钮、气泡、表单和导航一起从左上向右下揭开新主题，随后进入原有的 12 题角色访谈。

已有角色从设置顶部的“换成我喜欢的颜色”体验，不必清空角色。支持浅色、深色与恢复粉白；已确认的同一描述不重复调用模型，换色请求计入“颜色偏好理解”的用量记录。模型不可用时，能识别的颜色会明确使用本地配色；无法理解时保留现有主题并请你补充，也可以跳过。

文字与背景的颜色由本地规则约束，支持的配色组合检查正常文字至少 4.5:1 对比度。系统开启减少动态效果时直接换色；截图失败或动画中断也会完成换色。过渡只保留当前页面的短暂旧画面，不会复制导航、会话或模型调用，结束后释放缓存图像，不写入相册、不上传。主题保存在设备内，Bundle v2 携带主题并兼容导入 v1；已有安装环境的主题优先保留。旧版 App 不能读取新版 v2 Bundle，请先升级。
