# 架构 — 完整模块交互图

## 高层数据流

```
用户调用 htmlpdf(element, options)
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│  main.js  （12步流水线编排器）                             │
└─────┬────────────────────────────────────────────────────┘
      │
      │  步骤 1：initContext(element, options)
      ├─────────────────────────────────────────────────▶  context.js
      │                                                    返回 ctx { doc, scale, toMM, toPdfX... }
      │
      │  步骤 2：createClonedDocument(element, fonts)
      ├─────────────────────────────────────────────────▶  document-cloner.js
      │                 │                                  克隆 DOM → 隐藏 iframe
      │                 ├────────────────────────────────▶ font-loader.js（injectFontsToDocument）
      │                 └────────────────────────────────▶ wait.js（waitForStyleSheets / waitForImages / waitForLayout）
      │                 返回 { iframe, cloneRoot }
      │
      │  步骤 3：collectNodes(element, cloneRoot)
      ├─────────────────────────────────────────────────▶  node-parser.js
      │                                                    返回 nodes[]（扁平数组，含坐标/样式）
      │
      │  步骤 3b：preloadImages(nodes)
      ├─────────────────────────────────────────────────▶  image-loader.js
      │                                                    就地写入 ._srcCanvas / .bgSrc
      │
      │  步骤 4：destroyClonedDocument(iframe)
      ├─────────────────────────────────────────────────▶  document-cloner.js
      │                                                    *** iframe 已销毁，禁止再访问 DOM ***
      │
      │  步骤 5：loadFontsToJsPDF(ctx, fonts)
      ├─────────────────────────────────────────────────▶  font-loader.js
      │                                                    将字体注册到 ctx.doc
      │
      │  步骤 6：createRepeatHeaderManager(nodes, tables)
      ├─────────────────────────────────────────────────▶  repeat-header-manager.js
      │                                                    返回 repeatHeaderManager
      │
      │  步骤 6b：getPageBreakLinesMap(nodes, tables)
      ├─────────────────────────────────────────────────▶  page-break-lines.js
      │                                                    返回 pageBreakBorderMap（WeakMap）
      │
      │  步骤 7：streamPaginate({ nodes, ctx, repeatHeaderManager })
      ├─────────────────────────────────────────────────▶  stream-pagination.js
      │                 │                                  单次遍历分页
      │                 └────────────────────────────────▶ repeat-header-manager.js
      │                                                      （generateRepeatHeaderPlacements / shouldSkipOriginalHeader）
      │                 返回 { totalPages, allPlacements }
      │
      │  步骤 8：collectPageBreakLines({ nodes, allPlacements, ctx, pageBreakBorderMap })
      ├─────────────────────────────────────────────────▶  page-break-lines.js
      │                                                    返回 spillClosingLinesByPage（Map）
      │
      │  步骤 9：renderNode 循环（allPlacements）
      ├─────────────────────────────────────────────────▶  render/node.js
      │                 ├────────────────────────────────▶ render/background.js
      │                 │         └──────────────────────▶   render/gradient.js
      │                 ├────────────────────────────────▶ render/border.js
      │                 ├────────────────────────────────▶ render/image.js
      │                 └────────────────────────────────▶ render/text.js
      │
      │  步骤 10：drawSpillClosingLines（按页）
      ├─────────────────────────────────────────────────▶  render/border.js
      │
      │  步骤 11：renderHeaderFooter(doc, { totalPages, ctx, header, footer })
      ├─────────────────────────────────────────────────▶  core/page.js
      │                                                    调用 header.render / footer.render 回调
      │
      │  步骤 12：ctx.output(output)
      └─────────────────────────────────────────────────▶  context.js
                                                           返回 Blob | DataURL | ArrayBuffer
```

## 模块依赖图

