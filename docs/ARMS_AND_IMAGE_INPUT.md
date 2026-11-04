# 手臂与拆层图片输入修复（0.18.0）

旧实现将两手放在同一个 `arm` 层，再绕完整画布中心旋转。挥手因此带动两手并把连接处移开。这版请求 `left_arm` 与 `right_arm`，袖子和手持物归各自手臂，渲染按每个部件的实际附着点旋转，并以躯干中心识别左右侧，兼容偏心构图。另一侧独立保持轻微呼吸。

已有素材通过 Android 读取 alpha，在确实存在透明间隙的位置分成左右两个显示区域。原图片和静态坐标不变。分析失败或图案相连、无法可靠区分时保持该层静止，避免把一整块素材转离身体。前向中立姿势是主要支持范围，复杂交叉、举手和被遮挡关节的素材仍需人工验收或重新拆层。

拆层输入现在先由 Android 解码、按 EXIF 转正，再重编码为标准 PNG。用实际解码尺寸校验像素数、宽高比和 Base64，转换结果按内容缓存。新候选指定 PNG 输出。[服务文档](https://docs.volcengine.com/docs/ark/seedream-5-0-pro?lang=zh)支持 PNG/JPEG 拆层输入，要求至少 262144 像素、宽高比在 1:16 到 16:1 之间。原始文件扩展名不是编码依据。

本次真实验证共 2 次 Flash 拆层请求。原 JPEG 请求复现了 `InvalidParameter / image`，没有收到图片。标准 PNG 请求成功返回底图加 7 层，含两张独立手臂。DS 静态核对为 `identity=match`、`layersUsable=true`、`hiddenAreaQuality=uncertain`。这组结果支持重编码处理，但单次对比不能证明所有 `image` 错误都由 JPEG 编码造成，截图那次服务端的完整原因也未取得。

请求缓存键保持兼容，旧成功图层直接复用。明确被拒绝的操作可以在用户重试时使用规范化输入，结果不确定的请求继续阻止重发。没有自动切换到付费更高的模型。

Android 15 模拟器中安装了 Debug APK，运行真实聊天页，分别载入旧合并手臂与本次新拆出的双臂素材。点击挥手截图确认一侧转动、另一侧留在原位，轴心位于连接处。通过同一原生模块检查了旧素材 alpha 分离及 JPEG→PNG 的 2048×2048 实际尺寸。实测还发现 `transformOrigin: undefined` 会导致 RN 报错，已改成缺少轴心时省略该属性并增加回归覆盖。眼睛和嘴的细节纹理改用完整缩放以减少小图采样块状感。

ADB 当时只检测到测试模拟器，真机 USB 调试连接仍待用户完成。开发测试数据位于忽略目录，未恢复任何内置默认角色。

- `artifacts/live-arm-split/result-first.json` 与 `result.json` 记录两次真实请求及缓存复用。
- `artifacts/arms-qa/new-idle.png`、`new-wave.png` 记录新素材的实际 Android 页面。
- 同目录的 `idle.png`、`wave-middle.png` 记录旧合并素材兼容性。
- `artifacts/verify-arms-final.log` 记录 lint、typecheck、353 项离线测试、Kotlin 单元测试及 Android Debug 构建通过。

桌面 API 验证使用已有开发立绘和 Node 的 PNG 重编码器，Android 原生重编码在模拟器单独验证。没有取得手机上的原始运动员素材，不能宣称已验证该张图的所有隐藏区域。当前测试固定上限 2 次新拆层请求，旧任务的额度记录均保留。

独立 Release 包为 `artifacts/Nyvemi-0.18.0-arm64-preview.apk`，版本 `0.18.0`、Android `versionCode=36`，37,343,547 字节。沿用此前预览包测试签名。最终 Release 构建及 APK 素材/凭据扫描通过。

SHA256 为 `5cf1eae9580056823dd2544e13bf9fa73129d4534857711e3ae34ee1ec81b4d4`。最终检查日志为 `artifacts/verify-0.18.0.log`、`artifacts/release-0.18.0.log`。353 项离线测试通过。仅提交，未 push。
