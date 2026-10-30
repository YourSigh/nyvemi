# DSH 内嵌改造

## 审计与阶段

0.12.3 的聊天路径固定执行参与判断、文本生成、发送审核；Provider 没有 tool_calls，B 站探索是定期读游客态元数据。这不能提供成熟 Agent 的工具自主性。

保留现有聊天布局、角色 Mesh Runtime、SQLite、SecureStore、WorkManager 和通知桥。

1. **运行时基础**：固定官方 DSH 源码版本，内嵌真实 Cordis、AgentLoop、Session、Tools、NativeExecutor；打包官方浏览器兼容层，验证多步工具循环、静默、参数校验、会话恢复和预算。
2. **聊天与能力桥**：由发消息工具产生气泡，接入记忆、经历、查网页、B 站、主题；原始模型文字不自动发送。保存实际工具轨迹。
3. **后台与交付**：工具登记持久唤醒任务，同一 DSH 核心处理后台唤醒；复用通知和系统后台调度，真 API 验收，构建安装包。

## 固定上游

- 官方：<https://github.com/deepseek-ai/deepseek-harness>
- Commit：`f3803c96974ad4a94195fb97e5c637e9c2a3afe3`
- DSH：`0.2.2-alpha.2`，MIT。原始源码、各包 manifest 与授权保留在 `vendor/deepseek-harness`。
- App 使用核心插件组合，不携带桌面编码工具、终端、Node 子进程或动态插件安装。
- 使用上游 experimental/webworker-runtime 的 Node API 兼容实现与 suspension lowering。先静态打包，再 lower，保留 ESM 循环初始化语义。唯一构建期源码替换是 attribution 的包版本读取，替代 Node createRequire。

## 构建与验证

`npm run agent:bundle` 从 vendored 源码重建核心，生成大小与 SHA256 到 `vendor/dsh-runtime/build.json`。`node scripts/dsh/check-hermes.cjs` 通过当前 Expo Babel 配置转换，再以项目 Hermes 编译器检查 Android 字节码。

基础阶段：lint / typecheck / 220 单测 / 2 个 Kotlin JVM 测试 / Android assembleDebug 通过。真实模型与 App 接入验证属于后续阶段。源码直接交给 hermesc 会因缺少 Metro 转换而失败，验证脚本使用实际 Expo 转换后再检查，不把 Node 测试通过当作 Hermes 兼容证明。

## 边界

DSH 不是只含一个 HTTP 服务的网页；网页是它的一种客户端。这里选择内嵌核心插件树，让前台及 Headless JS 使用相同运行时。并未声称兼容所有 DSH 第三方插件，也不打包 QQ 登录或 SnowLuma。

工具循环能为自主行为提供基础，不代表主观的“活人感”已经验收。Android 后台仍受系统 Doze、厂商省电和强行停止限制。

## 聊天与能力桥（阶段 2）

App 的生产聊天入口改用 `CompanionAgent`。模型通过原生 tool_calls 选择发消息、wait、排程、记忆检索、读取上下文、搜索/读取公开网页、B站候选浏览、形成经历及换色。普通 assistant 文字不会变成用户可见气泡，不再走旧的参与分类/生成/审核三次固定调用。

工具结果进入真实 DSH Session，写入 SQLite `agentSessions`；每次模型请求与有副作用的工具前保存 checkpoint，恢复时通过上游 interruptedTurnClosers 修复未闭合轮次。单次最多 8 个模型步骤、180 秒，保留原有消息节奏。超过会话字数预算开启新 Session，最近聊天和相关记忆仍显式提供。

网页来源保留 evidenceId；只有当前角色真实读到、未过期的证据能成为 Experience。模型 appraisal 通过 schema 验证后复用 ExperienceEngine 与缓慢 Interest 更新。B站游客接口仍仅提供标题简介，遇到接口失败会返回工具失败，不制造浏览结果。公开网页读取限制 HTTPS、跳转次数、大小和时间，并拒绝本地目标与未受控跳转。

费用统计继续进入现有 UsageLedger，purpose 为 `agent_step`。DSH 核心不持有 Provider Key；传输主机从 SecureStore 读取。存储 checkpoint 和诊断经已知密钥脱敏。

阶段验证：lint / typecheck / 226 单测 / 2 个 Kotlin JVM / Android Debug 通过。新增测试用官方 DSH 核心跑通搜索证据 → 保存经历 → 分条发消息、跨轮静默、自然语言约定的工具排程，以及通知 outbox 故障恢复；Provider 原生工具协议单测通过。后台路由和真实 API 验证在阶段 3 完成。
