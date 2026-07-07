import { isVisible, getPageBreak } from '../utils';

/**
 * @file node-parser.js
 * DOM → 节点树 解析模块
 *
 * ## 整体流程
 *
 * collectNodes(element, cloneRoot)
 *   │
 *   ├─ walk(origEl, measEl)          递归遍历 DOM 树
 *   │    ├─ parseElement()           元素节点 → { type:'element', x, y, width, height, style, ... }
 *   │    │   └─ 识别物化伪元素      检测 data-pseudo 属性，标记 type:'pseudo-element'
 *   │    │
 *   │    └─ parseTextNode()          文本节点 → [{ type:'text', text, x, y, ... }, ...]
 *   │         ├─ tokenize            按单词/连字符拆分原始文本
 *   │         ├─ Range.getClientRects()  获取每个 token 的浏览器坐标（支持 RTL/BiDi）
 *   │         └─ 多行处理            token 跨行时逐字符定位，拆成多个单行节点
 *   │
 *   └─ mergeRTLTextNodes()           后处理：把同行、同父、同样式的 RTL token 合并为整句
 *        目的：让 jsPDF BiDi 引擎看到完整上下文，正确处理 "100%"→"%100"、括号镜像等
 *
 * ## 双树设计（orig / meas）
 *
 * 为了在不影响原始页面布局的情况下精确测量坐标，外部会将 DOM 克隆到 iframe 中：
 *   - origEl / origParent：原始 DOM 节点，用于读取 tagName、pageBreak 等语义信息
 *   - measEl / measParent：iframe 内的克隆节点，用于 getBoundingClientRect() 和 getComputedStyle()
 * 当 cloneRoot 未传入时，两棵树相同（直接在原始 DOM 上测量）。
 *
 * ## 坐标系
 *
 * 所有 x/y 坐标均相对于根元素左上角（rootRect），单位 px。
 * 渲染层（text.js / element.js）再通过 ctx.toPdfX/toPdfY 转换为 PDF mm 坐标。
 *
 * ## 伪元素处理
 *
 * 物化的伪元素（由 document-cloner.js 创建）会被识别并标记为 pseudo-element 节点：
 *   - 检测：measEl.hasAttribute('data-pseudo')
 *   - 类型：type: 'pseudo-element'
 *   - pseudoType：'before' | 'after'
 *   - 位置：由浏览器自然布局决定（已在 cloner 阶段设置样式）
 *
 * walk() 函数遍历子节点时会跳过 iframe 中添加的伪元素 span，
 * 单独处理（origEl = measChild），因为原始 DOM 中不存在对应节点。
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);

/**
 * 解析单个元素节点，提取坐标、尺寸和计算样式
 *
 * ## 伪元素处理
 *
 * 物化的伪元素（由 document-cloner.js 的 materializePseudoElements 创建）
 * 会被识别并标记为 pseudo-element 节点：
 *   - 检测条件：measEl.hasAttribute('data-pseudo')
 *   - 节点类型：type: 'pseudo-element'
 *   - 伪元素类型：pseudoType: 'before' | 'after'
 *   - 位置来源：浏览器自然布局（已在 cloner 阶段通过 copyPseudoStyles 设置样式）
 *
 * @param {Element} origEl   - 原始 DOM 元素（用于读取 tagName、pageBreak 等）
 * @param {Element} measEl   - 测量用元素（用于 getBoundingClientRect / getComputedStyle）
 * @param {DOMRect} rootRect - 根元素的 BoundingClientRect，用于将坐标转为相对值
 * @param {Window}  win      - 测量窗口（可能是 iframe 的 contentWindow）
 * @returns {{ type:'element'|'pseudo-element', tag, x, y, width, height, pageBreak, _el, _origEl, style }}
 *   type        'element' 或 'pseudo-element'（物化的伪元素）
 *   pseudoType  伪元素类型（'before' | 'after'），仅 pseudo-element 有值
 *   _el         IMG 保存 iframe 内的 measEl（同源，可安全 drawImage 到 canvas）；
 *               CANVAS 保存原始 origEl（iframe 克隆的 canvas 像素为空，需读原始内容）
 *   _origEl     指向原始 DOM 元素，供后处理（如 mergeRTLTextNodes）判断父元素边界
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
 * 解析单个文本节点，按单词粒度拆分，每个 token 用 Range.getClientRects() 获取浏览器坐标
 *
 * 核心设计原则：坐标完全来自浏览器，不手动推算换行或 RTL/BiDi 方向
 *   - 按单词/连字符 tokenize，每个 token 单独 createRange → getClientRects()
 *   - rect.left 直接作为渲染 x 坐标，天然支持 RTL、BiDi、自动换行
 *   - token 跨行时（rects.length > 1），逐字符定位，将字符按行分组后各自输出节点
 *
 * @param {Object}  params
 * @param {Text}    params.textNode   - 浏览器 Text 节点（在 measParent 下，用于 Range 操作）
 * @param {Element} params.measParent - 文本节点的父元素（用于 getComputedStyle 获取样式）
 * @param {DOMRect} params.rootRect   - 根元素的 BoundingClientRect，坐标原点
 * @param {Window}  params.win        - 测量窗口
 * @param {Element} params.origParent - 原始 DOM 中对应的父元素，赋给输出节点的 _origEl 字段
 * @returns {Array<{ type:'text', text, x, y, width, height, style, _origEl }>}
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
  // 1. [^\s-]+-  匹配非空白、非连字符的字符 + 一个连字符（保留连字符，用于换行点）
  // 2. [^\s-]+   匹配非空白、非连字符的字符（末尾单词，无连字符）
  // 3. -         匹配独立连字符（如 "[111]-222" 中括号后的分隔符 "-"）
  // 4. \s+       匹配空白字符（独立成 token 以保持间距）
  const tokens = [];
  const tokenRegex = /[^\s-]+-|[^\s-]+|-|\s+/g;
  let match;
  while ((match = tokenRegex.exec(raw)) !== null) {
    tokens.push({ text: match[0], offset: match.index });
  }

  const nodes = [];
  const docRange = win.document.createRange();

  for (const token of tokens) {
    // 跳过空白 token 和空字符串
    // RTL 文本（阿拉伯语等）的空格会在合并时用 join(' ') 恢复
    // LTR 文本的空格由浏览器的 letter-spacing 和字体度量自动处理
    if (!token.text.trim()) continue;

    docRange.setStart(textNode, token.offset);
    docRange.setEnd(textNode, token.offset + token.text.length);
    const rects = docRange.getClientRects();

    if (!rects || rects.length === 0) continue;

    // 多行文本处理：当文本换行时，getClientRects() 返回多个 rect
    // 需要逐字符分析，确定每个字符属于哪一行
    if (rects.length > 1) {
      // 按字符分析并按行分组
      const lineGroups = []; // [{top, left, right, bottom, height, chars: [char1, char2, ...]}]

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
        text: token.text, // 保留原始文本，包括空格
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
 * 递归遍历 DOM 树，返回扁平化的渲染节点列表（按文档顺序）
 *
 * 输出节点类型：
 *   - { type:'element' }  对应每个可见 HTML 元素，包含坐标、尺寸、样式
 *   - { type:'text' }     对应文本内容，每个单词/连字符片段为一个节点
 *                         多行文本会按行拆分为多个节点
 *
 * 后处理：walk 完成后调用 mergeRTLTextNodes()，将同行同父的 RTL token
 * 合并为整句节点，使 jsPDF BiDi 引擎能正确处理阿拉伯语混合方向文本。
 *
 * @param {Element}  element    - 原始根元素（作为坐标原点和遍历起点）
 * @param {Element} [cloneRoot] - iframe 内的克隆根元素；传入时坐标测量在 clone 上进行，
 *                                避免影响原始页面布局；不传则直接在原始 DOM 上测量
 * @returns {Array<{ type:'element'|'text', ... }>} 扁平化节点列表
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

    for (let i = 0; i < measChildren.length; i++) {
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
 * 后处理：将同行、同父元素、同样式的 RTL 文本节点合并为一个整句节点
 *
 * ## 为什么需要合并
 *
 * 浏览器将一行阿拉伯文本按单词拆成多个独立 token，例如：
 *   "مرحبا بالعالم 100%" → ["مرحبا", "بالعالم", "100%"]（三个独立节点）
 * jsPDF 的 BiDi 引擎需要看到完整句子才能正确判断混合方向字符的顺序：
 *   - 单独传入 "100%" 时，BiDi 引擎判断为 LTR 数字，不做处理
 *   - 传入完整 "مرحبا بالعالم 100%" 时，BiDi 引擎识别阿拉伯上下文，输出 "%001 ملاعلاب ابحرم"
 *
 * ## 合并条件（所有条件均需满足）
 * 1. 都是 type:'text' 节点
 * 2. style.direction 都是 'rtl'
 * 3. 在同一行（与组内最后一个节点的 y 坐标相差 < 2px）
 * 4. 样式完全相同（fontSize / fontFamily / fontWeight / fontStyle / color / textDecoration）
 * 5. 同一个父元素（_origEl 相同）—— 防止跨单元格、跨段落合并
 *
 * ## 合并后节点的特殊字段
 * - _isRTLMerged: true    标记供 text.js 路径 2 识别，走整体渲染而非分段渲染
 * - _rightEdge: number    最右侧单词的右边界 px，作为 doc.text(align:'right') 的基准点
 *
 * @param {Array} nodes - collectNodes walk 阶段产出的原始节点列表
 * @returns {Array} 合并后的节点列表，非 RTL 或不满足条件的节点保持原样
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
      _origEl: rightmostNode._origEl,
      _isRTLMerged: true,
      _rightEdge: rightmostNode.x + rightmostNode.width, // 最右 token 的右边界，align:'right' 基准点
    });

    i = j; // 跳过已合并的节点
  }

  return result;
}
