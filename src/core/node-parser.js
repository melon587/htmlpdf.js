import { isVisible, getPageBreak } from '../utils';

/**
 * @file node-parser.js
 * DOM → 扁平节点列表解析模块
 *
 * ## 核心流程
 *
 * collectNodes(element, cloneRoot)
 *   ├─ walk(origEl, measEl)   协同遍历原始树与克隆树
 *   │  ├─ parseElement()      元素 → {type, x, y, width, height, style, ...}
 *   │  └─ parseTextNode()     文本 → [{type, text, x, y, pdfFont, ...}]
 *   │     ├─ 规范化文本       移除 HTML 源码中的换行和多余空格
 *   │     └─ 多行处理         rects.length > 1 时逐字符分析，按行分组（top 容差 2px）
 *
 * ## 关键设计：协同遍历（Clone-primary dual-walk）
 *
 * 遍历以克隆树（measEl）为主线，原始树（origEl）作为语义来源同步推进：
 *
 *   克隆树（measEl）负责：
 *     - 坐标测量（getBoundingClientRect）
 *     - 样式读取（getComputedStyle，包含自定义字体注入后的结果）
 *     - 文字行测量（createRange / getClientRects）
 *     - 伪元素 span（document-cloner.js 注入，仅存在于克隆树）
 *
 *   原始树（origEl）负责：
 *     - 语义标签（tagName）
 *     - page-break 属性（break-before / break-inside）
 *     - CANVAS 元素引用（克隆的 canvas 像素数据为空，必须取原始元素）
 *     - _origEl 引用（用于 contains() / matchesSelector() 包含关系判断）
 *
 * ## 约束：克隆树与原始树子节点顺序必须一致
 *
 * walk() 用 origIndex 同步推进 origChildren。
 * document-cloner.js 注入的伪元素 span 带有 data-pseudo 属性，walk() 遇到时
 * 不推进 origIndex。
 * 若将来在 document-cloner.js 中新增其他注入操作，必须同样用 data-* 属性标记，
 * 否则会导致 origIndex 错位，产生 silent bug。
 *
 * ## 坐标系
 *
 * 所有坐标相对于克隆根元素左上角，单位 px。
 * 文本规范化：`raw.replace(/\s+/g, ' ').trim()` 确保 PDF 渲染和浏览器显示一致。
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);

/** 表格单元格标签集合 */
const CELL_TAGS = new Set(['TD', 'TH']);

/**
 * 表格结构标签集合。
 * 供外部（render 层等）统一判断一个节点是否属于表格结构，
 * 避免各处散落 tag === 'TD' || tag === 'TH' 的重复条件。
 */
export const TABLE_TAGS = new Set([
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
]);

/**
 * 预构建表格结构缓存，供 resolveCellBorderOverrides 使用。
 *
 * 为 cloneRoot 内所有 table 元素各做一次 querySelectorAll('tr')，
 * 结果存入两个 WeakMap：
 *   - tableCollapseMap: table → isCollapse（boolean）
 *   - trIndexMap: tr → { index, total }（该 tr 在 table 全局的行号 + 总行数）
 *
 * 调用一次 O(总 TR 数)，之后每次 TD/TH 查询均为 O(1)，
 * 将原来对 1000 行表格 O(N²) 的重复查询降至 O(N)。
 *
 * @param {Element} cloneRoot - iframe 内的克隆根元素
 * @param {Window}  win       - 测量窗口
 * @returns {{ tableCollapseMap: WeakMap, trIndexMap: WeakMap }}
 */
function buildTableCache(cloneRoot, win) {
  const tableCollapseMap = new WeakMap();
  const trIndexMap = new WeakMap();

  const tables = cloneRoot.querySelectorAll('table');
  for (const table of tables) {
    const isCollapse =
      win.getComputedStyle(table).borderCollapse === 'collapse';
    tableCollapseMap.set(table, isCollapse);

    const allTrs = [...table.querySelectorAll('tr')];
    const total = allTrs.length;
    allTrs.forEach((tr, index) => {
      trIndexMap.set(tr, { index, total });
    });
  }

  return { tableCollapseMap, trIndexMap };
}

/**
 * 检测 td/th 是否处于 border-collapse 表格中（O(1) 缓存查询）。
 */
function isCollapseTable(cellEl, tableCollapseMap) {
  const tableEl = cellEl.closest('table');
  if (!tableEl) return false;

  return tableCollapseMap.get(tableEl) === true;
}

