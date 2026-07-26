# 坐标系统

## 三个坐标空间

本库使用三种单位空间，绝对不能混用。

| 空间       | 单位 | 使用场景                                                |
| ---------- | ---- | ------------------------------------------------------- |
| **DOM/px** | 像素 | 节点坐标、计算样式、图片尺寸                            |
| **PDF/mm** | 毫米 | jsPDF API 调用（`doc.rect`、`doc.line`、`doc.text` 等） |
| **PDF/pt** | 点   | 仅用于字号（`doc.setFontSize`）                         |

## 像素空间

- 所有节点坐标（`node.x`、`node.y`、`node.width`、`node.height`）均为 **px**。
- 坐标在 `collectNodes()` 期间通过 `rootElement.getBoundingClientRect()` 测量，原点为根元素左上角。
- `contentHeightPx = contentHeight(mm) / scale` — 单页内容区高度（px 单位）。
- 分页器中的 `accumulatedYpx` 是已消费内容的累计 px 计数器（全局 Y 游标）。

## 缩放因子

```
scale = contentWidth(mm) / rootElement.width(px)
```

缩放因子将 px 距离映射为 PDF 页面上的 mm 距离。  
在 `initContext()` 中计算一次，存储在 `ctx.scale`。

## `ctx` 坐标转换辅助函数

所有单位转换必须通过这些辅助函数完成，禁止直接做原始算术：

```js
ctx.toMM(px);
// 将距离从 px 转换为 mm。
// 用于宽度、高度、偏移量。
// = px * scale

ctx.toPdfX(x);
// 将节点左边缘 x（px，相对于根元素）转换为 PDF 绝对 X（mm）。
// = margin + x * scale

ctx.toPdfY(y);
// 将节点顶边缘 y（px，相对于根元素）转换为 PDF 绝对 Y（mm），
// 已计入边距和页眉高度。
// 但在渲染循环中，y 必须先减去 offsetYpx：
//   effective_y_px = node.y - offsetYpx
//   pdfY = ctx.toPdfY(effective_y_px)
// = margin + headerHeight + y * scale

ctx.toPdfYmm(ymm);
// 与 toPdfY 相同，但接收 mm 输入（跳过缩放）。
// 用于已有 mm 值但需要加上 margin+header 的场景。
// = margin + headerHeight + ymm

ctx.toPt(px);
// 将 px 转换为点（pt），用于字号。
// = px * scale * 2.8346
```

## 渲染循环中的 `offsetYpx`

每个 placement 携带一个 `offsetYpx`：

- normal placement（单页元素）：`offsetYpx = pageContentTopPx`（当前页内容区全局起始 y）
- spill placement 在第 N 页：`offsetYpx = pageStartOffsets[N].pageContentTopPx`

在渲染函数内部，节点顶部的有效 px 坐标为：

```
effectiveTopPx = node.y - offsetYpx
```

对应的 PDF Y 坐标为：

```
pdfY = ctx.toPdfY(effectiveTopPx)
     = margin + headerHeight + effectiveTopPx * scale
```

## `clipBottom` — 页面裁剪边界

```
clipBottom (mm) = ctx.toMM(pageActualBottomPx - offsetYpx)
```

`clipBottom` 是当前页可见的最大 Y 坐标（mm，相对于节点左上角）。所有渲染函数必须将输出裁剪到 `[0 … clipBottom]`。

`clipTop` 在有 repeat-header 时等于表头高度（mm），确保 spill 背景不覆盖重复表头区域。

- **最后一个 spill 页**（`isLastSpill = true`）：`clipBottom` 等于节点实际底部。
- **中间 spill 页**（`isLastSpill = false`）：`clipBottom` 等于整页高度。

## 边距与页眉空间

PDF 页面的垂直布局如下：

```
┌─────────────────────────────┐  ← y = 0
│  margin（mm）                │
├─────────────────────────────┤  ← y = margin
│  页眉区域（headerHeight）    │
├─────────────────────────────┤  ← y = margin + headerHeight
│                             │
│  内容区                      │  ← 节点坐标映射到此区域
│  （contentHeight mm）        │
│                             │
├─────────────────────────────┤  ← y = margin + headerHeight + contentHeight
│  页脚区域（footerHeight）    │
├─────────────────────────────┤
│  margin（mm）                │
└─────────────────────────────┘  ← y = pageHeight
```

`toPdfY()` 始终加上 `margin + headerHeight`，确保节点落在内容区内。

## 常见错误

| 错误 | 正确做法 |
| --- | --- |
| 将原始 px 值传给 `doc.rect()` | 使用 `ctx.toPdfX(node.x), ctx.toPdfY(node.y)` |
| 将原始 mm 值传给 `doc.setFontSize()` | 使用 `ctx.toPt(node.style.fontSize)` |
| 手动将 margin 加到坐标上 | 使用 `toPdfX` / `toPdfY`，它们已包含 margin |
| 计算 Y 坐标时忘记减去 `offsetYpx` | 始终使用 `effectiveTopPx = node.y - offsetYpx` |
| 对宽度/高度使用 `toPdfY` | 距离用 `toMM`，位置用 `toPdfX/Y` |
