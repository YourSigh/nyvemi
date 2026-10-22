# 开发审计与阶段记录

2026-10-22：工作区干净，main 跟踪 origin/main，保留 3 次初始化历史与 remote。仅有 README、LICENSE、.gitignore；无现有业务实现、无待重构模块。协议 AGPL-3.0-only。Node 24 / npm 11 / JDK 17 / Android SDK 36 可用，存在 Android 模拟器，无已连接设备。

## 执行顺序

1. Foundation：Expo Development Build、强类型领域、SQLite 迁移、可替换存储、SecureStore、Provider 与测试设施。
2. Persona + Chat：自然问题创建、结构化人格、流式聊天、持久化、有限上下文。
3. Memory：抽取、检索、合并、关系反馈、Open Loop 与 Future Intention 生命周期。
4. Proactive + Experience：本地规则评分、安静时间、限频、WorkManager、经历与兴趣、通知与深链闭环。
5. Android + Transfer：头像、Pinned Shortcut、可验证安全的角色 Bundle 导入导出。
6. UI + Observability：全部页面、Developer Mode、错误与空状态、文档和集成验收。

每阶段执行 lint/typecheck/tests；原生项目产生后尝试 Android assembleDebug。修复后检查 git status/diff，再中文 Conventional Commit。只 commit，不 push。

## 验收边界

自动测试使用显式 Fake Provider，绝不将模拟回复伪装成真实模型结果。真实模型验收需要用户自行输入 BYOK，密钥不进入 SQLite、日志、Bundle。设备验收优先现有模拟器。后台受 Doze、强制停止、厂商电池策略影响；不能把手动 Heartbeat 视为真实后台验收。

## Foundation 验证

- lint / typecheck / 7 项基础测试通过（迁移、事务、隔离、Provider 校验、HTTP/SSE、错误脱敏）。
- Expo prebuild Android 成功；SDK 55 依赖版本检查通过。
- `assembleDebug -PreactNativeArchitectures=arm64-v8a` 成功，首次耗时 21m41s（Gradle 与 236 MB React Native 原生包下载占主要时间）。
- npm audit：已升级 Vitest 至 5.0.5，消除 critical；仍有 Expo/RN 开发工具链传递依赖的 21 high / 5 moderate 告警，不能用强制降级 Expo 的自动建议修复。未启动 Vitest UI 或公网开发服务。

## Persona + Chat 验证

- 自然问题与场景选择、人格生成/开发 Demo、Provider 配置/连接测试、聊天/历史/多段流式显示/失败重试、角色切换页面已接入。
- 不同 Provider origin 不能静默沿用现有 Key。聊天上下文限制 16 条消息与 8 条检索记忆。
- lint / typecheck / 13 项测试通过；Android JS/Hermes export 成功；增量 assembleDebug 成功（5s）。
- 模型测试均为明确的测试 Fixture，尚无用户 BYOK 真实模型验收。

## Memory 验证

- 增加 MemoryRepository / 可替换 MemoryRetriever，中文二元词与英文词匹配、时间、重要性、类型与访问次数参与排名。
- 持久化抽取队列、退避重试、近似合并、expiration、关系反馈和表达偏好适应；Open Loop 创建/完成/忘记会联动 Future Intention。
- 抽取事务与任务完成标记保持幂等；失败不破坏已交付聊天。
- 普通记忆预览页可查看/忘记/完成事件，不展示内部评分。
- lint / typecheck / 18 项测试通过；assembleDebug 成功（3s）。

## Experience + Proactive Core 验证

- LocalTime / Conversation / RSS 来源、RSS/Atom 有界解析、去重、记忆关联 Appraisal、缓慢兴趣变化、Share Intention。
- 安静时间、近期活跃、角色/全局每日上限、最短间隔、过期清理、可解释评分。大部分 Heartbeat 不调用模型。
- 生成后重新检查用户状态；持久化 outbox、投递恢复、通知点击幂等入聊天。
- 本阶段原生通知通过 Gateway 测试替身验证，下一阶段接入 Android 真正调度与通知。
- lint / typecheck / 28 项测试通过；assembleDebug 成功（3s）。

## Android Integration 验证

