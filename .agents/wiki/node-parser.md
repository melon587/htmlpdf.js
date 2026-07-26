# 节点解析器 — 深入设计解析

## 目的

`src/core/node-parser.js` 将克隆 DOM 转换为**扁平节点对象数组**，供流水线其余部分在不接触活跃 DOM 的情况下使用。

`collectNodes()` 返回后，iframe 即被销毁。渲染所需的所有数据必须已在节点数组中捕获完毕。

## 克隆-原始双树协同遍历（Clone-Primary Dual-Walk）

遍历同时运行两棵 DOM 树：

```
collectNodes(element, cloneRoot)
              │           │
              │           └── measEl（克隆树，在 iframe 内）
              └── origEl  （原始树，在活跃页面中）
```

### 为什么需要两棵树？

克隆树用于**测量**：它位于隐藏 iframe 内，已配置了正确的页面宽度、注入字体，并物化了伪元素。对克隆树调用 `getBoundingClientRect()` 和 `getComputedStyle()` 可获得准确的布局值。

原始树用于**语义**：某些数据只存在于或只在原始元素上可靠。

### 职责划分

| 数据 | 来源 | 原因 |
| --- | --- | --- |
| 坐标（x, y, width, height） | 克隆（`measEl`） | iframe 内准确的布局 |
| 计算样式 | 克隆（`measEl`） | 注入字体影响字体度量 |
| 文字行测量（Range） | 克隆（`measEl`） | 需要活跃布局 |
| 伪元素 span | 仅克隆 | 由 `document-cloner.js` 注入，原始树中不存在 |
| `tagName` | 原始（`origEl`） | 两树相同；使用原始树更清晰 |
| `pageBreak`（break-before/inside） | 原始（`origEl`） | 原始元素上的 CSS 属性 |
| `CANVAS._el` 引用 | **原始**（`origEl`） | `cloneNode()` 不复制 canvas 像素数据 |
| `IMG._el` 引用 | **克隆**（`measEl`） | 克隆的 img 在 iframe 中已加载 src |
| `_origEl` 引用 | 原始（`origEl`） | 供后续的 `contains()` / `matchesSelector()` 使用 |

### `CANVAS` 例外 — 关键

`cloneNode()` **不**复制 canvas 像素数据，克隆的 canvas 始终为空白。`image-loader.js` 必须在 iframe 销毁之前从**原始**元素读取 canvas 内容。这是保留原始树引用的唯一硬性原因。

## `walk(origEl, measEl)` — 同步遍历

```
对 measEl 的每个子节点：
  若子节点有 data-pseudo 属性：
    → document-cloner.js 注入的伪元素
    → walk(null, measChild)   // origEl 传 null，不推进 origIndex
  否则若子节点是 ELEMENT_NODE：
    → 通过推进 origIndex 找到对应的 origChild
    → walk(origChild, measChild)
  否则若子节点是 TEXT_NODE：
    → 若 origEl === null（伪元素上下文）：直接解析
    → 否则：推进 origIndex 找到对应文本节点，再解析
    → parseTextNode({ textNode: measChild, origParent: origEl, ... })
```

### `origIndex` 不变量

`origIndex` 追踪 `origChildren` 中的位置，只对真实（非注入）节点推进。这依赖克隆树与原始树对所有非注入节点的**子节点顺序完全一致**。

**关键约束：** `document-cloner.js` 未来向克隆树注入的任何节点必须标记 `data-*` 属性，使 `walk()` 可以识别并跳过，而不推进 `origIndex`。若不这样做，会产生静默的节点错位 bug。

### 内联辅助函数

`walk()` 内部定义了两个辅助函数以消除重复代码：

- **`advanceOrig(nodeType)`** — 推进 `origIndex` 直到遇到目标 nodeType
- **`pushTextNodes(measChild, origParent)`** — 调用 `parseTextNode` 并将结果批量追加到 `nodes`

## 多行文本拆分

当文本节点跨行折行时，`getClientRects()` 返回多个 rect（每行一个）。`processMultilineText()` 处理此情况：

1. 使用 `Range.setStart/setEnd` 逐字符遍历 `raw`。
2. 按 Y 坐标（2px 容差）分组字符。
3. 对每组（行）合并字符并规范化空白。
4. 每行输出一个文本节点。

**重要：** Range 字符偏移必须使用 `raw`（原始 `textContent`），而非规范化后的文本。使用规范化字符串会导致偏移错位，产生错误坐标。

## 节点对象结构（输出）

```js
// 元素节点
{
  type: 'element' | 'pseudo-element',
  pseudoType: 'before' | 'after' | undefined,  // 仅 pseudo-element 有
  tag: 'DIV' | 'P' | 'IMG' | ...,
  x: number,           // px，相对于克隆根元素左上角
  y: number,           // px，相对于克隆根元素顶部
  width: number,       // px
  height: number,      // px
  rowSpanChildMaxHeight: number,  // 仅 TR：rowspan>1 子节点的最大高度
  rowSpan: number,     // 仅 TD/TH：缓存的 rowSpan 属性值（避免 iframe 销毁后依赖活 DOM）
  pageBreak: 'avoid' | 'before' | null,
  _el: Element | null, // IMG → 克隆元素；CANVAS → 原始元素；其他 → null
  _origEl: Element | null, // 原始 DOM 元素（供 contains/matchesSelector 使用；伪元素为 null）
  style: { backgroundColor, backgroundImage, ..., borderTopWidth, ... },
}

// 文本节点
{
  type: 'text',
  tag: '#text',
  text: string,        // 规范化后的单行文本内容
  x: number,
  y: number,
  width: number,
  height: number,
  style: { color, fontSize, fontFamily, fontWeight, fontStyle,
           textAlign, lineHeight, textDecoration, direction },
  pdfFont: string | null,  // 父元素的 data-pdf-font 属性值
  _origEl: Element | null, // 原始树中的父元素（伪元素文本为 null）
}
```

## `_origEl` 契约

`_origEl` 有且仅有一个用途：供 `contains()` 和 `matchesSelector()` 进行包含关系判断（用于 repeat-header-manager、page-break-lines 等模块）。

- 普通元素：`_origEl` = 原始 DOM 元素
- 物化的伪元素节点（`type: 'pseudo-element'`）：`_origEl` = null
- 伪元素的子文本节点（`type: 'text'`，父为伪元素）：`_origEl` = null

## 未来：替换克隆策略

若克隆机制（`document-cloner.js`）被替换（如使用不同的 iframe 方案或 Shadow DOM），`node-parser.js` 要求的契约为：

1. `cloneRoot` 必须是已挂载的 DOM 元素，其 `getBoundingClientRect()` 相对于自身左上角准确。
2. 克隆树的子节点顺序对所有非注入节点必须与原始树一致。
3. 注入克隆树的任何节点（如伪元素等）必须携带 `data-*` 标记属性。
4. 调用 `collectNodes()` 之前，自定义字体必须已注入克隆文档，以确保文字度量准确。
5. 克隆中的 `CANVAS` 元素像素数据始终为空——必须保留原始元素引用（`_origEl`）供 canvas 渲染使用。
