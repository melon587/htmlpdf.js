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
 *   └─ mergeRTLTextNodes() 合并同行 RTL 文本，恢复 BiDi 上下文
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

  // 后处理：合并同一行、相同样式的 RTL 文本节点，以恢复 BiDi 上下文
  return mergeRTLTextNodes(nodes);
}

/**
 * 合并同行、同样式的 RTL 文本节点
 * 目的：恢复完整上下文，让 jsPDF BiDi 引擎正确处理阿拉伯语混合方向文本
 */
function mergeRTLTextNodes(nodes) {
  const result = [];
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i];

    // 非文本节点或非 RTL 节点，直接添加
    if (node.type !== 'text' || node.style.direction !== 'rtl') {
      result.push(node);
      i++;
      continue;
    }

    // 尝试合并后续相邻的 RTL 文本节点
    const group = [node];
    let j = i + 1;

    while (j < nodes.length) {
      const next = nodes[j];
      const last = group[group.length - 1]; // 与组内最后一个节点比较，而不是第一个

      // 检查是否可以合并
      if (
        next.type === 'text' &&
        next.style.direction === 'rtl' &&
        next._origEl === node._origEl && // ← 关键：必须是同一个父元素
        Math.abs(next.y - last.y) < 2 && // 同一行（与最后一个比较）
        next.style.fontSize === node.style.fontSize &&
        next.style.fontFamily === node.style.fontFamily &&
        next.style.fontWeight === node.style.fontWeight &&
        next.style.fontStyle === node.style.fontStyle &&
        next.style.color === node.style.color &&
        next.style.textDecoration === node.style.textDecoration
      ) {
        group.push(next);
        j++;
      } else {
        break;
      }
    }

    // 如果只有一个节点，补上 _isRTLMerged 标记后直接添加
    // 单个 RTL token 同样需要用 _rightEdge + align:'right' 渲染，否则 x 被当作左边界，位置偏左
    if (group.length === 1) {
      result.push({
        ...node,
        _isRTLMerged: true,
        _rightEdge: node.x + node.width,
        pdfFont: node.pdfFont, // 保留 pdf-font 属性
      });
      i++;
      continue;
    }

    // 合并：按文档顺序 join（即逻辑顺序），让 jsPDF BiDi 引擎处理视觉排列
    // 不按 x 排序：sort 会把 LTR token（如 "Air-" "ECO"）反序，导致显示错误
    // 用空格 join：因为我们在 tokenize 时跳过了空格 token（避免破坏阿拉伯语连体字）
    const mergedText = group.map((n) => n.text).join(' ');

    // rightmost/leftmost 按 x 坐标 reduce 取（用于坐标计算，与 join 顺序无关）
    const rightmostNode = group.reduce((a, b) =>
      a.x + a.width > b.x + b.width ? a : b,
    );
    const leftmostNode = group.reduce((a, b) => (a.x < b.x ? a : b));

    // 合并后的节点
    result.push({
      type: 'text',
      tag: '#text',
      text: mergedText,
      x: rightmostNode.x, // 最右 token 的左边界（RTL 视觉起点）
      y: rightmostNode.y,
      width: rightmostNode.x + rightmostNode.width - leftmostNode.x,
      height: rightmostNode.height,
      style: rightmostNode.style,
      pdfFont: rightmostNode.pdfFont, // 继承 pdf-font 属性
      _origEl: rightmostNode._origEl,
      _isRTLMerged: true,
      _rightEdge: rightmostNode.x + rightmostNode.width, // 最右 token 的右边界，align:'right' 基准点
    });

    i = j; // 跳过已合并的节点
  }

  return result;
}
