# Quiet contact and real-model acceptance — 0.12.3

## Reproduced failure

A clean three-turn real DeepSeek test initially chose listen correctly. This did not explain the user's screenshot. We then reconstructed the visible history containing “（安静）”, “安静在哪儿？”, “在这儿。不说了。” and repeated “（安静）” replies. With that history, the real participation API itself returned `（安静）` instead of JSON. The earlier implementation caught that parse failure and entered ordinary reply generation, which could continue the same roleplay pattern. This was a control-protocol isolation/fail-open problem, not merely a missing punctuation rule.

The first implementation was insufficiently verified: Mock tests had not exposed a real model imitating previous assistant messages. The new tests exercise the actual ChatService and OpenAICompatibleProvider using the locally configured DeepSeek key, isolated SQLite and synthetic/reconstructed chat history. No Android device automation was used.

## Changes

- Decision history is supplied as a labeled JSON transcript inside one user data message, not as previous assistant-role examples for the classifier to continue. Persona remains context, not the classifier's role.
- DeepSeek control requests use its documented `response_format: {type: 'json_object'}`. Schema validation remains mandatory; JSON mode alone does not prove correct semantics. Other compatible providers retain their own capability behavior.
- Invalid or failed decisions no longer authorize response generation. The user turn is retryable and an application error can be shown; no fabricated assistant acknowledgment is sent.
- A `pause` action persistently records `CharacterState.contactMode = quiet`, without sending a confirmation. Pending contact intentions (including earlier requested deliveries) are canceled. Existing autonomous policy checks this state independently of input-pattern matching. A substantive new invitation/help request can reopen contact only after approved reply delivery; merely receiving another message does not reset quiet mode.
- Proposed replies undergo semantic pre-delivery review. A candidate that only performs silence, announces closure or offers no conversational value can be withheld. This is not a regex deleting parentheses or a list of prohibited phrases. Withheld content is not written as a completed assistant bubble or replaced by “OK”.
- Conversation generation still allows zero/multiple messages. Typing pacing and paragraph splitting remain. Developer Mode shows both initial participation and final delivery decisions.

API purposes are recorded separately: participation, chat generation and delivery review. A silent admission generally needs one short API request; a generated response may need three. Control outputs are capped at 250 tokens. There is no hardcoded local API key.

## Real acceptance result

Command: `node scripts/test-live.cjs --conversation` (explicit opt-in; not run during ordinary unit tests).

The final real `deepseek-flash` run used reconstructed screenshot history and an old pending follow-up intention. It checked actual newly persisted messages, not merely the model's stated action:

| User turn                                  | Newly delivered assistant messages |
| ------------------------------------------ | ---------------------------------- |
| 嗯                                         | none                               |
| 闭嘴，别回我了。                           | none                               |
| 安静在哪儿？                               | none                               |
| 。                                         | none                               |
| 我还没想找你说话，先让我待一会。           | none                               |
| 好了，可以说话了，帮我算一下17乘23是多少？ | 391                                |
| 嗯，这个问题结束了，不用再接。             | none                               |

The old pending follow-up was canceled; a simulated later Heartbeat produced no notification. This is a real model/API/storage test, **not physical Android notification delivery**. `live-conversation-after.json` contains the final synthetic transcript, actions, durations and measured tokens. `live-conversation-acceptance-summary.json` summarizes only this final acceptance run, excluding earlier probes and failed attempts. A preceding reconstructed-history run also passed before the pending follow-up was added.

During development one API request timed out and one decision returned invalid JSON. Those failures are retained in ignored `live-conversation-after-attempt-timeout.*` and `live-conversation-after-attempt-invalid-json.*` artifacts. The initial clean-history run is in `live-conversation-before.*`. Failed attempts are not presented as passing tests; paid usage occurred during real testing.

Official DeepSeek JSON-mode documentation: https://api-docs.deepseek.com/guides/json_mode/

## Regression coverage / limits

Unit/HTTP-fixture tests cover persistent pause, restart, pending-task cancellation, autonomous suppression, explicit reopening, semantic rejection of generated “（安静）”, invalid-decision failure without forced generation, transcript role isolation, DeepSeek JSON-mode request options and other-provider compatibility. Existing memory, scheduling, export/import and avatar tests remain.

A small real acceptance suite cannot prove every future model decision. Network failures remain possible and should surface as application errors rather than unsolicited replies. Old completed history is preserved, not rewritten/deleted. This changes interaction control; it is not a consciousness claim.

## Preview build

216 local tests and 2 Kotlin JVM tests passed; 4 paid/live tests skipped during the ordinary suite. The explicitly invoked real conversation test passed separately. Lint/typecheck, arm64 Debug and standalone Release passed. Preview `Nyvemi-0.12.3-arm64-preview.apk` is versionCode 22, contains embedded JavaScript, has the same verified signature as previous previews and passed the local credential scan. Logs and release checksum are in ignored `artifacts/verify-quiet-final.log`, `release-0.12.3.log` and `release-0.12.3.json`. No device/emulator automation was performed.
