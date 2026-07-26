# 分页规则

## 核心概念

分页是**单次遍历**的：`src/core/stream-pagination.js` 中的 `streamPaginate()` 对扁平节点数组遍历一次，生成 `allPlacements`——决定每个节点在哪一页、在什么 Y 偏移量渲染的唯一数据结构。

**禁止在渲染文件中添加换页逻辑。** 所有关于页面边界的决策都属于 `stream-pagination.js`。

## 关键数据结构

### `allPlacements`（placement 对象数组）

```js
{
  (node, // 指向 collectNodes() 中节点对象的引用
    page, // 1-indexed PDF 页码
    offsetYpx, // 当前页内容区起始全局 y（px）
    type, // 'normal' | 'spill' | 'repeat-header' | 'repeat-header-child'
    isLastSpill, // boolean — 多页 spill 的最终页为 true
    dfsIndex, // 原始 DFS 顺序索引，用于排序 tiebreaker
    clipTopPx, // repeat-header 区域高度（px），spill 时不覆盖表头
    pageActualBottomPx); // 本页实际内容底部 px，用于裁剪
}
```

### `nodePlacements`（内部，合并前）

遍历过程中构建的 normal placement 数组，用于后续 `expandSpillPlacements()` 展开。

### `pageStartOffsets`（内部）

`Map<pageIndex, { pageContentTopPx, pageActualBottomPx, headerHeightPx }>`  
存储每页内容区起始全局 Y 及相关信息，供 `expandSpillPlacements()` 构建跨页 spill placements。

## 换页决策逻辑（`needsNewPage()`）

以下任意条件为真时触发换页：

| 条件 | CSS 触发方式 |
| --- | --- |
| 自然溢出 | 节点顶部 >= 当前页底部（无需 CSS） |
| `page-break-before: always` | `break-before: page` 或 `page-break-before: always` |
| `page-break-inside: avoid` | `break-inside: avoid` 或 `page-break-inside: avoid` |
| 文本保护 | 父节点有 `avoid` 的文本节点——防止孤行 |
| 隐式 avoid | `TR`、`SVG`、`VIDEO` 元素自动获得 avoid 行为 |

## Spill Placements

高度超过一页的元素跨多页**溢出**（spill）。  
`expandSpillPlacements()` 从 `nodePlacements` 为每个 spill 页生成一个 placement。

```
第 1 页：placement { page:1, offsetYpx: pageContentTopPx₁, isLastSpill: false }
第 2 页：placement { page:2, offsetYpx: pageContentTopPx₂, isLastSpill: false }
第 3 页：placement { page:3, offsetYpx: pageContentTopPx₃, isLastSpill: true  }
```

`offsetYpx` 是当前页内容区的全局起始 y——渲染时用 `node.y - offsetYpx` 得到页内相对坐标。

## Repeat-Header Placements

当 `tables[]` 配置条目指定 `repeatHeader: true` 时，`<thead>` 行在表格跨越的每一页顶部重复。

`repeat-header-manager.js` 中的 `generateRepeatHeaderPlacements()` 生成额外的 placements，在每页顶部插入。

`shouldSkipOriginalHeader()` 对第 2 页及之后自然位置的 `<thead>` 行返回 `true`，防止重复渲染。

## Placement 排序

`comparePlacements` 三级排序：

1. 页码升序
2. 同页内按 `placementOrder`：spill 容器（0）→ repeat-header（1）→ normal（2）→ rowspan TD spill（3）
3. 同 `placementOrder` 内按 `dfsIndex` — DFS 前序天然保证正确渲染顺序

> **注意：** 不再使用 `paintOrder` 字段。DFS 前序收集（TABLE→TBODY→TR→TD→text）本身即符合 CSS §17.5.4 绘制规范，`paintOrder` 已作为冗余层移除。

## `buildNodeLastPageMap()`

单次遍历结束后，`buildNodeLastPageMap()` 将任意子节点的最大页码向上冒泡到祖先（通过 `_origEl.parentElement` 链）。这为容器元素提供其触及的最后页码，用于正确设置 `isLastSpill`。

## 修改分页的规则

1. **所有换页条件**都在 `needsNewPage()` 中。不要在其他地方添加条件。
2. **`accumulatedYpx`** 是已消费内容的累计 px，在每次换页时重置为 `calcNextPageStart()` 的返回值。
3. **`calcNextPageStart()`** 返回下一页顶部的新 `accumulatedYpx`，已计入重复表头高度。
4. `streamPaginate()` 返回后禁止修改 `allPlacements` — 它是渲染循环的只读输入。
5. 添加新的换页触发条件时，在 `needsNewPage()` 中添加，并在此文件记录。
