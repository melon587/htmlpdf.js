# 流水线规则

## 概述

`src/main.js` 拥有 **12 步流水线**。步骤必须严格按照以下顺序执行。禁止重新排序、合并或跳过步骤。每个步骤依赖前一个步骤的副作用。

## 步骤顺序

| # | 函数 | 文件 | 目的 |
| --- | --- | --- | --- |
| 1 | `initContext()` | `core/context.js` | 创建 jsPDF doc，计算缩放比例和页面尺寸 |
| 2 | `createClonedDocument()` | `core/document-cloner.js` | 将 DOM 克隆到隐藏 iframe，注入字体 |
| 3 | `collectNodes()` | `core/node-parser.js` | 将克隆 DOM 解析为扁平节点数组 |
| 3b | `preloadImages()` | `core/image-loader.js` | 在 iframe 存活期间捕获所有图片数据 |
| 4 | `destroyClonedDocument()` | `core/document-cloner.js` | 移除 iframe — 此后禁止访问 DOM |
| 5 | `loadFontsToJsPDF()` | `core/font-loader.js` | 将自定义字体注册到 jsPDF |
| 6 | `createRepeatHeaderManager()` | `core/repeat-header-manager.js` | 构建重复表头元数据 |
| 6b | `getPageBreakLinesMap()` | `core/page-break-lines.js` | 构建 pageBreakBorder WeakMap |
| 7 | `streamPaginate()` | `core/stream-pagination.js` | 单次遍历分页 → allPlacements |
| 8 | `collectPageBreakLines()` | `core/page-break-lines.js` | 构建每页的 spill 闭合线 |
| 9 | `renderNode()` 循环 | `render/node.js` | 遍历 allPlacements，渲染每个节点 |
| 10 | `drawSpillClosingLines()` | `render/border.js` | 在表格分页点绘制闭合线 |
| 11 | `renderHeaderFooter()` | `core/page.js` | 调用页眉/页脚渲染回调 |
| 12 | `ctx.output()` | `core/context.js` | 输出 Blob / DataURL / ArrayBuffer |

## 关键不变量

### iframe 生命周期（步骤 2–4）

- 步骤 2–4 共享 iframe 的生命周期窗口。
- `collectNodes()` 和 `preloadImages()` 均在调用 `destroyClonedDocument()` 的 try/finally 内运行。
- 若 `preloadImages()` 失败，iframe 仍必须被销毁——因此使用 `finally` 块。
- 步骤 4 之后，活跃 DOM、计算样式和布局全部消失。禁止在此之后调用 `getBoundingClientRect()`、`getComputedStyle()` 或图片获取。

### 渲染循环中的页面管理（步骤 9）

- `allPlacements` 按页码排序。
- 渲染循环调用 `ensurePage(doc, placement.page, currentPage)` 推进 jsPDF 到正确页面。
- `ensurePage` 为每个缺失页调用 `doc.addPage()`，然后调用 `doc.setPage()`。
- 渲染函数禁止自行调用 `doc.addPage()`。

### 进度报告

- 在步骤之间调用 `tick(stage, progress)` 向 `onProgress` 报告进度。
- 阶段名称：`'clone'`、`'images'`、`'fonts'`、`'paginate'`、`'render'`、`'output'`。
- 进度为 0.0–1.0 的浮点数。
- `debug: true` 启用 `console.log` 计时输出。

## Options 解构（在 main.js 中）

```js
const { output = 'blob', fonts = [], header, footer, tables = [] } = options;
```

- `output`：`'blob'` | `'datauristring'` | `'arraybuffer'` — 传给 `ctx.output()`
- `fonts`：字体配置对象数组 — 传给 `loadFontsToJsPDF` 和 `renderNode`
- `header` / `footer`：`{ height: number, render: (doc, info) => void }`
- `tables`：表格配置对象数组，用于 repeat-header 和 pageBreakBorder

## 添加新的流水线步骤

1. 将新步骤放置在 12 个步骤的正确位置。
2. 若该步骤需要活跃 DOM 访问，必须放在步骤 4（destroyClonedDocument）**之前**。
3. 若该步骤生成 placement 数据，必须放在步骤 9（渲染循环）**之前**。
4. 在新步骤之后添加 `tick()` 调用，使用合适的阶段名称。
5. 在本文件的表格中更新新步骤。

## 修改 `document-cloner.js` — `origIndex` 契约

`node-parser.js` 通过 `origIndex` 同步子节点位置，在克隆树和原始树中并行遍历。这依赖两棵树对所有非注入节点的子节点顺序完全一致。

**规则：** `document-cloner.js` 向克隆树注入的任何节点（如伪元素 span）**必须**携带 `data-*` 标记属性。`node-parser.js` 中的 `walk()` 检测这些标记并跳过，而不推进 `origIndex`。

未带标记注入节点会静默错位 `origEl` ↔ `measEl` 的对应关系，导致坐标和样式错误且不抛出任何错误。

详见 `wiki/node-parser.md` 中的完整双树遍历设计。
