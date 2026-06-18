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
 * 解析文本节点，按单词粒度拆分，每个 token 单独用 Range 获取浏览器坐标
 * 核心思路（参考 dompdf）：
 *   - 不手动推算换行、不处理 RTL/BiDi，坐标完全来自浏览器
 *   - 每个 token (word/space) 单独 createRange → getClientRects()
 *   - 直接用 rect.left 作为渲染 x 坐标，天然支持 RTL/BiDi/换行
 */
function parseTextNode({ textNode, measParent, rootRect, win, origParent }) {
  const raw = textNode.textContent;
  if (!raw || !raw.trim()) return [];

  const style = win.getComputedStyle(measParent);

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

  // 按单词、连字符、空格拆分，让长文本可以在连字符后换行
  // 例如："61212562-IOM11X-English" → ["61212562-", "IOM11X-", "English"]
  // 匹配逻辑：
  // 1. [^\s-]+-  匹配非空白、非连字符的字符 + 一个连字符（保留连字符）
  // 2. [^\s-]+   匹配非空白、非连字符的字符（末尾单词，无连字符）
  // 3. \s+       匹配空白字符（独立成 token 以保持间距）
  const tokens = [];
  const tokenRegex = /[^\s-]+-|[^\s-]+|\s+/g;
  let match;
  while ((match = tokenRegex.exec(raw)) !== null) {
    tokens.push({ text: match[0], offset: match.index });
  }

  const nodes = [];
  const docRange = win.document.createRange();

  for (const token of tokens) {
    if (!token.text.trim()) continue; // 跳过纯空白 token

    docRange.setStart(textNode, token.offset);
    docRange.setEnd(textNode, token.offset + token.text.length);
    const rects = docRange.getClientRects();

    if (!rects || rects.length === 0) continue;

    // ✅ 只取第一个 rect，避免重复渲染
    // 问题：当文本换行时，getClientRects() 返回多个 rect（每行一个）
    // 但我们不知道每个 rect 对应哪部分文字，如果全部渲染会导致重复
    // 解决方案：只渲染第一个 rect（第一行），后续行会被截断
    // TODO: 未来需要更细粒度的文本拆分来支持真正的换行
    for (let i = 0; i < Math.min(1, rects.length); i++) {
      const r = rects[i];
      if (r.width === 0 || r.height === 0) continue;

      nodes.push({
        type: 'text',
        tag: '#text',
        text: token.text.trim(),
        x: r.left - rootRect.left,
        y: r.top - rootRect.top,
        width: r.width,
        height: r.height,
        style: nodeStyle,
        _origEl: origParent || null,
      });
    }
  }

  return nodes;
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
