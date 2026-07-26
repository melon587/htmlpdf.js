# 渲染层规则

## 渲染入口点

`src/render/node.js` 中的 `renderNode()` 是**唯一**的公共渲染入口。它根据 `node.type` 分发到子渲染器：

| `node.type` | 调用的子渲染器 |
| --- | --- |
| `'element'` | `drawBackground` → `drawBorder` → `drawImage`（IMG/CANVAS 时） |
| `'pseudo-element'` | `drawBackground` → `drawBorder`（无文字内容时止步于此） |
| `'text'` | 仅 `drawText` |

禁止从渲染层外部直接调用 `drawBackground`、`drawBorder`、`drawImage` 或 `drawText`——始终通过 `renderNode()`。

## 跨页裁剪（`clipBottom`）

所有渲染函数接收一个 `clipBottom` 值（mm），由以下计算得出：

```js
clipBottom = toMM(pageActualBottomPx - offsetYpx);
```

这是当前页可渲染的最大 Y 坐标（相对于节点左上角，单位 mm）。渲染函数必须将输出裁剪到此边界。

`clipTop`（mm）在有 repeat-header 时等于 `toMM(clipTopPx)`，防止 spill 背景/边框覆盖重复表头区域。

### Spill 行为

| 场景      | `isLastSpill=false`（中间页） | `isLastSpill=true`（最终页）  |
| --------- | ----------------------------- | ----------------------------- |
| 背景      | 延伸到整页高度                | 裁剪到节点实际底部            |
| 左/右边框 | 每页都绘制                    | 每页都绘制                    |
| 上边框    | 仅在第一页（nodeTop ≥ 0）     | 仅在第一页                    |
| 下边框    | 不绘制                        | 绘制（节点底部 ≤ clipBottom） |

## 背景（`src/render/background.js`）

绘制顺序（从后到前）：

1. **纯色** — 通过 `setFillColor` + `rect` 绘制 `background-color`
2. **线性渐变** — 由 `gradient.js` 解析，渲染到 canvas 切片，通过 `addImage` 添加
3. **背景图片 URL** — `node.bgSrc`（预加载的 base64），通过 `calcBgImageSize/Pos` 定位

### 支持的 `background-size` 值

- `cover` — 缩放以覆盖元素，必要时裁剪
- `contain` — 缩放以适应元素内部，必要时留白
- `auto` — 使用图片原始尺寸
- 显式 px/% 值

### 支持的 `background-position` 值

- 关键字：`top`、`bottom`、`left`、`right`、`center`
- 显式 px/% 值

### 已读取但未渲染的 CSS 属性

- `border-radius` — 已采集但**未渲染**（jsPDF 没有原生带裁剪的圆角矩形）

## 边框（`src/render/border.js`）

- 边框以独立的 `line()` 调用绘制。
- `parseBorderString(borderStr)` 将 `border-top`、`border-right` 等解析为 `{ width, color }`。
- 宽度为零或透明的边框会被跳过。
- `drawSpillClosingLines()` 在表格分页出口处绘制水平闭合线，使用 `pageBreakBorder` 配置（来自 `tables[].pageBreakBorder`）而非节点自身的边框样式。

## 图片（`src/render/image.js`）

- 来源始终是 `node._srcCanvas`——`preloadImages()` 期间预加载的 canvas 元素。
- 使用临时离屏 canvas 从源 canvas 裁剪出可见切片 `[visibleTopPx … visibleBottomPx]`。
- 裁剪后的 canvas 转换为 base64，通过 `doc.addImage()` 添加。
- 若 `canvasHasAlpha()` 返回 true 则格式为 `'PNG'`，否则为 `'JPEG'`。

## 渐变（`src/render/gradient.js`）

- `parseLinearGradient(str)` 将 CSS `linear-gradient(...)` 字符串解析为 `{ angle, stops }`。
- 支持的方向关键字：`to top`、`to bottom`、`to left`、`to right`、`to top left`、`to top right`、`to bottom left`、`to bottom right`
- 也支持角度值（如 `45deg`）。
- `renderGradientSlice()` 仅渲染当前页的切片（而非完整节点高度），避免超高元素的内存问题。

## 文字（`src/render/text.js`）

- `drawText()` 是主入口。
- 文字渲染支持**多字体分段**：单个文本节点可跨越多种字体，不同字符通过 `unicode-range` 匹配不同字体配置。
- `segmentTextByFont()` 将字符串拆分为 `[{ text, font }]` 分段。
- 每个分段用 jsPDF 的 `getTextWidth()` 测量，然后按对齐方式定位。
- 对齐：`left`、`center`、`right`——相对于节点边界框计算。
- RTL：通过 `node.style.direction === 'rtl'` 检测，使用 jsPDF 的 `R2L` 选项。
- `applyTextStyle()` 在 jsPDF doc 上设置字号、颜色和不透明度。
- `resolveTextLayout()` 计算文字基线 Y 坐标：`toPdfY(node.y) + toMM(fontSize)`。

## 添加新渲染功能的规则

1. 元素上的新视觉效果 → 添加到 `background.js` 或新文件，从 `renderNode()` 调用。
2. 新边框样式 → 添加到 `border.js`。
3. 新文字功能 → 添加到 `text.js`；对字体感知的文字使用 `segmentTextByFont()`。
4. 禁止在任何渲染函数内添加 `doc.addPage()` 或页面导航。
5. 禁止读取活跃 DOM——所有数据必须来自 `node` 对象。
6. 传给 jsPDF 的所有坐标必须通过 `ctx` 辅助函数转换为 **mm**。
