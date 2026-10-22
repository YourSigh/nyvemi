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
