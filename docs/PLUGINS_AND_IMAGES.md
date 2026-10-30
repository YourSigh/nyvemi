# Plugins, learning and images — 0.14.1

## What is implemented

The existing embedded DSH, chat page, character renderer, SQLite and background host are reused.

1. `54bd654`: installable and reversible plugin system. JSON source/file imports, Markdown skills, procedural learning, bounded interpreted workflows, permissions, dynamic DSH declarations, same-turn invocation and version history.
2. `9801a3d`: picture messages, visual observation, cached image generation, image sending, independent model configuration, media cleanup and Bundle v5. Plugin workflow bindings also support bounded nested JSON and safe previous-result paths.
3. Release: real model acceptance, documentation, final build and APK validation.

“Evolution” here means learning reusable methods and composing tools into new workflows. It does not retrain weights, edit the APK, add Android permissions or install native desktop dependencies. Desktop npm/Node/Python DSH plugins are not claimed to run unchanged.

## Use in the app

- **Settings → 技能与插件**: enable/disable autonomous learning, install a source URL or local JSON/Markdown, review additional permissions, disable, export, roll back or remove. GitHub `/blob/` links are normalized to raw source URLs.
- Ask the character to remember a method, e.g. “先给结论，再给来源”. `learn_skill` saves it and later sessions load it.
- Ask to combine existing tools into a reusable method. `develop_plugin` validates and stores a package; `run_plugin` can invoke it immediately. Active tools also become direct DSH tool declarations on the next run.
- **Chat ＋**: select up to three PNG/JPEG/WebP images, each at most 6 MB and 8192 pixels per side. Send pictures alone or with text; tap a sent image to view it. Voice, keyboard handling and stage size are retained.
- **Settings → 图片与识图**: “使用聊天模型识图” defaults on, reusing the current chat model, endpoint and Key. DeepSeek `deepseek-flash` supports image input; no extra visual credential is needed. Drawing stays on Seedream with its own Key. Turning the switch off exposes custom visual endpoint/model/Key fields. Existing 0.14.0 custom visual records remain custom, so turn the switch on to adopt the default. Same-origin custom visual/drawing services may share the image Key. Saving settings makes no image/model request.
- Enable chat drawing if desired; background drawing has its own switch. Generation returns a cached local image ID, then DSH chooses whether to send that image. Ordinary drawing prompts do not inherit the rig's front-facing character constraints.

## Package format

Example: `assets/plugins/research.nyplugin.json`.

```json
{
  "format": "nyvemi-plugin/v1",
  "id": "my-reading",
  "name": "找阅读资料",
  "version": "1.0.0",
  "description": "找一篇感兴趣的内容",
  "instructions": "搜索片段不是全文；真正读过再分享。",
  "permissions": ["web"],
  "tools": [
    {
      "name": "find",
      "description": "按主题搜索",
      "inputs": { "topic": "string" },
      "steps": [{ "operation": "web_search", "args": { "query": "{{input.topic}}" } }]
    }
  ]
}
```

IDs and tool names use 2–24 lowercase ASCII characters/digits/underscores/hyphens. Input values are string/number/boolean. Step args allow bounded JSON; variable bindings preserve JSON types when the value is a whole token. `{{step.0.0.url}}` reads the first result's URL from step zero using own-property traversal; no JS evaluation is used. A maximum of four steps, six tools/package, 24 packages/character and 24 direct dynamic declarations bounds work/context. Additional installed tools remain callable through `run_plugin`.

Permissions map to host operations: `context`, `web`, `memory`, `experience`, `schedule`, `images`. A package must declare the operation's permission. New image rights wait for explicit approval; normal host image/delivery/quiet-hour rules still apply. Disabling a plugin is preserved across agent updates. Every workflow step rechecks current version, enabled state and grants; no recursive plugin, shell or arbitrary credentialed HTTP capability is exposed.

Markdown skills are optional method material, not new system rules. Skills cannot alter host permissions or contact boundaries. Learned updates bump the patch version; installed package updates require a higher version. Five prior manifests are retained. The user can stop autonomous installations without disabling already installed tools.

## Images and providers

`MediaAsset` records own-character file references; messages retain attachment IDs. `MediaService` validates ownership before reading, generating or sending. DSH gets handles and observations, rather than base64 bytes. `inspect_image` calls the selected OpenAI-compatible API using `image_url` data URLs. The default reuses the chat route and credentials; it does not read the drawing Key. [DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/) confirms `deepseek-flash` image input. Unsupported official DeepSeek model names prompt the user to choose Flash; failed requests never silently fall back to paid Ark. The cache identity includes the resolved endpoint/model, so switching the chat provider invalidates that route's observations. Thinking is disabled for both official DeepSeek and Ark vision calls.

