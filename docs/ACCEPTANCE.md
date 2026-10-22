# MVP 验收记录

日期：2026-10-22。**不把测试替身结果等同于真实模型/真机验收。**

| 场景         | 已验证                                                                                             | 仍需验证                                            |
| ------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| A 角色创建   | 真实 HTTP 协议 Fixture → Persona schema → SQLite；创建页面已接入                                   | 用户自行配置 DeepSeek Key 后完整点选与模型效果      |
| B 自然聊天   | SSE 中文增量、JSON 预览过滤、多段间隔、聊天持久化、边界 Prompt、失败/重启恢复                      | 真实模型的语气、首 token 延迟、键盘和滚动手感       |
| C 关系记忆   | 抽取、去重、表达偏好更新、检索排名与后续上下文；集成测试                                           | 多轮真实对话下的提取质量                            |
| D Open Loop  | 创建 → 时间窗口 → 本地评分 → 发送时生成 → 通知 outbox → 点击入聊天；集成测试                       | 真实设备关 App 数小时后的实际通知与文案             |
| E 不骚扰     | 连续 25 次无候选 Heartbeat 零模型调用；安静时间/活跃抑制/每日上限/间隔/过期/生成后二次检查         | 厂商 ROM 与用户真实使用中的频率体验                 |
| F Experience | RSS/Atom 解析、去重、记忆关联、Appraisal、缓慢兴趣更新、Share Intent、上下文分享集成测试           | 真实 RSS 网络和真实模型分享效果                     |
| G 桌面角色   | Kotlin Shortcut 编译通过，使用同一 APK 的角色深链                                                  | 启动器固定确认、头像显示、点击定位真实角色          |
| H 迁移       | 全新 SQLite 导入；人格/状态/兴趣/记忆/聊天/经历/意图/头像/通知/任务数据；错误回滚；无 Provider/Key | Android 文件选择/分享、新安装设备文件导入与头像显示 |

## 实际 Android 证据

- JDK 17、SDK/build-tools 36、API 35 ARM64 模拟器。
- Debug / Release APK 构建、安装成功；关闭本次 Metro 后 Release 启动，ReactNativeJS `Running main`，未见启动崩溃。
- Release 包含内嵌 Hermes JavaScript；本轮安装包为 `artifacts/Nyvemi-0.2.0-arm64-preview.apk`，ARM64 开发签名侧载包，Git 忽略。
- 本轮 lint / typecheck / format:check / 55 项测试（14 文件）通过；构建和日志不代表 UI 全流程已验收。
- 设备上创建 `files/SQLite/nyvemi.db`、WAL/SHM。
- JobScheduler 确认 `app.nyvemi.android/androidx.work.impl.background.systemjob.SystemJobService`，最小延迟约 60 分钟。
- 调试用 `cmd jobscheduler run -f app.nyvemi.android 0` 后，原生日志确认 `BackgroundTaskWork: doWork: Running worker`。
- 强制触发证明 Worker 入口确实执行，不代表自然时机、冷启动、通知送达或几小时闭环已经验收。

## 外部条件

1. 真实模型验收需要用户在 App 内填写自己的 Key；未读取其它项目的凭据，测试不调用付费模型。
2. 已通过 Android Studio Running Devices 操作模拟器：验证开发桶砸、角色设置、通知授权、常驻开启、通知打开聊天、退回桌面继续运行、结束常驻和再次打开 App 不自动恢复。访谈首页已打开，尚未逐页完成 12 轮 UI 验收。
3. Android 通知权限、启动器确认、厂商电池策略及强制停止恢复需要目标设备测试。

## 建议的设备走查

安装独立、带内嵌 JS 的 APK → 配置 Provider 并测试连接 → 回答角色问题 → 吐槽与反馈 → 说一个之后值得问的具体事件 → 在角色设置允许通知与主动来信 → 回到桌面，等待机会性后台任务 → 点击实际通知核对角色与聊天内容 → 导出 → 在另一个安装环境导入 → 检查头像/记忆/对话。期间可用 Developer Mode 解释每次发送或跳过。

只有上述真实闭环完成，才能将 MVP 标记为全部验收完成。

## 0.2.0 追加需求验收

- 用量账本：缓存 Token 拆分、费用公式、缺失数据标记、请求幂等、币种分离、历史价格快照、流中断计量和计量失败不诱发付费重试均有测试。
- 共创访谈：12 轮有限进度、跳过、草稿/未提交输入恢复、断网明确本地引导、完成后生成幂等均有测试。真实模型的回应质量与完整键盘流程仍待人工走查。
- 常驻：API 35 模拟器实际通知显示“桶砸 · 常驻陪伴 / 安静陪着你，主动来信尚未开启”，带结束按钮。dumpsys 确认 `isForeground=true`、`foregroundId=73021`、`specialUse`。
- 点击通知进入对应角色聊天。回到桌面约 3 分钟后通知和前台服务仍存在；点击“结束常驻”后通知/服务移除，再次打开 App 未自动重启。截图保存在忽略目录 `artifacts/presence-notification.jpg`。
- 用量和访谈领域测试使用显式模型测试替身，不是实际 DeepSeek 计费。模拟器手动输入本地 URL 时电脑输入工具丢失冒号，后续坐标操作又失去窗口绑定，未将这段未完成的界面走查标记通过。未放宽 URL 校验绕过问题。
- 常驻通知仅验证实际状态与服务生命周期；主动来信的真实模型、数小时后台、不同厂商省电策略仍需目标设备验收。