/**
 * 在 border-collapse 表格中，判断 td/th 是否非末行（O(1) 缓存查询）。
 * 对于 rowspan>1 的单元格，视觉末行 = DOM 行索引 + rowSpan - 1。
 *
 * 注意：以整张 table 的所有 tr 为范围（跨越 thead/tbody/tfoot），
 * 确保 thead 末行与 tbody 首行之间的边框也能正确去重。
 */
function isNonLastRow(cellEl, trIndexMap) {
  const tr = cellEl.closest('tr');
  if (!tr) return false;

  const info = trIndexMap.get(tr);
  if (!info) return false;

  const visualLastIndex = info.index + (cellEl.rowSpan || 1) - 1;

  return visualLastIndex < info.total - 1;
}

/**
 * 在 border-collapse 表格中，判断 td/th 是否非末列。
 * 对于 colspan>1 的单元格，视觉末列 = DOM 列索引 + colSpan - 1。
 */
function isNonLastCol(cellEl) {
  const tr = cellEl.closest('tr');
  if (!tr) return false;

  const cells = [...tr.children].filter((c) => CELL_TAGS.has(c.tagName));
  const visualLastIndex = cells.indexOf(cellEl) + (cellEl.colSpan || 1) - 1;

  return visualLastIndex < cells.length - 1;
}

/**
 * 针对 border-collapse 表格中的 td/th，计算需要覆盖的 border 值。
 * 非 td/th、伪元素、或非 collapse 表格时返回 null（不覆盖）。
 *
 * 智能检测策略：
 *   横向（上下）：
 *     - td 有 borderTop → 非末行时抑制 bottom，保留 top
 *     - td 无 borderTop → 非末行时抑制 top（即不抑制 bottom），保留 bottom
 *   纵向（左右）：
 *     - td 有 borderLeft → 非末列时抑制 right，保留 left
 *     - td 无 borderLeft → 非末列时抑制 left（即不抑制 right），保留 right
 *
 * 跨页安全：无论保留哪侧，每行/每列都只保留一侧，分割线不丢失。
 *
 * @returns {{ bottom, right } | null}
 *   各方向为 { width, color, style } 覆盖对象，或 null（不抑制该方向）
 */
function resolveCellBorderOverrides({
  tag,
  isPseudo,
  measEl,
  tableCollapseMap,
  trIndexMap,
  style,
}) {
  if (!CELL_TAGS.has(tag) || isPseudo) return null;

  if (!isCollapseTable(measEl, tableCollapseMap)) return null;

  const nonLastRow = isNonLastRow(measEl, trIndexMap);
  const nonLastCol = isNonLastCol(measEl);

  if (!nonLastRow && !nonLastCol) return null;

  const zero = { width: '0px', color: 'transparent', style: 'none' };
  const hasTop = style.borderTopWidth !== '0px';
  const hasLeft = style.borderLeftWidth !== '0px';

  // 横向：有 top 则抑制 bottom；无 top 则 bottom 是唯一来源，不抑制
  const suppressBottom = nonLastRow && hasTop;
  // 纵向：有 left 则抑制 right；无 left 则 right 是唯一来源，不抑制
  const suppressRight = nonLastCol && hasLeft;

  if (!suppressBottom && !suppressRight) return null;

  return {
    bottom: suppressBottom ? zero : null,
    right: suppressRight ? zero : null,
  };
}

/**
 * 计算 TR 节点的 rowSpanChildMaxHeight：
 * TR 内含 rowspan>1 的 TD/TH 时，取这些格子高度的最大值；
 * 非 TR 或伪元素时返回 0。
 */
function calcRowSpanChildMaxHeight(tag, isPseudo, measEl) {
  if (tag !== 'TR' || isPseudo) return 0;

  const heights = [...measEl.children]
    .filter((c) => CELL_TAGS.has(c.tagName) && (c.rowSpan || 1) > 1)
    .map((c) => c.getBoundingClientRect().height);

  return heights.length > 0 ? Math.max(0, ...heights) : 0;
}

/**
 * 读取 TD/TH 的 rowSpan 属性并缓存，避免 iframe 销毁后依赖活 DOM 引用。
 * 非 TD/TH 或伪元素时返回 1。
 */
function getCellRowSpan(tag, isPseudo, origEl) {
  return CELL_TAGS.has(tag) && !isPseudo ? origEl?.rowSpan || 1 : 1;
}