```
main.js
├── core/context.js           （无内部依赖）
├── core/document-cloner.js
│   ├── core/font-loader.js   （无内部依赖）
│   ├── core/wait.js          （无内部依赖）
│   └── utils/index.js
├── core/node-parser.js
│   └── utils/index.js
├── core/image-loader.js
│   └── utils/index.js
├── core/font-loader.js
│   └── utils/index.js
├── core/repeat-header-manager.js
│   └── utils/index.js
├── core/page-break-lines.js
│   └── utils/index.js
├── core/stream-pagination.js
│   └── core/repeat-header-manager.js
├── core/page.js              （无内部依赖）
├── render/node.js
│   ├── render/background.js
│   │   ├── render/gradient.js
│   │   │   └── utils/index.js
│   │   └── utils/index.js
│   ├── render/border.js
│   │   └── utils/index.js
│   ├── render/image.js
│   │   └── utils/index.js
│   └── render/text.js        （无 render 层内部依赖）
└── utils/index.js            （无内部依赖）
```

## 节点对象结构

`node-parser.js` 产生三种节点类型：

```js
// 元素节点
{
  type: 'element' | 'pseudo-element',
  pseudoType: 'before' | 'after' | undefined,  // 仅 pseudo-element 有
  tag: 'DIV' | 'P' | 'IMG' | ...,
  x: number,              // px，相对于根元素左上角
  y: number,              // px，相对于根元素左上角
  width: number,          // px
  height: number,         // px
  rowSpanChildMaxHeight: number,  // 仅 TR：含 rowspan>1 子 TD 的最大高度
  rowSpan: number,        // 仅 TD/TH：缓存的 rowSpan 属性值
  pageBreak: 'avoid' | 'before' | null,
  _el: Element | null,    // IMG → 克隆元素；CANVAS → 原始元素；其他 → null
  _origEl: Element | null, // 原始 DOM 元素引用（供 contains/matchesSelector 使用）
  style: { backgroundColor, backgroundImage, ..., borderTopWidth, ... },
}

// 文本节点
{
  type: 'text',
  tag: '#text',
  text: string,           // 规范化后的单行文本内容
  x: number,
  y: number,
  width: number,
  height: number,
  style: { color, fontSize, fontFamily, fontWeight, fontStyle,
           textAlign, lineHeight, textDecoration, direction },
  pdfFont: string | null, // 父元素的 data-pdf-font 属性值
  _origEl: Element | null, // 原始树中的父元素（伪元素文本为 null）
}
```

## Context 对象结构（`ctx`）

```js
{
  doc: jsPDF,
  scale: number,               // contentWidth(mm) / rootElement.width(px)
  margin: number,              // mm
  headerHeight: number,        // mm
  footerHeight: number,        // mm
  pageWidth: number,           // mm
  pageHeight: number,          // mm
  contentWidth: number,        // mm
  contentHeight: number,       // mm
  contentHeightPx: number,     // px（= contentHeight / scale）

  // 坐标转换辅助函数：
  toMM(px): number,            // px → mm（仅缩放，无偏移）
  toPdfX(x): number,           // px x → PDF 页面绝对 X（含左边距）
  toPdfY(y): number,           // px y → PDF 页面绝对 Y（含上边距 + headerHeight）
  toPdfYmm(ymm): number,       // mm y → PDF 页面绝对 Y（跳过缩放）
  toPt(px): number,            // px → pt（用于字号）
  output(format): any,         // 封装 doc.output()
}
```

## Placement 对象结构

`streamPaginate()` 返回的 `allPlacements` 数组中每个元素的结构：

```js
{
  page: number,              // 目标页码（1-indexed）
  node: Object,              // 指向 nodes 数组中某节点的引用
  offsetYpx: number,         // 当前页内容区起始全局 y（px）
  type: 'normal' | 'spill' | 'repeat-header' | 'repeat-header-child',
  isLastSpill: boolean,      // 是否是该节点最后一个 spill placement
  dfsIndex: number,          // 原始 DFS 顺序索引，用于排序 tiebreaker
  clipTopPx: number,         // repeat-header 区域高度（px），spill 时不覆盖表头
  pageActualBottomPx: number | null, // 本页实际内容底部（全局 px）
}
```

**排序规则**（`comparePlacements`）：

1. 页码升序
2. 同页内按 `placementOrder`：spill 容器（0）→ repeat-header（1）→ normal（2）→ rowspan TD spill（3）
3. 同 `placementOrder` 内按 `dfsIndex`（DFS 前序天然保证正确渲染顺序）
