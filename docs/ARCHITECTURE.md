# Architecture decisions

- Android first：Expo SDK 55 Development Build，保留生成 Android 工程能力。纯领域模块不导入 React 或 Expo。
- SQLite：版本化迁移、WAL、事务；实体具有类型、角色索引和 JSON payload。API Key 仅由 SecureStore 适配器访问。
- Provider：OpenAI-compatible 适配器，普通聊天 thinking off；SSE 增量解析；结构化结果在入口使用 Zod 验证；错误只保存允许字段。
- Storage / LLMProvider / MemoryRetriever / ExperienceSource / ImageProvider：均有替换边界。
- UI 只调用应用服务。聊天上下文限制最近消息和检索出的记忆，不遍历拼接所有历史。
- 后台：WorkManager → 本地门禁/过期清理/候选评分 → 必要时生成消息 → 持久化通知 outbox → 原生本地通知。没有候选时不调用模型。
- 人格、状态、经历、兴趣仅用于行为建模，不代表意识。
- 迁移：带版本的 .nyvemi ZIP，严格白名单 JSON + avatar 资产；不包含 Provider 密钥、设备路径或诊断 Prompt。
- Native project 为可再生成构建产物；本地 Kotlin module 与 config plugin 纳入 Git。

## 主题过渡与界面动作

ThemeService 负责语义解析、校验和本地配色存储；ChatService 只在明确的界面换色请求下开放 theme 动作，并通过 UI 回调执行动画。ThemeTransitionPorts 将捕获、存储、React 提交、绘制、原生播放和释放串联，失败不能留下阻塞层。Android NyvemiThemeTransition 在自己的 Activity 上绘制旧画面内存覆盖层，以 x+y 方向的柔边渐变揭示底下的新主题。没有第二棵导航树，没有截图文件或图片加载事件依赖。

开源参考评估：[大肥鱼 AstrBot 项目](https://github.com/whyever77/dafeiyu-astrbot) 提供人格、长期记忆、沉默触发主动聊天和真实日程注入等参考。其 AstrBot / NapCat / QQ 与云端部署依赖不直接嵌入本项目；Nyvemi 继续使用 Android 本地存储、原生后台任务和可替换 Provider。本轮未导入其人格文本或代码。

## 会话事实与沉默触发

`conversation/context.ts` 统一派生当前角色的真实日程与未回复状态。`memory/recall.ts` 在请求前独立调用现有可替换检索器。`proactive/reconnect.ts` 在普通聊天事务中保存一次沉默评估，来源是用户消息 ID，任务与原生调度共享现有持久层。恢复遵循终态，导入终态不重启。生成前后检查当前话题与策略；空输出即完成，出错有限重试。未回复计数来自通知的实际投递时间与最新用户消息，按批次计算，不增加数据库表或伪造用户轮次。