/**
 * 解析节点对应的媒体元素引用（_el）：
 * - IMG  → 取克隆树的 measEl（含 src 预加载结果）
 * - CANVAS → 取原始树的 origEl（克隆 canvas 像素为空）
 * - 其他  → null
 */
function getMediaEl(origEl, measEl) {
  if (origEl?.tagName === 'IMG') return measEl;

  if (origEl?.tagName === 'CANVAS') return origEl;

  return null;
}

/**
 * 解析元素节点，提取坐标、尺寸和样式
 * @param {Element|null} origEl     - 原始 DOM 元素；伪元素传 null
 * @param {Element}      measEl     - iframe 内的克隆元素（用于测量）
 * @param {DOMRect}      rootRect   - 根元素边界（坐标原点）
 * @param {Window}       win        - 测量窗口
 * @param {Object}       tableCache - buildTableCache() 返回的缓存对象
 * @returns {Object} 元素节点 {type, x, y, width, height, style, ...}
 */

function parseElement({ origEl, measEl, rootRect, win, tableCache }) {
  const style = win.getComputedStyle(measEl);

  // 检测是否是物化的伪元素
  const isPseudo = measEl.hasAttribute('data-pseudo');

  // 测量位置（伪元素的位置由浏览器自然布局决定）
  const rect = measEl.getBoundingClientRect();
  const x = rect.left - rootRect.left;
  const y = rect.top - rootRect.top;

  // origEl 对伪元素为 null（原始 DOM 中不存在对应节点），回退到 measEl.tagName
  const tag = origEl ? origEl.tagName : measEl.tagName;

  // border-collapse 智能去重：按 td 实际有值的边决定保留方向。
  // 有 top → 非末行抑制 bottom（保留 top）；无 top → 不抑制 bottom（bottom 是唯一来源）。
  // 有 left → 非末列抑制 right（保留 left）；无 left → 不抑制 right（right 是唯一来源）。
  // 跨页安全：每行/每列保留一侧，分割线不丢失。
  const borderOverrides = resolveCellBorderOverrides({
    tag,
    isPseudo,
    measEl,
    tableCollapseMap: tableCache.tableCollapseMap,
    trIndexMap: tableCache.trIndexMap,
    style,
  });
  const bBottom = borderOverrides?.bottom;
  const bRight = borderOverrides?.right;

  const borderTopWidth = style.borderTopWidth;
  const borderTopColor = style.borderTopColor;
  const borderTopStyle = style.borderTopStyle;

  const borderRightWidth = bRight ? bRight.width : style.borderRightWidth;
  const borderRightColor = bRight ? bRight.color : style.borderRightColor;
  const borderRightStyle = bRight ? bRight.style : style.borderRightStyle;

  const borderBottomWidth = bBottom ? bBottom.width : style.borderBottomWidth;
  const borderBottomColor = bBottom ? bBottom.color : style.borderBottomColor;
  const borderBottomStyle = bBottom ? bBottom.style : style.borderBottomStyle;

  const borderLeftWidth = style.borderLeftWidth;
  const borderLeftColor = style.borderLeftColor;
  const borderLeftStyle = style.borderLeftStyle;

  return {
    type: isPseudo ? 'pseudo-element' : 'element',
    pseudoType: isPseudo ? measEl.getAttribute('data-pseudo') : undefined,
    tag,
    x,
    y,
    width: rect.width,
    height: rect.height,
    rowSpanChildMaxHeight: calcRowSpanChildMaxHeight(tag, isPseudo, measEl),
    rowSpan: getCellRowSpan(tag, isPseudo, origEl),
    pageBreak: origEl ? getPageBreak(origEl) : null,
    _el: getMediaEl(origEl, measEl),
    _origEl: origEl,
    style: {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      backgroundSize: style.backgroundSize,
      backgroundPosition: style.backgroundPosition,
      backgroundRepeat: style.backgroundRepeat,
      color: style.color,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      textAlign: style.textAlign,
      lineHeight: style.lineHeight,
      textDecoration: style.textDecoration,
      borderTopWidth: borderTopWidth,
      borderRightWidth: borderRightWidth,
      borderBottomWidth: borderBottomWidth,
      borderLeftWidth: borderLeftWidth,
      borderTopColor: borderTopColor,
      borderRightColor: borderRightColor,
      borderBottomColor: borderBottomColor,
      borderLeftColor: borderLeftColor,
      borderTopStyle: borderTopStyle,
      borderRightStyle: borderRightStyle,
      borderBottomStyle: borderBottomStyle,
      borderLeftStyle: borderLeftStyle,
      borderTopLeftRadius: style.borderTopLeftRadius,
      borderTopRightRadius: style.borderTopRightRadius,
      borderBottomLeftRadius: style.borderBottomLeftRadius,
      borderBottomRightRadius: style.borderBottomRightRadius,
      display: style.display,
      overflow: style.overflow,
      paddingTop: style.paddingTop,
      paddingLeft: style.paddingLeft,
    },
  };
}

