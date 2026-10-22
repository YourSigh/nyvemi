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