- Expo TaskManager 全局注册 WorkManager 心跳（最小约 60 分钟）；低频 RSS、到期抽取恢复与主动决策已接实际 runtime。
- Kotlin Module：角色头像通知、稳定通知 tag、消息深链、Pinned Shortcut；新增可再生成的 config plugin。
- 角色设置可配置主动开关、Quiet Hours、每日上限、间隔、RSS；经历时间线已接入。
- 根据用户追加要求，界面与原生头像占位统一粉白主题。
- lint / typecheck / 29 项测试通过；Hermes bundle、Kotlin 编译、assembleDebug、模拟器安装成功。
- `expo run:android` 启动成功，ReactNativeJS Running main，设备上创建 nyvemi.db；JobScheduler 中确认 Nyvemi WorkManager Job，minimum latency 约 60 分钟。
- 当前桌面控制工具无法直接绑定独立 QEMU 窗口；通知点击/桌面确认及真实模型后台闭环仍待后续设备验收，不能仅凭安装成功认定完成。

## Transfer + Developer Mode 验证

- .nyvemi v1 ZIP：严格清单、白名单资产、尺寸/引用检查、已知密钥脱敏、不导出 Provider、重新映射 ID、事务导入、失败清理头像。
- 导入后暂停主动来信；未送达 outbox 不会作为已收到的聊天出现。修复过期/忘记记忆导致的历史意图悬空引用。
- 文件选择/导出分享/导入预览、头像上传；Developer Mode 覆盖人格/状态/兴趣/记忆/检索/意图/经历评估/心跳/通知/API/Prompt/Error/抽取队列/后台注册。
- 提供开发用本地通知测试、完整周期执行、失败任务重试；系统 Worker 测试按钮仅 Debug 可见。
- lint / typecheck / 33 项测试通过；Hermes export 成功；assembleDebug 成功（3s）。

## Polish + MVP 集成验证

- 粉白页面/启动页/原生主色与新图标；错误边界、聊天历史分页、崩溃后恢复、旧消息重试修复。统一源码格式，补齐开发/构建/隐私/验收文档。
- 抽取可读取有限的前文表达，Open Loop 上下文限定 20 条；用户明确要求别主动联系时暂停主动来信；近期关注与角色自身好奇话题逐步更新。
- 已知密钥在诊断和导出边界脱敏；检索文本仅 Developer Mode 开启时记录；RSS 跨来源重复文章去重。
- lint、typecheck、format:check、41 项测试（11 文件）通过；包含真实本地 HTTP/SSE Fixture + SQLite 的角色创建→对话→关系记忆/Open Loop→主动生成/outbox→经历分享→全新库迁移集成测试。Fixture 不等于真实 DeepSeek 回复质量。
- 最终 Debug 构建通过（4s）；Release 构建通过，最终 Expo release 构建/安装耗时 1m19s。安装包含内嵌 Hermes JS，v2 签名校验通过。
- 已关闭本次 Metro，Release 安装启动后日志确认 Running main，未见启动崩溃。最终 APK 包含 arm64-v8a/armeabi-v7a/x86/x86_64，约 74 MB，保存在忽略目录 artifacts/Nyvemi-0.1.0-preview.apk。使用开发签名，仅供侧载验收。
- SHA-256：66b796104bdab5adf8704313c22d3e86d014261cf0a383b68f5a46c976bb216a。
- 当前跟踪树无构建产物或凭据。前一阶段误跟踪原生缓存已通过独立修复提交移除，未改写历史。
- 外部待验收：App 内 BYOK、真实对话质量、关 App 数小时的自然后台通知、通知点击、Pinned Shortcut 与系统文件选择。详见 ACCEPTANCE.md；未将这些项目伪报为通过。

## 用量与费用（后续需求一）

- 独立 SQLite v2 迁移建立 api_usage / token_prices；不依赖会轮转的诊断日志，不导出到角色 Bundle。
- 输入/输出/cache-hit token 来自响应，包括 SSE 结束 usage；中断保留已收到 usage，只记一次。缺失 usage、缓存拆分或单价均标注未知，不以零费用代替。
- 普通用户用量页面提供今天/本月/累计、模型与币种分组、最近请求、每百万 token 手动单价及 DeepSeek 固定档位预设。单价随请求保存快照，后续修改不重算历史。
- 官方价格核对日期 2026-10-22：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ 。默认新配置模型更新到 deepseek-flash，保留已保存的模型选择；旧 deepseek-chat 不套用未知价格。固定档位不能自动匹配时段/节假日，UI 明示估算与覆盖范围，不读取余额。
- lint / typecheck / 45 项测试通过；assembleDebug 成功（12s）。