/**
 * 处理跨行文本：逐字符分析，按 Y 轴重叠分组
 *
 * 关键：Range 的 setStart/setEnd 下标必须对应 textNode 的原始文本（raw），
 * 而不是规范化后的文本，否则下标错位导致坐标测量偏差。
 * 每行字符收集后再做一次 white-space 规范化，与浏览器渲染行为一致。
 */
function processMultilineText({
  textNode,
  raw,
  docRange,
  rootRect,
  nodeStyle,
  pdfFont,
  origParent,
}) {
  const nodes = [];
  const lineGroups = []; // [{top, left, right, bottom, height, chars: [char1, char2, ...]}]

  // 逐字符分析并按行分组（用 raw 的下标对应 textNode offset）
  for (let charIdx = 0; charIdx < raw.length; charIdx += 1) {
    docRange.setStart(textNode, charIdx);
    docRange.setEnd(textNode, charIdx + 1);
    const charRects = docRange.getClientRects();

    if (!charRects || charRects.length === 0) continue;

    const charRect = charRects[0];

    // 查找该字符属于哪一行（通过 Y 坐标判断，容差 2px）
    let lineGroup = lineGroups.find((g) => Math.abs(g.top - charRect.top) < 2);

    if (!lineGroup) {
      lineGroup = {
        top: charRect.top,
        left: charRect.left,
        right: charRect.right,
        bottom: charRect.bottom,
        height: charRect.height,
        chars: [],
      };
      lineGroups.push(lineGroup);
    } else {
      // 扩展该行的边界矩形
      lineGroup.left = Math.min(lineGroup.left, charRect.left);
      lineGroup.right = Math.max(lineGroup.right, charRect.right);
      lineGroup.bottom = Math.max(lineGroup.bottom, charRect.bottom);
      lineGroup.height = Math.max(lineGroup.height, charRect.height);
    }

    lineGroup.chars.push(raw[charIdx]);
  }

  // 为每一行创建文本节点
  for (const group of lineGroups) {
    if (group.chars.length === 0) continue;

    // 每行独立做 white-space 规范化，与浏览器 white-space:normal 行为一致
    const lineText = group.chars.join('').replace(/\s+/g, ' ').trim();
    if (!lineText) continue;

    nodes.push({
      type: 'text',
      tag: '#text',
      text: lineText,
      x: group.left - rootRect.left,
      y: group.top - rootRect.top,
      width: group.right - group.left,
      height: group.height,
      style: nodeStyle,
      pdfFont: pdfFont,
      _origEl: origParent,
    });
  }

  return nodes;
}

/**
 * 解析文本节点，规范化空白字符，测量坐标
 * 关键修复：`raw.replace(/\s+/g, ' ').trim()` 移除 HTML 源码中的换行和多余空格
 */
