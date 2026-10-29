# Contextual participation — 0.12.2

The 0.12.1 literal full-stop suppression was a scenario patch. It is removed. All ordinary inputs, including punctuation, now reach the same model-backed participation decision. There is no input-pattern silence blacklist, random ignored-message ratio or forced silence quota.

Before generating response text, the replaceable LLM provider receives a short decision request with Persona, character state, bounded recent conversation, relevant memories, current device time, proactive setting and real pending intentions. The protocol is `reply`, `listen`, or `defer` with a concrete future thought. The prompt asks whether speaking adds conversational value now, whether the other person is still expressing themselves, and whether anything remains to be answered. It prioritizes actual questions/help/distress without implementing lists of trigger strings. It requests only an action, not chain-of-thought reasoning.

- Reply: generate the ordinary zero-to-many-message outcome, then retain existing paragraph normalization and length-based delivery. Generation may still choose zero messages.
- Listen: persist a completed silent user turn, without a placeholder assistant bubble or automatic generic reconnect. Memory extraction still runs and is recoverable.
- Defer: persist silence plus a concrete continuation even without an immediate reply. Existing settings, supersession, expiry, quiet hours and limits govern later reconsideration. It is not a promise to send.

Explicit scheduled-delivery acknowledgments remain deterministic application operations. Authorized theme operations can still run if the participation decision chooses silence. Provider/decision formatting failures fall back to the normal response path and record `participation_fallback`; an internal failure must not silently discard a request. Cancellation does not take that fallback. Developer Mode exposes the chosen participation action and message ID, without private reasoning.

Ordinary turns now add one short model request (purpose `conversation_participation`, maximum 250 output tokens) before response generation. This adds latency and usage; it appears in the existing API usage ledger. Silent decisions skip the response-generation request. No additional API key storage is introduced. The chat lease is extended to cover both model requests and bounded paced delivery.

## Verification and limits

211 local tests and 2 Kotlin JVM tests pass, including same text with distinct contextual decisions, full-stop inputs reaching the provider, no generated placeholder on listen, extraction of silent turns, deferred intentions without immediate replies, opt-out, invalid-decision fallback, and the HTTP fixture end-to-end flow including the new API call. Lint/typecheck and Android Debug/Release are validated for this preview.

These tests verify orchestration using controlled provider responses. They do **not** establish that a real DeepSeek model makes human-like decisions reliably in arbitrary conversation. No paid API or device testing was performed. The participation policy is a single reusable decision boundary that can be evaluated and improved without adding eight hundred input exceptions. This implements character behavior, not consciousness or a claim of being a real human.
