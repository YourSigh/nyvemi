# 模块参考记录

2026-10-25 审阅以下公开源码。本次按机制独立实现 TypeScript 模块；没有引入 Python 运行时、QQ 服务、远端管理端、遥测、原角色人格文本或额外 API。Nyvemi 继续使用 AGPL-3.0-only。

| 来源                                                                                                                                        | 审阅位置                                                                                                                                                                                                                                                             | Nyvemi 接入                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [proactive_chat](https://github.com/Pancakes-Labs/astrbot_plugin_proactive_chat)（AGPL-3.0）                                                | [scheduler_service.py](https://github.com/Pancakes-Labs/astrbot_plugin_proactive_chat/blob/main/core/services/scheduler_service.py)、[context_service.py](https://github.com/Pancakes-Labs/astrbot_plugin_proactive_chat/blob/main/core/services/context_service.py) | `src/proactive/reconnect.ts`：沉默触发、持久恢复、独立会话、未回复控制；`src/conversation/context.ts`：明确当前是主动开口，不伪造用户消息 |
| [大肥鱼 schedule_awareness](https://github.com/whyever77/dafeiyu-astrbot/blob/main/plugin/astrbot_plugin_schedule_awareness/main.py)（MIT） | 每轮读取真实会话日程，限制会话归属                                                                                                                                                                                                                                   | `src/conversation/context.ts`：每轮读取未完成意图，限定角色、过期时间和条数；取消立即生效                                                 |
| [LivingMemory](https://github.com/lxfight-s-Astrbot-Plugins/astrbot_plugin_livingmemory)（AGPL-3.0）                                        | [event_handler.py](https://github.com/lxfight-s-Astrbot-Plugins/astrbot_plugin_livingmemory/blob/main/core/event_handler.py)、README 的召回与整理分离                                                                                                                | `src/memory/recall.ts`：请求前独立召回，指代短句结合最近用户话题；继续复用本地关键词评分、访问强化和后台提取                              |

审阅文件的 Git blob SHA，按表格顺序：

- scheduler_service.py：`881edb46828c76dfd9b99556adca1619e6aa207f`
- context_service.py：`b365772159cfd8f4891957524c8e64b3340db377`
- schedule_awareness/main.py：`e7ea53a667be583fdc99af74c5043cd9e3363063`
- LivingMemory/event_handler.py：`890df05f239eae03b01fba8ff6bbf401b0f00ece`

## 接入行为与限制

- 有意义的普通回复完成时，保存一次 12～25 分钟后的沉默评估；不是每轮保证发送。寒暄、沉默收尾、明确要求独处、界面动作和约定来信不会因此再生成重复候选。
- 到时先用本地规则检查：新消息、安静时段、未回复次数、实际来信间隔、每日上限和更具体的待办。通过后才调用模型，允许多条回复或空数组。空数组终结该次评估，后台恢复不会再次创建同一轮任务。
- 沉默触发与独立主动话题共用每日额度，已存在的短时余念仍有自己的频率限制。所有自主来信在连续两次未获用户回复后暂停；明确约好的来信不计入这项计数。
- 新消息会取消旧沉默任务；读取状态和生成后的再次检查限制过时发送。普通与沉默主动生成共享投递锁，防止不同入口同时绕过额度检查。
- 原生单次 WorkManager、进程恢复、可选常驻服务复用当前实现。Android 省电、断网、强制停止仍影响实际时机，不能用服务器项目的在线时序代替真机送达证据。
- 失败最多三次，期间有本地退避；不让十秒检查变成重复收费。没有添加自动日常问候或 QQ 动态。
- 导入的沉默任务过期，源消息 ID 重映射后也不复活旧任务。开发模式和脱敏来信报告可查看状态与跳过原因。

本轮仅做本地 fixture、模拟时钟和构建验证；按用户要求不进行设备或付费模型自测。