[Ark's official image-understanding documentation](https://console.volcengine.com/ark/region:cn-beijing/docs/image-understanding) documents image input with both Chat API and Responses API. The implementation uses Chat Completions. Model availability depends on the user's account; no fallback pretends to have seen an image when credentials/model access are missing.

Vision calls record purpose `image_understanding` and actual token usage when provided. Repeated same-image/question/model observations reuse cache. Chat image generation records actual POST requests as `chat_image_generation`; cache hits are not counted as new API requests. Per-character daily generation attempts include uncertain outcomes. Provider responses persist before download, so download retries do not repost a paid generation. Cancellation reaches both the generation request and CDN download. An uncertain POST remains guarded by the existing Seedream request cache.

Keys remain in origin-bound Android SecureStore/Keystore entries. Image bytes, keys and provider headers are not added to DSH checkpoints or developer metrics. Known chat/image/vision credentials are redacted from DSH diagnostics/session persistence. Files and role-scoped media/analysis/draw-request records are erased with the character; removing an unsent draft deletes its image only when no message references it.

## Transfer

Bundle v5 carries referenced chat-image bytes and plugin manifests. Image/message IDs are remapped on import; missing, foreign or unreferenced files are rejected. The existing ZIP/JSON size bounds remain. Imported plugins are disabled with no grants, and credentials are excluded. Visual/drawing provider setup remains device-local. Legacy bundles without pictures/plugins retain their prior format; v1–v4 imports still work.

## 0.14.0 validation

- Default: 249 offline tests, lint, typecheck, Expo/Hermes compilation, 2 Kotlin JVM tests and Android Debug build pass.
- New tests cover installation/restart, dynamic DSH invocation, learned skill reuse, version rollback, permission hold/approval, preserving disable across update, mid-workflow disable, safe data binding, unsupported code rejection, Markdown/GitHub import, uploaded picture → visual observation → DSH response → generated image bubble, caching/ownership, tokens/credentials, generation permission/uncertain budgets, no-request settings save and image/plugin migration.
- Real DeepSeek: `node scripts/test-live.cjs --extensions` made six model requests. The model generated a reusable `topic-reader` search plugin, recovered from an invalid permission/schema attempt, saved `conclusion-first`, and described its persisted methods after a fresh Agent instance. Artifact: `artifacts/live-extensions.json`. No fixed script selected its tools.
- This round did **not** invoke paid Ark image generation or vision. The visual wire protocol and image flow use injected fixtures for automated validation. The optional one-request live vision runner is opt-in and defaults off; `.env`/`.env.example` include the new fields. No `.env` key is bundled into the app.
- No physical-device testing, as requested. Installation, gallery UX and real visual-model quality are user acceptance items. Android background restrictions remain as documented for DSH/WorkManager.

The real extension acceptance used 24,422 input tokens and 908 output tokens across six model requests, including the failed schema attempt. No Ark vision/generation request was made in this development round.

Standalone ARM64 preview: `artifacts/Nyvemi-0.14.0-arm64-preview.apk` (versionCode 24, 40,979,653 bytes). Android Release build and APK signature verification pass; embedded Hermes JS is present, and a scan of APK entries found no known local development credentials or `.env` files. Preview signing uses the existing debug certificate, not a production Play signing identity.

SHA-256: `baa086696f4a74e757f05490f3bba680ab324ad61101ca9eeb641bdc90d79d77`.

## 0.14.1 correction and acceptance

Vision now defaults to the configured chat model/Key; Seedream remains independent for drawing. Previous explicit custom visual endpoints are preserved. Regression tests cover chat credential routing, legacy custom credentials, provider-switch cache separation, unsupported models, no paid-provider fallback and independent drawing-key saves.

`node scripts/test-live.cjs --vision` sends at most one real DeepSeek request. Using the existing ignored local test Key, Flash identified the synthetic fixture as “左半边是红色，右半边是蓝色。” (249 input tokens, 10 output tokens). Inspecting the same image/question again reused cache with no second request. No Ark vision or generation call was made, and no physical device was used.

Full 0.14.1 checks pass: lint, typecheck, 254 offline tests (9 live tests skipped by default), Expo/Hermes compilation, 2 Kotlin JVM tests and Android Debug/Release builds. ARM64 preview: `artifacts/Nyvemi-0.14.1-arm64-preview.apk`, versionCode 25, 40,980,837 bytes, same preview signing certificate. Signature verification, embedded-JS presence and known-development-credential scan pass.

SHA-256: `739f15d8ff7569d297ae913876465d50a01538fa5c25fee584ee1063dae6bbec`.