function parseTextNode({ textNode, measParent, rootRect, win, origParent }) {
  const raw = textNode.textContent;
  if (!raw || !raw.trim()) return [];

  const style = win.getComputedStyle(measParent);

  // 🔧 修复：规范化文本，处理 HTML 源码中的换行和多余空格
  // 浏览器的 CSS white-space 处理会将连续空白折叠为单个空格
  // 我们需要在 PDF 渲染前也做同样的处理
  const normalizedText = raw.replace(/\s+/g, ' ').trim();

  // 读取 pdf-font 属性（已在 document-cloner.js 的 enhanceClonedDOM 中传播）
  const pdfFont = measParent.hasAttribute('pdf-font')
    ? measParent.getAttribute('pdf-font')
    : null;

  const nodeStyle = {
    color: style.color,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    textAlign: style.textAlign,
    lineHeight: style.lineHeight,
    textDecoration: style.textDecoration,
    direction: style.direction,
  };

  const docRange = win.document.createRange();

  // 测量整个文本节点的坐标
  docRange.setStart(textNode, 0);
  docRange.setEnd(textNode, raw.length);
  const rects = docRange.getClientRects();

  if (!rects || rects.length === 0) return [];

  // 多行文本处理：当文本换行时，getClientRects() 返回多个 rect
  // 需要逐字符分析，确定每个字符属于哪一行
  if (rects.length > 1) {
    return processMultilineText({
      textNode,
      raw, // 原始文本：用于 Range 下标（必须与 textNode offset 一一对应）
      docRange,
      rootRect,
      nodeStyle,
      pdfFont,
      origParent,
    });
  }

  // 单行文本：直接使用第一个 rect
  const r = rects[0];
  if (r.width === 0 || r.height === 0) return [];

  return [
    {
      type: 'text',
      tag: '#text',
      text: normalizedText,
      x: r.left - rootRect.left,
      y: r.top - rootRect.top,
      width: r.width,
      height: r.height,
      style: nodeStyle,
      pdfFont,
      _origEl: origParent,
    },
  ];
}

/**
 * 递归遍历 DOM 树，返回扁平化节点列表
 * @param {Element} element   - 原始根元素
 * @param {Element} cloneRoot - iframe 内的克隆根元素（用于测量）
 * @returns {Array} 扁平化节点列表
 */
export function collectNodes(element, cloneRoot) {
  const measRoot = cloneRoot;
  const measWin = cloneRoot.ownerDocument.defaultView;
  const rootRect = measRoot.getBoundingClientRect();

  // 预构建表格缓存：一次 O(总 TR 数) 遍历，之后每个 TD/TH 查询均为 O(1)
  const tableCache = buildTableCache(measRoot, measWin);

  const nodes = [];

  function walk(origEl, measEl) {
    // origEl 为 null 表示物化的伪元素（原始 DOM 中不存在对应节点）
    if (origEl && SKIP_TAGS.has(origEl.tagName)) return;

    const style = measWin.getComputedStyle(measEl);
    if (!isVisible(style)) return;

    // 元素本身（包括物化的伪元素）
    nodes.push(
      parseElement({
        origEl,
        measEl,
        rootRect,
        win: measWin,
        tableCache,
      }),
    );

    const measChildren = measEl.childNodes;
    // 伪元素没有原始子节点，origChildren 为空 NodeList
    const origChildren = origEl ? origEl.childNodes : [];

    // 跟踪原始子节点位置（跳过 iframe 中添加的伪元素 span）
    let origIndex = 0;

    // 推进 origIndex 直到遇到目标 nodeType
    function advanceOrig(nodeType) {
      while (
        origIndex < origChildren.length &&
        origChildren[origIndex].nodeType !== nodeType
      ) {
        origIndex += 1;
      }
    }

    // 解析文本节点并追加到 nodes
    function pushTextNodes(measChild, origParent) {
      const textNodes = parseTextNode({
        textNode: measChild,
        measParent: measEl,
        rootRect,
        win: measWin,
        origParent,
      });
      for (const n of textNodes) nodes.push(n);
    }

    for (let i = 0; i < measChildren.length; i += 1) {
      const measChild = measChildren[i];

      if (measChild.nodeType === Node.ELEMENT_NODE) {
        if (measChild.hasAttribute('data-pseudo')) {
          // 物化的伪元素在原始 DOM 中不存在，origEl 传 null 以满足 _origEl 契约
          // （_origEl 仅用于 contains()/matchesSelector()，伪元素不参与这两类判断）
          walk(null, measChild);
        } else {
          // 普通元素：从 origChildren 中找对应节点
          advanceOrig(Node.ELEMENT_NODE);
          if (origIndex < origChildren.length) {
            walk(origChildren[origIndex], measChild);
            origIndex += 1;
          }
        }
      } else if (measChild.nodeType === Node.TEXT_NODE) {
        if (origEl === null) {
          // 伪元素上下文：无 origChildren，直接解析
          // _origEl 传 null（伪元素文本不参与 contains/matchesSelector 判断）
          pushTextNodes(measChild, null);
        } else {
          // 普通元素：从 origChildren 中找对应文本节点
          advanceOrig(Node.TEXT_NODE);
          if (origIndex < origChildren.length) {
            pushTextNodes(measChild, origEl);
            origIndex += 1;
          }
        }
      }
    }
  }

  walk(element, measRoot);

  return nodes;
}
