# 月胚展示与互动 · 0.19.3

## 展示区域

正常聊天视口下角色区域为 230–250dp，随实际屏幕宽度微调；大屏新增空间归聊天区域。键盘显示时显式将区域限制到不超过约 145dp，不再仅依赖视口变小的推断；更小视口继续按剩余空间收缩。多行输入时保留聊天可见。

初生角色画布正常约 218–226dp，相比原来常见的约 245dp 缩小约 10%，不会再随大屏增长。空间主要由区域高度上限节约，不把角色缩成头像。原图使用 contain 等比完整显示；按实际宽度与高度取较小边，预留轻微悬浮和触碰动作的安全边距。角色仍然居中。

## 初生之茧

新素材 `assets/characters/moon-cocoon-v2.png` 使用内置 imagegen 工具，参考原月胚图与旧素材进行重绘。侧身抱膝、闭眼，身体为乳白色抽象发光体、银白淡紫的拟态发丝，外层为独立月光折射与光丝；不再使用衣裙、衣袖或垂落布料。旧素材保留在工程中，但正式初生组件改用 v2。没有调用用户的豆包 Key。

## 互动与限制

- 待机：轻微悬浮、呼吸光晕、三个沿光茧漂流的独立光点。
- 轻触：月光涟漪扩散、角色轻轻抬起再落下、短暂光晕回应。
- 长按：持续按住时进入更慢的安抚呼吸，松开恢复；不发送无意义聊天气泡、不调用模型。
- 思考/说话：光晕更明显；思考时光粒稍快。形象保持闭眼，符合初生阶段，不声称是新的 Live2D Rig。
- 系统减少动态效果开启时，保留静态亮度反馈；后台停止循环并清理触碰计时器，回前台再恢复。所有循环使用 native driver 且 isInteraction=false，避免长期占用交互句柄影响聊天列表渲染。

独立光点和光晕是实时效果；插画内部的光丝线条仍是静态绘制。本轮没有重做已生成角色的 Mesh/Physics Runtime。

## 取名前的称呼

默认与加载占位统一为 Nyvemi。旧草稿仅在尚未完成取名、答案名字为空且角色仍使用旧默认“小小”时，本地更新为 Nyvemi。已取名（包括用户明确选择“小小”）和其它手动改名均保留，不为迁移额外调用模型。

## 最终素材提示词

```text
Redesign Nyvemi's nascent moon-cocoon character. The second reference supplies ONLY the side-view curled knees-hugged pose, sleeping face and moonlight cocoon concept. The first reference shows the current asset's failure: it looks like a white-haired girl wearing a flowing robe. REMOVE that robe and ordinary human-girl appearance entirely. Deliver one original Japanese anime illustration of a magical NONHUMAN spirit made of milky white light. Side-view, floating curled up, arms embracing bent knees, eyes closed. Genderless, anatomically simplified smooth opaque opalescent light-silhouette with softly translucent glowing edges, no skin texture, no realistic human anatomy, no gender-specific details. Its torso and pelvis are an uninterrupted abstract radiant form, without flesh details. A tiny quiet face and just a few silver-white/pale lilac hair-like light wisps, not a full human hairstyle. The creature has no fabric garments: absolutely no robe, skirt, sleeves, drapery, cloth folds, ribbons that look like clothing, or trailing white dress. The separate protective cocoon is made of refracted moonlight: 3 or 4 delicate curved translucent light filaments wrap around the curled compact silhouette, visibly enclosing it in an asymmetric open crescent oval, with a few floating motes. The light cocoon must read as living flowing energy, not a physical egg shell, plastic object or costume. Soft milky body, lavender edge light, tiny silver-blue highlights, clean exquisite drawn anime linework, dreamy healing atmosphere, restrained bloom. Clear silhouette readable at 200px, NOT photorealistic, NOT 3D. Compact suspended pose, a slightly diagonal and balanced near-square composition, complete character, hands, curled feet and whole crescent visible, narrow safe transparent margin about 6%, no huge empty canvas. Actual transparent alpha background, no sky, no ground, no framed scene, no UI, no words, no watermark. Retain clarity on both pale pink-white and dark navy app backgrounds. This is an abstract luminous fantasy being; keep all forms modest, opaque and non-anatomical.
```

## 验证结果

lint / typecheck 通过；403 个自动测试通过，17 个真实接口测试默认跳过。覆盖常见屏宽、推荐回复/多行输入的 footer 高度、键盘显示但视口仍较高的情况、绘画完整适配、触碰/长按、后台清理、减少动态效果和名字迁移。

Android arm64 Debug / Release 构建通过；Release 内嵌 JS、开发凭据与开发专用角色资产扫描通过。模拟器验证 Nyvemi 默认名、完整角色、轻触涟漪和键盘收缩，应用错误日志为空。启动恢复时曾出现模拟器 System UI 无响应提示，等待并重开应用后恢复，未出现 Nyvemi 的 AndroidRuntime 崩溃。

安装包：`artifacts/Nyvemi-0.19.3-arm64-preview.apk`。截图和约 12 秒的实际互动录屏：`artifacts/cocoon-0.19.3/`，其中 `keyboard-final.png` 是显式键盘收缩后的最终结果，`interaction.mp4` 展示待机、轻触和长按。录屏由 Android 编码器回落为 720×1280，原始截图仍保留完整屏幕分辨率。
