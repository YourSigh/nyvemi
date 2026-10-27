# Clock, color intent and voice — 0.11.0

## Device clock

Time context already existed, but mixed a formatted local time, UTC instant and past-message timestamps. Chat now awaits provider initialization before reading a fresh native Android Calendar/time-zone snapshot for each turn. The snapshot uses an explicit local date, weekday, 24-hour clock and day period; it says current device time takes precedence over historic dialogue or a fictional separate character clock. JS/background prompt formatting likewise uses an unambiguous local clock. Persona/history remain unchanged. This improves grounding; it is not a guarantee that a language model can never make a temporal reasoning mistake.

Tests cover morning/evening/day formatting, placement after history metadata, and native-clock hook refresh after provider initialization across multiple turns. No paid model requests were made.

## Personal color preferences

The previous gate explicitly refused “我喜欢紫色”. It now accepts self-directed preferences, bare preferences and positive color reactions, alongside explicit commands and English preferences. Model instructions match this behavior. Obvious quotations, hypotheticals, other-person preferences, questions, clothing/object statements and “别换” still do not authorize recoloring. The existing semantic theme interpreter validates confidence and creates the local palette; no arbitrary model hex values are directly applied. This remains a bounded local intent heuristic, not perfect understanding of every ambiguous sentence.

## Theme reveal lifecycle

Application-level input locking covers keyboard dismissal, layout settlement, native capture, persistence, palette commit, paint and diagonal reveal. Children stop receiving touches; an input shield and transition-scoped back handler block app navigation; the native reveal layer owns key focus and consumes keys/touches. Accessibility descendants are hidden during the short transition. Every exit path releases the overlay and restores the React lock. System reduced-motion mode still applies. System/home controls are not disabled.

The transition interface requires `settleInput`, with order/failure tests. Keyboard dismissal waits for the hide event with a bounded fallback, then the layout gets a paint before capture. Pressing inputs during this interval cannot start new app actions.

## Startup visual

The default character is the hand-authored Mock placeholder, including already-saved Mock rigs. It is hidden on ordinary chat/appearance screens and while the real character loads. Selected real mesh/Seedream artwork remains visible. A developer-only explicit preview may still show Mock art. The splash/launcher icon is unchanged, following the user clarification that the issue was the default character.

## Hold-to-talk

The gesture behavior was informed by the existing countdown chat/accessibility implementation: hold, release, upward threshold and slide-back restoration. Nyvemi implements it in its own Android module/controller; it does not contact countdown's server.

- Tap the microphone to enter voice mode after granting RECORD_AUDIO; a keyboard icon returns to text entry.
- Hold to speak; partial recognition is displayed only in the composer. Release sends the final recognized **text** to the existing chat service. It does not send an audio attachment.
- Drag up over 56 layout points and release to cancel; drag back before release to resume. Very short presses are discarded. A hold ends at 60 seconds.
- Each recognition session has an ID. Canceled/replaced sessions, gesture termination, loss of focus, theme input locking, backgrounding and unmounting cannot send a late result.
- Native final results received before release are cached until release. Stop has an eight-second bounded wait. Recognizers and pending promises are cleaned up on cancellation/background/module destruction.
- Existing typed draft is preserved while a voice message is sent. Switching characters remounts/cancels the old hold session.
- A stale generated Android `tools:node="remove"` microphone marker was found and fixed in the config plugin. The merged manifest now contains RECORD_AUDIO and the Android 11+ recognition-service query.

Recognition uses the installed Android SpeechRecognizer service, requests offline preference and the device locale, and may still use the network depending on that service. Missing/disabled services, permission denial and errors are surfaced. No audio files or transcripts are written by this feature before the user releases to send; final sent text becomes ordinary conversation history. No additional API keys are required.

## Validation

184 tests pass, three paid tests skipped; lint/typecheck and Android Debug build pass. Tests include gesture reversal, slide cancellation, short-release/start races, late results after cancellation, maximum duration, clock refresh and transition release after failure. Android Kotlin and generated manifest were checked by build. Physical-device/emulator self-testing was not performed, per user instruction. Installed system ASR availability/accuracy and final keyboard/gesture feel still require user installation acceptance.

Implementation commits: `fc7ef61` (clock/color/placeholder/lock) and `c68f7af` (hold-to-talk/input lifecycle). No push.

## Release

`artifacts/Nyvemi-0.11.0-arm64-preview.apk`: app.nyvemi.android, versionCode 17, arm64, 40,184,733 bytes. SHA-256 `f8d2b324a5a94691d869d36fef89cab544699d497da4d2087c3f45f58b643ce0`. Debug/standalone Release builds succeeded; APK scan against actual local credentials passed. Release manifest includes RECORD_AUDIO and the recognition-service query. Signature matches 0.10.1 for ordinary upgrade. No push.
