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
 * 解析文本节点，按单词粒度拆分，每个 token 单独用 Range 获取浏览器坐标
 * 核心思路（参考 dompdf）：
 *   - 不手动推算换行、不处理 RTL/BiDi，坐标完全来自浏览器
 *   - 每个 token (word/space) 单独 createRange → getClientRects()
 *   - 直接用 rect.left 作为渲染 x 坐标，天然支持 RTL/BiDi/换行
 *   - 支持多行文本渲染：当 token 跨行时，逐字符分析定位到每一行
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

    // 多行文本处理：当文本换行时，getClientRects() 返回多个 rect
    // 需要逐字符分析，确定每个字符属于哪一行
    if (rects.length > 1) {
      // 按字符分析并按行分组
      const lineGroups = []; // [{top, left, right, bottom, height, chars: [char1, char2, ...], charIndices: [0, 1, 2...]}]

      for (let charIdx = 0; charIdx < token.text.length; charIdx++) {
        docRange.setStart(textNode, token.offset + charIdx);
        docRange.setEnd(textNode, token.offset + charIdx + 1);
        const charRects = docRange.getClientRects();

        if (!charRects || charRects.length === 0) continue;

        const charRect = charRects[0];

        // 查找该字符属于哪一行（通过 y 坐标判断，容差 2px）
        let lineGroup = lineGroups.find(
          (g) => Math.abs(g.top - charRect.top) < 2,
        );

        if (!lineGroup) {
          lineGroup = {
            top: charRect.top,
            left: charRect.left,
            right: charRect.right,
            bottom: charRect.bottom,
            height: charRect.height,
            chars: [],
            charIndices: [],
          };
          lineGroups.push(lineGroup);
        } else {
          // 扩展该行的边界矩形
          lineGroup.left = Math.min(lineGroup.left, charRect.left);
          lineGroup.right = Math.max(lineGroup.right, charRect.right);
          lineGroup.bottom = Math.max(lineGroup.bottom, charRect.bottom);
          lineGroup.height = Math.max(lineGroup.height, charRect.height);
        }

        lineGroup.chars.push(token.text[charIdx]);
        lineGroup.charIndices.push(charIdx);
      }

      // 为每一行创建文本节点
      for (const group of lineGroups) {
        if (group.chars.length === 0) continue;

        const lineText = group.chars.join('');

        nodes.push({
          type: 'text',
          tag: '#text',
          text: lineText,
          x: group.left - rootRect.left,
          y: group.top - rootRect.top,
          width: group.right - group.left,
          height: group.height,
          style: nodeStyle,
          _origEl: origParent || null,
        });
      }
    } else {
      // 单行文本：直接使用第一个 rect
      const r = rects[0];
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

  // 后处理：合并同一行、相同样式的 RTL 文本节点，以恢复 BiDi 上下文
  return mergeRTLTextNodes(nodes);
}

/**
 * 合并同一行、相同样式、同一父元素内的 RTL 文本节点
 * 目的：让 jsPDF 的 BiDi 引擎能看到完整的段落上下文，正确处理 "100%" 等混合方向文本
 *
 * 合并条件：
 * 1. 都是 text 节点
 * 2. direction 都是 rtl
 * 3. 在同一行（y 坐标相近，容差 2px）
 * 4. 样式完全相同（fontSize, fontFamily, fontWeight, fontStyle, color）
 * 5. 同一个父元素（_origEl 相同）← 关键：确保不跨越单元格/段落边界
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

      // 检查是否可以合并
      if (
        next.type === 'text' &&
        next.style.direction === 'rtl' &&
        next._origEl === node._origEl && // ← 关键：必须是同一个父元素
        Math.abs(next.y - node.y) < 2 && // 同一行
        next.style.fontSize === node.style.fontSize &&
        next.style.fontFamily === node.style.fontFamily &&
        next.style.fontWeight === node.style.fontWeight &&
        next.style.fontStyle === node.style.fontStyle &&
        next.style.color === node.style.color
      ) {
        group.push(next);
        j++;
      } else {
        break;
      }
    }

    // 如果只有一个节点，直接添加
    if (group.length === 1) {
      result.push(node);
      i++;
      continue;
    }

    // 合并：RTL 文本从右到左排列，需要按 x 坐标降序排列后再拼接
    group.sort((a, b) => b.x - a.x); // 从右到左

    // 拼接文本，用空格分隔（因为浏览器已经按单词拆分了）
    const mergedText = group.map((n) => n.text).join(' ');

    // 使用最右边节点的 x 坐标和最右边节点的右边界
    const rightmostNode = group[0]; // 排序后第一个就是最右边的
    const leftmostNode = group[group.length - 1]; // 排序后最后一个是最左边的

    // 合并后的节点
    result.push({
      type: 'text',
      tag: '#text',
      text: mergedText,
      x: rightmostNode.x, // 最右边单词的左边界
      y: rightmostNode.y,
      width: rightmostNode.x + rightmostNode.width - leftmostNode.x, // 从最左边到最右边的总宽度
      height: rightmostNode.height,
      style: rightmostNode.style,
      _origEl: rightmostNode._origEl,
      _isRTLMerged: true, // 标记这是合并后的 RTL 节点
      _rightEdge: rightmostNode.x + rightmostNode.width, // 保存最右边单词的右边界
    });

    i = j; // 跳过已合并的节点
  }

  return result;
}
