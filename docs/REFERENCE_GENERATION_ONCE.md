# Authorized single-image validation — 2026-11-03

The user authorized **one additional Seedream image-generation request**, no decomposition and no automatic redraw. This is separate from the previous exhausted image-test allowance.

## Actual result

- Command: `node scripts/test-live-reference.cjs --allow-one-image`.
- Input: `q版的原神纳西妲，可爱一点`.
- Reference: the previously retrieved/inspected 米游社 character poster, reused locally. No new reference search.
- Model: the production default `doubao-seedream-5-0-pro-260628`.
- Prompt and request: the shipped version-3 `referenceGenerationPrompt`, actual Base64 reference image, `2K`, one candidate. Not a separately optimized test-only prompt.
- One API POST was attempted, recorded before network I/O in `artifacts/live-reference-generation/budget.json`. The one-request ceiling is persistent. No second POST was made.
- The service returned **HTTP 400** after about 95 seconds. No generated image was delivered. No decomposition or DS image-quality review followed.
- The real test failed; the result is not described as a successful rendering/accuracy validation. Local evidence: `artifacts/live-reference-generation/result.json` and `artifacts/test-live-reference-generation.log`.

The then-shipped provider handler discarded the fine-grained error after exposing only the HTTP status. That diagnostic gap was avoidable. The original response/code cannot be recovered locally after the request finished. Its exact cause is therefore unknown. A 400 alone cannot establish invalid image parameters, content review/copyright restrictions, or inability to draw the character. No billing conclusion is inferred from the status or missing usage.

The one authorized image request has been consumed. This task did not rerun it, switch image models, decompose, or make another paid image call to obtain better diagnostics. The actual generated appearance remains unverified.

## Diagnostic repair

`src/appearance/errors.ts` parses only allowlisted structural fields: HTTP status, constrained error code, a known parameter name, and a constrained request ID from selected headers/body fields. Exact known image credentials are excluded. Raw provider messages, prompts, image content and headers are not persisted as diagnostics.

Definitive client rejections now retain a `rejected` receipt with safe error metadata. An explicit future user retry is possible; no automatic retry was added. Ambiguous server failures retain `started`, keeping the existing prohibition on reissuing an uncertain paid request.

The user sees a concise category-specific message. “错误详情” is folded and can show code/request ID during onboarding too. Developer Mode includes recent request states/errors. This repairs diagnosis; it does not claim to repair the unknown reason for this specific 400.

Offline regression tests simulate distinct 400 causes, key echoes, safe request-ID extraction, rejection persistence, explicit retry vs uncertain-failure blocking, and folded error details. Real-image tests remain skipped by default. Do **not** rerun the live one-image test as a default check.

Relevant provider reference: [Ark error codes](https://docs.volcengine.com/docs/ark/error-codes?lang=zh). The documented 400 categories include parameter errors and separate input/output content-review errors. None is attributed to the original request without its missing code.

No physical-device or emulator test was performed. Production error handling changed, so a standalone 0.16.1 preview is built for installation.

## Verification and delivery

Offline suite: 322 passed, 13 optional live tests skipped. Lint, TypeScript, Kotlin unit-test task and Android Debug/Release builds pass. The separate real-image test remains **failed** (HTTP 400); these offline/build successes are not evidence of rendering accuracy.

Standalone preview: `artifacts/Nyvemi-0.16.1-arm64-preview.apk`, versionCode 32, 37,326,343 bytes. Original preview signing certificate retained. Embedded-JS, developer-asset/preset and local-credential scans pass.

SHA256: `a9e7544579bb7b84fab14d12586fb7e8b7e1ce441c76c72d683cc05a261d342e`.

Further diagnosis needs the provider-side error code/log for the original request (2026-11-03, approximately 17:46–17:48 Asia/Shanghai), or a separately authorized new request. The current one-request budget stays exhausted; this repair does not reset it.
