import { isVisible } from '../utils';
/**
 * 需要跳过的标签（不参与渲染）
 */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);

/**
 * 采集单个元素节点的信息
 * @param {Element} origEl   - 原始 DOM 元素（读 page-break / _el）
 * @param {Element} measEl   - 测量用元素（读 rect / computedStyle，可以是克隆副本）
 * @param {DOMRect} rootRect - 根元素的 BoundingClientRect（用于计算相对坐标）
 * @param {Window}  win      - 测量用的 window（可能是 iframe 的 contentWindow）
 * @returns {Object} nodeInfo
 */
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
    // page-break 从原始元素读取，或自动判断（不可分割元素默认 avoid）
    pageBreak: (() => {
      const v = origEl.getAttribute('page-break');
      if (v !== null) {
        if (v === '' || v === true) return 'before';

        return v; // "before" | "after" | "avoid"
      }

      // 自动 avoid：天然不可分割的元素
      const autoAvoidTags = ['TR', 'IMG', 'SVG', 'VIDEO', 'CANVAS'];
      if (autoAvoidTags.includes(origEl.tagName)) {
        return 'avoid';
      }

      return null;
    })(),
    // repeat-header：跨页时重复此节点（表格列标题）
    repeatHeader: origEl.hasAttribute('repeat-header'),
    // IMG 的 _el 指向原始元素（用于 preloadImages 拿到 naturalWidth 等）
    _el: origEl.tagName === 'IMG' ? origEl : null,
    _origEl: origEl,
    style: {
      // 背景
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      // 文字
      color: style.color,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      textAlign: style.textAlign,
      lineHeight: style.lineHeight,
      textDecoration: style.textDecoration,
      // 边框
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
      // 布局
      display: style.display,
      overflow: style.overflow,
      paddingTop: style.paddingTop,
      paddingLeft: style.paddingLeft,
    },
  };
}

/**
 * 采集文本节点（用 Range 精确测量位置）
 * @param {Text}    textNode
 * @param {Element} origParent  - 原始父元素（读样式）
 * @param {Element} measParent  - 克隆父元素（测量用）
 * @param {DOMRect} rootRect
 * @param {Window}  win
 * @returns {Object|null}
 */
function parseTextNode(textNode, measParent, rootRect, win) {
  const raw = textNode.textContent;
  // 浏览器 white-space:normal：连续空白折叠成单个空格。
  // 以 \n/\t 开头说明是 HTML 缩进产生的行首空白，浏览器渲染时忽略它（rect.left 已跳过），需 trimStart。
  // 以普通空格开头（如 " bold "）是真实词间空格，rect.left 包含它，不能 trimStart。
  const collapsed = raw.replace(/\s+/g, ' ');
  const text = /^[\n\r\t]/.test(raw) ? collapsed.trimStart() : collapsed;
  if (!text.trim()) return null;

  const range = win.document.createRange();
  range.selectNodeContents(textNode);
  const rect = range.getBoundingClientRect();

  if (rect.width === 0 && rect.height === 0) return null;

  const style = win.getComputedStyle(measParent);

  return {
    type: 'text',
    tag: '#text',
    text,
    x: rect.left - rootRect.left,
    y: rect.top - rootRect.top,
    width: rect.width,
    height: rect.height,
    style: {
      color: style.color,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      textAlign: style.textAlign,
      lineHeight: style.lineHeight,
      textDecoration: style.textDecoration,
    },
  };
}

/**
 * 递归遍历 DOM 树，返回扁平化的节点列表（按文档顺序）
 *
 * @param {Element} element   - 原始根元素
 * @param {Element} [cloneRoot] - 可选，iframe 内的克隆根元素（已加好 margin-top）
 *                                传入时在 clone 上测量坐标；不传时直接在 element 上测量
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

    // 同步遍历两棵树的子节点（结构完全一致）
    const origChildren = origEl.childNodes;
    const measChildren = measEl.childNodes;

    for (let i = 0; i < origChildren.length; i++) {
      const origChild = origChildren[i];
      const measChild = measChildren[i]; // 结构相同，索引对应

      if (origChild.nodeType === Node.ELEMENT_NODE) {
        if (measChild && measChild.nodeType === Node.ELEMENT_NODE) {
          walk(origChild, measChild);
        }
      } else if (origChild.nodeType === Node.TEXT_NODE) {
        if (measChild && measChild.nodeType === Node.TEXT_NODE) {
          const textNode = parseTextNode(measChild, measEl, rootRect, measWin);
          if (textNode) nodes.push(textNode);
        }
      }
    }
  }

  walk(element, measRoot);

  return nodes;
}
