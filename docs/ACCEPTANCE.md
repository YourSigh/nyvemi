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
- Release 包含内嵌 Hermes JavaScript，v2 签名校验通过；开发签名侧载包 `artifacts/Nyvemi-0.1.0-preview.apk`（约 74 MB，多 ABI，Git 忽略）。
- 最终 lint / typecheck / format:check / 41 项测试（11 文件）通过；构建和日志不代表 UI 全流程已验收。
- 设备上创建 `files/SQLite/nyvemi.db`、WAL/SHM。
- JobScheduler 确认 `app.nyvemi.android/androidx.work.impl.background.systemjob.SystemJobService`，最小延迟约 60 分钟。
- 调试用 `cmd jobscheduler run -f app.nyvemi.android 0` 后，原生日志确认 `BackgroundTaskWork: doWork: Running worker`。
- 强制触发证明 Worker 入口确实执行，不代表自然时机、冷启动、通知送达或几小时闭环已经验收。

## 外部条件

1. 真实模型验收需要用户在 App 内填写自己的 Key；未读取其它项目的凭据，测试不调用付费模型。
2. 当前电脑控制工具不能直接绑定独立 QEMU 窗口；已尝试 Android Studio 观察途径，未把无法确认的 UI 点击写成通过。
3. Android 通知权限、启动器确认、厂商电池策略及强制停止恢复需要目标设备测试。

## 建议的设备走查

安装独立、带内嵌 JS 的 APK → 配置 Provider 并测试连接 → 回答角色问题 → 吐槽与反馈 → 说一个之后值得问的具体事件 → 在角色设置允许通知与主动来信 → 回到桌面，等待机会性后台任务 → 点击实际通知核对角色与聊天内容 → 导出 → 在另一个安装环境导入 → 检查头像/记忆/对话。期间可用 Developer Mode 解释每次发送或跳过。

只有上述真实闭环完成，才能将 MVP 标记为全部验收完成。
