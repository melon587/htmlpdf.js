import { isVisible, getPageBreak } from '../utils';

/**
 * @file node-parser.js
 * DOM → 节点树解析模块
 *
 * ## 核心流程
 *
 * collectNodes(element, cloneRoot)
 *   ├─ walk()              递归遍历，同时访问原始树和克隆树（双树协同）
 *   │  ├─ parseElement()   元素 → {type, x, y, width, height, style, ...}
 *   │  └─ parseTextNode()  文本 → [{type, text, x, y, pdfFont, ...}]
 *   │     ├─ 规范化文本    移除 HTML 源码中的换行和多余空格
 *   │     └─ 多行处理      rects.length > 1 时逐字符分析，按行分组（top 容差 2px）
 *
 * ## 关键设计
 *
 * - 双树协同：原始树读取语义（tagName、page-break），克隆树测量坐标（getBoundingClientRect）
 * - 坐标系：相对于克隆根元素左上角，单位 px
 * - 文本规范化：`raw.replace(/\s+/g, ' ').trim()` 确保 PDF 渲染和浏览器显示一致
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);

/**
 * 解析元素节点，提取坐标、尺寸和样式
 * @param {Element} origEl   - 原始 DOM 元素
 * @param {Element} measEl   - iframe 内的克隆元素（用于测量）
 * @param {DOMRect} rootRect - 根元素边界（坐标原点）
 * @param {Window}  win      - 测量窗口
 * @returns {Object} 元素节点 {type, x, y, width, height, style, ...}
 */

function parseElement(origEl, measEl, rootRect, win) {
  const style = win.getComputedStyle(measEl);

  // 检测是否是物化的伪元素
  const isPseudo = measEl.hasAttribute && measEl.hasAttribute('data-pseudo');

  // 测量位置（伪元素的位置由浏览器自然布局决定）
  const rect = measEl.getBoundingClientRect();
  const x = rect.left - rootRect.left;
  const y = rect.top - rootRect.top;

  return {
    type: isPseudo ? 'pseudo-element' : 'element',
    pseudoType: isPseudo ? measEl.getAttribute('data-pseudo') : undefined,
    tag: origEl.tagName,
    x,
    y,
    width: rect.width,
    height: rect.height,
    pageBreak: getPageBreak(origEl),
    _el:
      origEl.tagName === 'IMG'
        ? measEl
        : origEl.tagName === 'CANVAS'
          ? origEl
          : null,
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
      borderTopWidth: style.borderTopWidth,
      borderRightWidth: style.borderRightWidth,
      borderBottomWidth: style.borderBottomWidth,
      borderLeftWidth: style.borderLeftWidth,
      borderTopColor: style.borderTopColor,
      borderRightColor: style.borderRightColor,
      borderBottomColor: style.borderBottomColor,
      borderLeftColor: style.borderLeftColor,
      borderTopStyle: style.borderTopStyle,
      borderRightStyle: style.borderRightStyle,
      borderBottomStyle: style.borderBottomStyle,
      borderLeftStyle: style.borderLeftStyle,
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
      _origEl: origParent || null,
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
  const pdfFont =
    measParent.hasAttribute && measParent.hasAttribute('pdf-font')
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
      _origEl: origParent || null,
    },
  ];
}

/**
 * 递归遍历 DOM 树，返回扁平化节点列表
 * @param {Element} element    - 原始根元素
 * @param {Element} [cloneRoot] - iframe 内的克隆根元素（用于测量）
 * @returns {Array} 扁平化节点列表（经过 RTL 合并处理）
 */
export function collectNodes(element, cloneRoot) {
  const useClone = !!cloneRoot;
  const measRoot = useClone ? cloneRoot : element;
  const measWin = useClone ? cloneRoot.ownerDocument.defaultView : window;
  const rootRect = measRoot.getBoundingClientRect();

  const nodes = [];

  function walk(origEl, measEl) {
    if (SKIP_TAGS.has(origEl.tagName)) return;

    const style = measWin.getComputedStyle(measEl);
    if (!isVisible(style)) return;

    // 元素本身（包括物化的伪元素）
    nodes.push(parseElement(origEl, measEl, rootRect, measWin));

    const measChildren = measEl.childNodes;
    const origChildren = origEl.childNodes;

    // 跟踪原始子节点位置（跳过 iframe 中添加的伪元素 span）
    let origIndex = 0;

    for (let i = 0; i < measChildren.length; i += 1) {
      const measChild = measChildren[i];

      if (measChild.nodeType === Node.ELEMENT_NODE) {
        // 检查是否是物化的伪元素
        if (measChild.hasAttribute && measChild.hasAttribute('data-pseudo')) {
          // 物化的伪元素：origEl 使用 measChild 自身（原始 DOM 中不存在）
          walk(measChild, measChild);
        } else {
          // 普通元素：从 origChildren 中找对应节点
          while (
            origIndex < origChildren.length &&
            origChildren[origIndex].nodeType !== Node.ELEMENT_NODE
          ) {
            origIndex++;
          }

          if (origIndex < origChildren.length) {
            const origChild = origChildren[origIndex];
            walk(origChild, measChild);
            origIndex++;
          }
        }
      } else if (measChild.nodeType === Node.TEXT_NODE) {
        // 文本节点：从 origChildren 中找对应节点
        while (
          origIndex < origChildren.length &&
          origChildren[origIndex].nodeType !== Node.TEXT_NODE
        ) {
          origIndex++;
        }

        if (origIndex < origChildren.length) {
          const textNodes = parseTextNode({
            textNode: measChild,
            measParent: measEl,
            rootRect,
            win: measWin,
            origParent: origEl,
          });
          for (const n of textNodes) nodes.push(n);
          origIndex++;
        }
      }
    }
  }

  walk(element, measRoot);

  return nodes;
}
