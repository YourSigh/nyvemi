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

## 后台与交付（阶段 3 / 0.13.0）

- HeartbeatEngine 的生产入口把 requested / continuation / reconnect / share / follow-up 交给同一 `CompanionAgent`；Headless JS 不依赖聊天页。WorkManager 与常驻服务的原生调度保留。
- `schedule_wakeup` 持久登记任务，调用 Android 调度确认后才报告成功。用户明确约定与自主念头分开；明确约定若模型没有真正发消息，不会记为已送达，而是退避重试。
- `wait` 仅结束当前活动；`pause_contact` 才保存用户明确要求的联系边界并取消未来安排。后台等待不能自行变更联系偏好。DSH 会话不再使用旧的关键词沉默/重连生成规则。
- 原子保存消息与 outbox；OS 未收到通知时 native receipt 保持失败，下一次只恢复 outbox，不重新生成文本。过期、取消及安静状态在模型返回后重新检查。
- 新用户输入可取消背景模型请求，等待回收后获得同一 Agent。前台 180 秒、后台 110 秒预算，最多 8 个模型步骤；后台预算低于原生 150 秒回调时限。无到期任务时不为检查本身调用模型，自由探索最多每四小时一次。
- Developer Mode 记录工具名、成功与否、简短动作理由、查询来源、唤醒原因及 Session 状态；不显示私有推理。通知栏可随读资料、记忆、写消息等活动更新。
- 模型 appraisal 的 topics 参与缓慢兴趣变化，避免语义匹配已在模型完成、却因中英文关键词不同而无法更新兴趣。
- 长期运行适配：上游 AsyncLocalStorage shim 的 disable 从实例集合移除已销毁上下文，run/enterWith 再加入，避免 App 每轮重建 Context 后积累实例。原始包版本读取在构建时替换；其它 AgentLoop / Session / Tools 逻辑保持上游实现。`runtimeStats` 测试验证释放后 ambientStores=0。

### 实际验收记录

`node scripts/test-live.cjs --agent` 使用 `.env` 中的真实 DeepSeek Key，通过实际 DSH 与 OpenAI-compatible 传输执行：

1. “先别说话，我还没想好说什么，不用回复我。” → 无消息。
2. “。” → 无消息。
3. “可以说话了，17乘23等于多少？算完不用追问我。” → 单条“391”。
4. “芜湖，一分钟后随便给我发一条消息吧，我现在退到后台测试通知。” → 真实排程工具；新建 CompanionAgent 读取 SQLite 会话，到达逻辑到期时间后通过发送工具产生两条消息，投递一条通知。
5. 请求读取 Expo 官方文档 → 模型实际调用 web_fetch，得到页面标题与内容，再分条回答，并保存有证据的 Experience。

主链路成功运行 14 次模型请求、56,679 input tokens、1,173 output tokens。前两轮失败分别 9 次请求：第一轮暴露约定与自由唤醒未区分，第二轮暴露 wait 把待发通知当作暂停联系取消。失败工件保留在 ignored `artifacts/live-dsh-agent-attempt1/2.*`，修复后成功工件为 `artifacts/live-dsh-agent.*`。这些都是实际模型费用，不把失败调用算成零。

`node scripts/test-live.cjs --agent-autonomy` 额外运行一次无用户新请求的自由活动。真实模型自主调用两次 B站候选浏览、一次网页搜索，最后 wait，理由是没有找到值得分享的内容；未伪造 Experience，也未发通知。此过程 4 次模型请求。Mock 集成测试另外覆盖有兴趣的证据 → appraisal / interest 更新 → 稍后唤醒 → 通知完整链路，避免依赖真实模型每次都产生分享欲。

2026-10-30 无模型来源探测：Bing RSS 返回 6 条真实搜索结果，B站游客接口返回 8 个候选（保留 title/description-only 标记）。之前的 HTTP 412 不代表永久不可用；当前成功也不保证后续不会受限。报告：`artifacts/dsh-public-sources.json`。

以上后台验证是在新 JS service 实例中恢复持久状态，推进逻辑到期时间并使用通知网关；**没有声称在实体 Android 手机执行过 WorkManager**。按用户要求不做真机自测。UI/角色动画、系统送达与主观角色质感由用户安装 APK 验收。

### 最终验证与限制

- lint、typecheck、234 个离线测试、2 个 Kotlin JVM 测试、Expo 转换及 Hermes 编译、Android Debug / Release 构建通过。
- 默认测试跳过真实付费请求与外部来源探测；真实验收单独显式开启。
- 预览版本 0.13.0 / versionCode 23，沿用既有预览签名，可覆盖更新；密钥不打包。
- 不兼容所有桌面 DSH 插件；未包含 Node/Python 子进程、QQ、登录、评论、点赞或真实视频解码。游客 B站工具读取元数据，不是字幕/帧观看。
- DSH 协议 checkpoint 是当前固定上游版本的设备运行数据，不进入角色 Bundle。导入仍恢复人格、记忆、经历、对话和角色资产，并从这些资料开启新 DSH Session；旧安装未发出的任务不会重放。
- 会话达到 180,000 字符预算后开启新协议 Session，仍提供最近 16 条聊天、最多 8 条相关记忆及工具可检索的经历，避免无限上下文与后台费用。
- Android Doze、厂商省电、断网和强行停止仍可能延迟来信；没有将 DSH 内嵌宣传成可绕过系统后台限制。

本轮真实模型合计（含两轮失败与额外自主活动）：36 次请求，128,404 input tokens、2,522 output tokens；不含无模型的公共来源探测。统计工件 `artifacts/live-dsh-usage-summary.json`。未用推测单价冒充实际扣费金额。

APK：`artifacts/Nyvemi-0.13.0-arm64-preview.apk`，40,927,053 bytes；SHA256 `1240796912c4a7e6f1d36deca2d394ece09a29f72d5fe78b3e04212bba5ecc78`。包含独立 Hermes bundle；已检查没有 .env 文件及本机配置的已知密钥；预览签名 SHA256 沿用 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`。
