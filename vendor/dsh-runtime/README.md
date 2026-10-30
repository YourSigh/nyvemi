# Embedded DeepSeek Harness

Built from the MIT-licensed official DSH core pinned in `../deepseek-harness/UPSTREAM.json`.
`npm run agent:bundle` reproduces `index.js` from the vendored source closure and the Nyvemi composition in `scripts/dsh/`.

This embeds the real Cordis / AgentLoop / Session / SystemPrompt / Llm / Tools / NativeExecutor plugins. It is not the DSH HTTP UI, a Node subprocess, or a rewritten agent loop. Android Headless JS and the foreground app run the same bundle.

Platform adaptations: official browser `node:path`, crypto, util/types and AsyncLocalStorage faces; the official suspension lowering runs **after** static bundling to preserve circular ESM initialization. Package attribution reads the pinned version at build time instead of Node createRequire. Small standard-library compatibility additions support Hermes. No Node filesystem, terminal, dynamic plugin installation, CLI, telemetry, or host-level computer tools are bundled.

The source closure and original MIT notices are retained under `../deepseek-harness/`. Browser compatibility is an upstream experimental surface. Tests verify the specific composition shipped here, rather than promising compatibility with every DSH plugin.
