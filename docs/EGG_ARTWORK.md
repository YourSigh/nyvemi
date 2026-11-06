# 开场蛋插画（0.19.1）

使用内置 imagegen 工具生成，未调用用户的豆包 Key。工程资产：`assets/characters/egg-expressions.png`，1254 × 1254 RGBA，保留原始透明度。

这是 2 × 2 表情图集：左上待机、右上闭眼、左下说话、右下思考。运行时按等分单元裁切显示，不把四颗蛋一起展示，不叠加代码绘制的五官。图集仅用于创建阶段的蛋，不替代用户生成角色的 Mesh Runtime。

保留呼吸和触碰反馈；闭眼和张嘴使用绘制表情，切到后台暂停动画。蛋的浅珠白底色固定，周围光晕跟随用户主题。角色区仍沿用原来约 1/3 屏幕以及键盘弹出收缩的布局。

## 最终生成提示词

```text
Use case: stylized-concept
Asset type: production transparent character sprite atlas for Nyvemi Android companion app.
Primary request: redesign a plain egg mascot as an exquisitely illustrated, warm, endearing little companion egg. A pearl porcelain eggshell, softly iridescent opal sheen, delicate tiny embossed petal/star details, a few restrained champagne-gold hairline accents, warm translucent blush and lavender light under the shell. Cute tiny expressive dark eyes and mouth integrated naturally into the painting. Premium hand-painted anime game asset / collectible miniature with convincing soft volume, subtle brush texture and tactile porcelain, not vector clipart, CSS illustration or generic app icon. Keep it unmistakably a single egg, no limbs, wings or accessories.
Composition: ONE square PNG transparent sprite sheet, exact equal 2 by 2 cells, each cell containing the EXACT SAME egg registered at the same center, same silhouette, size, lighting and material. Generous transparent margins, complete object visible, no overlap between cells. Top left: idle, eyes open, small relaxed closed smile. Top right: blink, eyes softly closed, same smile. Bottom left: talking, eyes open, small gently open mouth. Bottom right: thinking, eyes looking slightly upward, subtle curious expression. ONLY change face expression, no pose, camera, shell, scale or perspective changes between cells. Each egg occupies about 72% of its cell height, with a tiny soft contact shadow contained within its cell.
Scene/backdrop: genuinely transparent alpha, no colored background, no checkerboard painted into image.
Text: none. No labels, panel frames, borders, typography, watermark, logos, or extra objects. Detailed but readable at 180px mobile display size. A pale neutral pearl base must remain visible on both light and dark app themes. This is a real raster game character asset, not a mockup.
```
