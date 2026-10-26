# Character + Conversation · 0.6.0

本轮按用户 2026-10-26 的完整任务分阶段实现。保留已有 SQLite、记忆、主动来信、Provider、角色创建和主题揭幕；未引入 Live2D SDK、服务器或第二次情绪模型请求。

| 阶段       | 实现                                                                                                                 | 本地验证与提交                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1 骨架     | 克制且居中的顶部栏，约 48% 角色舞台，下方独立聊天视口，固定底部输入；键盘时两区共同收缩                              | lint/typecheck、116 测试、Android Debug、模拟器普通/键盘截图；`a06ce13`      |
| 2 基础动态 | 原创可替换 SVG Q版占位，轻微呼吸浮动，2～6 秒随机眨眼，暂停后不追赶动作                                              | lint/typecheck、117 测试、Debug、模拟器待机录像；`a4b5b37`                   |
| 3 聊天状态 | 类型化 Mapper、聊天事件总线、同轮 emotion/intensity、首 token 说话、完整生成后分段气泡；主动来信成功投递后在前台可见 | lint/typecheck、121 测试、Debug；最终以本地 HTTP SSE 走通界面链路；`76aad09` |
| 4 动作调度 | 思考歪头、嘴型、450ms 开心、300ms 生气、850ms 挥手、害羞/困倦姿态；随机小动作至少约 18 秒，输入/思考时抑制           | lint/typecheck、122 测试、Debug、角色画面检查；`558d110`                     |
| 5 聊天细化 | 浅主题角色气泡、中性用户气泡、时间分组、历史滚动、约定来信小入口与取消列表、系统语音转草稿                           | lint/typecheck、124 测试、Debug、模拟器键盘/消息检查；`e8665ef`              |
| 6 主题     | Chat/Stage/Mock/约定列表统一语义 token，浅深配色正文对比度，保留原生斜向揭幕                                         | lint/typecheck、125 测试、Debug、主题场景检查；`725b474`                     |
| 7 开发工具 | 十种状态和独立动作预览，普通模式关闭、按角色隔离、60 秒自动恢复                                                      | lint/typecheck、127 测试、Debug，模拟器逐个切换十种状态；`db0717c`           |

## 结构

- `src/character/layout.ts`：根据避让键盘后的安全区域和实际输入框高度计算布局。正常手机屏角色约 45～55%，键盘出现后减少比例，角色不会被长文本隐藏。
- `src/character/interaction.ts`：状态/情绪类型、Mapper 和不干扰聊天事务的订阅事件。
- `src/character/motion-scheduler.ts`：眨眼、偶发小动作和互斥时间，不包含 React 或模型调用。
- `src/ui/character/`：舞台、原创 mock、渲染动作、状态订阅和开发预览。业务层发出语义状态，渲染器自己解释为动作。
- `src/character/theme.ts`：当前 Palette 到背景、表面、主色、浅主色、文字、次级文字、分隔线和角色氛围色的映射；插画中性材质集中管理。
- `src/character/debug.ts`：仅内存中保存调试覆盖，不写入持久化角色和导出。
- `src/ui/scheduled-messages.tsx`：约定信息独立收起，不挤压角色舞台。

## 验收证据与边界

使用 API 35 ARM64、只读模式启动的隔离模拟器副本和独立包 `app.nyvemi.presenceqa`。仅使用人为编造的聊天和本机 HTTP 模型 fixture；没有读取用户正式 App 数据或向真实模型发送请求。开发客户端悬浮工具只出现在 QA 截图中，生产安装包没有这个工具入口。

本地证据保存在忽略的 `artifacts/screenshots/`：

- `phase1-character-layout.png`、`phase1-keyboard.png`：原始骨架和键盘避让。
- `phase2-idle.mp4`：轻微待机与眨眼。
- `character-chat-cycle.mp4`：输入 → 思考 → 首流数据说话 → 完整生成后逐条气泡 → 反应/待机。
- `character-long-reply.png`：长文本只在下方滚动，角色持续存在。
- `debug-*.png`：十种手动状态及脸部表现。
- `character-blue-theme.png`、`character-theme-reveal.mp4`：主题联动及过渡。

已验证的是 UI/状态链路与原生编译。没有验证真实模型情绪标注质量、系统语音实录、不同厂商实体手机或真实 Live2D 素材。系统语音服务不可用时有简短错误提示；未新增本 App 的录音权限。原始头像不具备可动画骨骼，不会自动转换成 Live2D；本轮完整交互使用原创可动占位角色。

最终发布验证：127 项测试通过（2 项真实 API 测试跳过），lint/typecheck、Android Debug 与 Release 均通过。APK 为 0.6.0 / versionCode 10，ARM64，35,855,177 bytes；签名与 0.5.0 一致，可覆盖安装。内嵌状态/动作运行时代码、排除 QA 地址和测试 Key、跟踪文件与 APK 密钥扫描通过。SHA-256：6373d541edf682594e5acb234e6604ae0ceb0a19ed47428f45f2cdcf27dcf0d4。全部仅本地提交，未 push。
