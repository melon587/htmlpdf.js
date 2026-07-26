# 分页设计 — 深入解析

## 概述

`src/core/stream-pagination.js` 中的 `streamPaginate()` 对扁平节点数组执行**单次从左到右遍历**，生成 `allPlacements`——一个已排序的渲染指令列表。

无需第二次遍历，无需回溯。节点一旦被分配到某页，该决策即为最终结果。

## 输入 / 输出

```
输入：nodes[]              来自 node-parser.js 的扁平节点数组
      ctx                  上下文对象（页面尺寸、缩放比例）
      repeatHeaderManager  预构建的重复表头元数据

输出：{ totalPages, allPlacements }
```

`allPlacements` 是一个按 `page` 排序的数组，同页内按渲染优先级排序：

1. spill placements（从上一页延续的元素）
2. repeat-header placements（每页顶部注入的 thead 行）
3. normal placements（本页自然开始的元素）

同一优先级组内按 `dfsIndex`（DFS 前序索引）排序，天然保证 TABLE → TBODY → TR → TD → text 的正确渲染顺序。

## `streamPaginate()` 中的核心变量

| 变量 | 类型 | 含义 |
| --- | --- | --- |
| `accumulatedYpx` | number | 已消费内容的累计 px（全局 Y 游标） |
| `currentPage` | number | 当前正在填充的页码（从 1 开始） |
| `pageStartOffsets` | Map | `pageIndex → { pageContentTopPx, pageActualBottomPx, headerHeightPx }` |
| `nodePlacements` | Array | 每个节点的 normal placement，用于后续 spill 展开 |

## 换页决策：`needsNewPage(node)`

在放置每个节点之前调用，若应在当前节点之前换页则返回 `true`。

触发换页的条件（满足任意一条即换页）：

1. **自然溢出** — `node.y >= currentPageBottom`，节点顶部已超出当前页底部。

2. **`break-before: page`** — `node.pageBreak === 'before'`，显式请求换页。

3. **`break-inside: avoid`** — `node.pageBreak === 'avoid'` 且节点放不进当前页剩余空间。

4. **文本保护** — 父节点有 `avoid` 且该文字行会溢出，防止孤行出现在页面底部。

5. **隐式 avoid** — `TR`、`SVG`、`VIDEO` 标签自动表现为 `avoid`。

## `calcNextPageStart(page, repeatHeaderManager)`

决定换页后，`calcNextPageStart()` 计算下一页的新 `accumulatedYpx`。

若表格有重复表头，表头高度会加到页面起始偏移，使内容从重复表头下方开始。

## Spill 元素

高度超过 `contentHeightPx` 的元素无法放入单页，必须跨页"溢出"（spill）。

### 检测

单次遍历结束后，`expandSpillPlacements()` 检查每个 `nodePlacements` 条目：

```
若 nodeBottomPx > pageContentTopPx + contentHeightPx
   → 元素溢出（spill）
```

rowspan TD/TH 使用 `rowSpanActualBottom`（分页后修正值）而非 `y + height`。

### Spill Placement 生成

`expandSpillPlacements()` 为元素跨越的每个额外页面生成一个 placement：

```
第 P+1 页：offsetYpx = pageStartOffsets[P+1].pageContentTopPx
           isLastSpill = (P+1 是该元素跨越的最后一页)
```

`offsetYpx` 将元素在渲染坐标空间中上移，使每页显示正确的视觉切片。

### `isLastSpill` 标志

- `isLastSpill = false`：元素继续延伸到下一页。背景延伸到整页高度，下边框不绘制。
- `isLastSpill = true`：元素在本页结束。背景裁剪到节点底部，绘制下边框。

## 重复表头

当 `tables[i].repeatHeader` 已配置时，`<thead>` 行会在表格跨越的每一页顶部重复出现。

### 准备阶段（`repeat-header-manager.js`）

`collectHeaderMetas(nodes, tables)` 遍历节点数组，为匹配 `tables[i].selector` 的表格识别 `<thead>` 子树。

每个 `headerMeta` 存储：

- thead 节点及其子节点
- 表格的首页和末页（分页期间计算）
- 表头高度（px）

### 分页时注入

在 `streamPaginate()` 内部，每次换页时：

```
headerMeta = repeatHeaderManager.getHeaderMetaForNode(node)
if (headerMeta && currentPage > 1)
  placements += generateRepeatHeaderPlacements(headerMeta, currentPage, accumulatedYpx)
```

`shouldSkipOriginalHeader()` 对第 2 页及之后的原始 `<thead>` 行返回 `true`，防止重复渲染。

## `buildNodeLastPageMap()`

单次遍历结束后，部分容器节点跨越多页但在 `nodePlacements` 中只有一条记录。`buildNodeLastPageMap()` 通过取所有子节点最大页码冒泡到祖先，计算每个节点实际的最后页：

```
对每个以 _origEl 为键的节点，向其所有祖先（parentElement 链）冒泡最大页码
```

这决定了容器元素的 `isLastSpill`。

## Placement 排序

所有 placements 合并后通过 `comparePlacements` 排序：

1. **页码升序**
2. **同页内按 `placementOrder`**：
   - `0` — 非 rowspan 的 spill（TABLE/TBODY/TR 等容器）→ 最先铺底
   - `1` — repeat-header
   - `2` — normal（含普通 TD/TH）
   - `3` — rowspan TD/TH 的 spill → 最后画，覆盖同页普通 TD
3. **同 `placementOrder` 内按 `dfsIndex`** — DFS 前序天然保证 TABLE→TBODY→TR→TD→text 的正确顺序

> **注意：** 历史上曾有独立的 `paintOrder` 字段（按 CSS §17.5.4 分层），已移除。DFS 前序本身即保证正确的绘制顺序，`paintOrder` 为冗余。

## Spill 闭合线

`streamPaginate()` 返回后，`collectPageBreakLines()` 使用 `allPlacements` 识别哪些表格容器在表格中间有分页符，并为每个分页位置记录"闭合线"条目。

`render/border.js` 中的 `drawSpillClosingLines()` 在每页最后一个可见行的底部绘制水平线，在切割点创建视觉表格边框。

通过 `options.tables` 中的 `tables[i].pageBreakBorder: '1px solid #ccc'` 配置。

## 示例：有重复表头的多页表格

```
第 1 页：
  ┌─────────────────┐
  │  thead（重复）   │  ← repeat-header placement，page=1
  ├─────────────────┤
  │  tbody 行...    │  ← normal placements，page=1
  │  （spill 继续）
└─────────────────┘  ← 此处绘制闭合线

第 2 页：
  ┌─────────────────┐
  │  thead（重复）   │  ← repeat-header placement，page=2
  ├─────────────────┤
  │  （spill）       │  ← tbody 容器的 spill placements，page=2
  │  tbody 行...    │  ← normal placements，page=2
  └─────────────────┘
```
