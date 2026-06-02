import { isVisible, getPageBreak } from '../utils';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);

function parseElement(origEl, measEl, rootRect, win) {
  const rect = measEl.getBoundingClientRect();
  const style = win.getComputedStyle(measEl);

  return {
    type: 'element',
    tag: origEl.tagName,
    x: rect.left - rootRect.left,
    y: rect.top - rootRect.top,
    width: rect.width,
    height: rect.height,
    pageBreak: getPageBreak(origEl),
    repeatHeader: origEl.hasAttribute('repeat-header'),
    _el: origEl.tagName === 'IMG' ? origEl : null,
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
 * 二分法：找到「前 lineCount 行」的字符结束位置
 *
 * 原理：
 *   range(0, mid).getClientRects().length 就是前 mid 个字符占几行。
 *   我们要找最大的 mid，使得行数 <= lineCount。
 *   这个 mid 就是第 lineCount 行的最后一个字符位置。
 *   浏览器已经考虑了 word-break/padding/inline 等所有因素，
 *   所以这里找到的换行位置天然就是浏览器实际的换行位置。
 */
function findLineEnd(textNode, range, lineCount, totalLen) {
  let left = 0;
  let right = totalLen;
  let result = totalLen;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    range.setStart(textNode, 0);
    range.setEnd(textNode, mid);
    const count = range.getClientRects().length;

    if (count <= lineCount) {
      // 前 mid 个字符还在 lineCount 行以内，记录并向右扩大
      result = mid;
      left = mid + 1;
    } else {
      // 超出了，向左缩小
      right = mid - 1;
    }
  }

  return result;
}

/**
 * 解析文本节点，按浏览器实际渲染的行拆分，返回节点数组
 * 核心思路：
 *   1. range.getClientRects() 返回浏览器已渲染好的每一行矩形
 *      - 天然包含了 word-break、padding、inline 元素等所有布局
 *      - 每个 rect 的 left/top/width/height 直接用于 PDF 绘制
 *   2. 用二分法找出每一行对应的字符范围（charStart ~ charEnd）
 *      - 二分出的 charEnd 就是浏览器实际换行位置，无需额外处理 word-break
 *   3. 每行生成一个独立文本节点，坐标用该行的 rect
 */
function parseTextNode({ textNode, measParent, rootRect, win, origParent }) {
  const raw = textNode.textContent;
  // white-space:normal: fold whitespace to single space
  // \n/\r/\t at start -> HTML indent whitespace, trimStart
  // plain space at start (e.g. " bold") -> real word-gap, keep it
  const shouldTrim = /^[\n\r\t]/.test(raw);
  const collapsed = raw.replace(/\s+/g, ' ');
  const text = shouldTrim ? collapsed.trimStart() : collapsed;
  if (!text.trim()) return [];

  const range = win.document.createRange();
  range.selectNodeContents(textNode);
  const lineRects = range.getClientRects();

  if (lineRects.length === 0) return [];

  const style = win.getComputedStyle(measParent);

  // compute once, reuse for all lines
  const nodeStyle = {
    color: style.color,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    textAlign: style.textAlign,
    lineHeight: style.lineHeight,
    textDecoration: style.textDecoration,
  };

  // single line: return directly, no binary search needed
  if (lineRects.length === 1) {
    const r = lineRects[0];

    return [
      {
        type: 'text',
        tag: '#text',
        text,
        x: r.left - rootRect.left,
        y: r.top - rootRect.top,
        width: r.width,
        height: r.height,
        style: nodeStyle,
        _origEl: origParent || null,
      },
    ];
  }

  // multi-line: binary search for char boundary per line
  const nodes = [];
  let charStart = 0;
  const wordBreak = style.wordBreak || 'normal';

  for (let i = 0; i < lineRects.length; i++) {
    const r = lineRects[i];

    let charEnd;
    if (i === lineRects.length - 1) {
      charEnd = text.length;
    } else {
      // binary search using raw.length (range.setEnd uses raw offsets)
      // then map raw offset back to collapsed text offset
      const rawEnd = findLineEnd(textNode, range, i + 1, raw.length);
      const collapsedSlice = raw.substring(0, rawEnd).replace(/\s+/g, ' ');
      charEnd = (shouldTrim ? collapsedSlice.trimStart() : collapsedSlice)
        .length;
      charEnd = adjustWordBreak(text, charStart, charEnd, wordBreak);
    }

    nodes.push({
      type: 'text',
      tag: '#text',
      text: text.substring(charStart, charEnd),
      x: r.left - rootRect.left,
      y: r.top - rootRect.top,
      width: r.width,
      height: r.height,
      style: nodeStyle,
      _origEl: origParent || null,
    });

    charStart = charEnd;
  }

  return nodes;
}

/**
 * word-break: normal - if charEnd lands mid-word, walk back to word boundary
 * @returns adjusted charEnd
 */
function adjustWordBreak(text, charStart, charEnd, wordBreak) {
  if (wordBreak === 'break-all' || wordBreak === 'break-word') return charEnd;

  if (charEnd > charStart && !/[\s-]/.test(text[charEnd - 1])) {
    let ws = charEnd - 1;
    while (ws > charStart && !/[\s-]/.test(text[ws - 1])) {
      ws--;
    }

    return ws;
  }

  return charEnd;
}

/**
 * 递归遍历 DOM 树，返回扁平化的节点列表（按文档顺序）
 *
 * @param {Element} element     - 原始根元素
 * @param {Element} [cloneRoot] - iframe 内的克隆根元素（传入时在 clone 上测量）
 * @returns {Array} nodes
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

    nodes.push(parseElement(origEl, measEl, rootRect, measWin));

    const origChildren = origEl.childNodes;
    const measChildren = measEl.childNodes;

    for (let i = 0; i < origChildren.length; i++) {
      const origChild = origChildren[i];
      const measChild = measChildren[i];

      if (origChild.nodeType === Node.ELEMENT_NODE) {
        if (measChild && measChild.nodeType === Node.ELEMENT_NODE) {
          walk(origChild, measChild);
        }
      } else if (origChild.nodeType === Node.TEXT_NODE) {
        if (measChild && measChild.nodeType === Node.TEXT_NODE) {
          // parseTextNode 返回数组（多行时多个节点），逐个 push
          // 传入 origEl 作为 _origEl，让 text 节点能参与祖先 height 更新
          const textNodes = parseTextNode({
            textNode: measChild,
            measParent: measEl,
            rootRect,
            win: measWin,
            origParent: origEl,
          });
          for (const n of textNodes) nodes.push(n);
        }
      }
    }
  }

  walk(element, measRoot);

  return nodes;
}
