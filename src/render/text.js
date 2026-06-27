import { parsePx, parseColor } from '../utils';

/**
 * 计算组合的字体样式
 * @param {string} fontStyle - CSS font-style 值 ('normal' | 'italic')
 * @param {string|number} fontWeight - CSS font-weight 值 ('bold' | '400' | 700 等)
 * @returns {string} jsPDF 字体样式 ('normal' | 'bold' | 'italic' | 'bolditalic')
 */
function getCombinedFontStyle(fontStyle, fontWeight) {
  const isBold = fontWeight === 'bold' || parseInt(fontWeight) >= 700;
  const isItalic = fontStyle === 'italic';

  if (isBold && isItalic) return 'bolditalic';

  if (isBold) return 'bold';

  if (isItalic) return 'italic';

  return 'normal';
}

/**
 * 根据字符码点找到对应的字体配置
 * 优先级：charRanges 精确匹配 > isDefault 字体 > null
 * 返回 null 表示用户配置中无匹配，由渲染层用 fallbackFontFamily（默认 helvetica）兜底
 */
function findFontForChar(code, sortedFontConfig) {
  for (const config of sortedFontConfig) {
    if (!config.charRanges) continue;

    for (const [start, end] of config.charRanges) {
      if (code >= start && code <= end) return config;
    }
  }

  return sortedFontConfig.find((f) => f.isDefault) || null;
}

/**
 * 判断两个字体配置是否相同（fontFamily + fontStyle + fontWeight 全部一致）
 * 用于 segmentTextByFont 合并相邻同字体字符
 */
function isSameFont(a, b) {
  if (a === b) return true;

  if (!a || !b) return false;

  return (
    a.fontFamily === b.fontFamily &&
    a.fontStyle === b.fontStyle &&
    a.fontWeight === b.fontWeight
  );
}

/**
 * 把混合语言文本按字体分段
 * 相邻字符若字体配置完全相同（fontFamily + fontStyle + fontWeight），合并为同一段
 * @param {string} text - 原始文本，如 "Hello 你好 World"
 * @param {Array} sortedFontConfig - 已排序的字体配置数组
 * @returns {Array<{text: string, font: Object|null}>}
 */
function segmentTextByFont(text, sortedFontConfig) {
  if (!text) return [];

  if (!sortedFontConfig || sortedFontConfig.length === 0) {
    return [{ text, font: null }];
  }

  const segments = [];
  let currentFont = null;
  let currentText = '';

  for (const char of text) {
    const font = findFontForChar(char.codePointAt(0), sortedFontConfig);

    if (isSameFont(currentFont, font)) {
      currentText += char;
    } else {
      if (currentText) segments.push({ text: currentText, font: currentFont });

      currentFont = font;
      currentText = char;
    }
  }

  if (currentText) segments.push({ text: currentText, font: currentFont });

  return segments;
}

/**
 * 设置字体，失败则回退到 fallback
 */
function setFont(doc, fontFamily, fontStyle, fallbackFontFamily) {
  try {
    doc.setFont(fontFamily, fontStyle);
  } catch (e) {
    // 字体未注册时静默回退；如遇渲染异常请检查 fontFamily 是否已通过 addFont 注册
    doc.setFont(fallbackFontFamily, fontStyle);
  }
}

/**
 * 渲染合并后的 RTL 节点（整体一次性渲染，使用 align:right + rightEdge）
 * 不走 segmentTextByFont，避免逐 segment 右对齐导致重叠
 */
function drawRTLMerged({
  doc,
  node,
  ctx,
  y,
  fontStyle,
  sortedFontConfig,
  fallbackFontFamily,
}) {
  const rightEdge = ctx.toPdfX(node._rightEdge);

  // 用 segmentTextByFont 找到文本中第一个匹配的自定义字体，避免手写字符范围判断
  const segments = segmentTextByFont(node.text, sortedFontConfig);
  const matchedFont = segments.find((s) => s.font?.fontFamily)?.font;

  setFont(
    doc,
    matchedFont?.fontFamily ?? fallbackFontFamily,
    fontStyle,
    fallbackFontFamily,
  );

  doc.text(node.text, rightEdge, y, {
    baseline: 'alphabetic',
    align: 'right',
    isInputVisual: false,
    isOutputVisual: true,
    isInputRtl: true,
    isOutputRtl: false,
    isSymmetricSwapping: true,
  });
}

/**
 * 绘制文本节点到 PDF（支持混合字体、LTR/RTL 混排）
 *
 * ## 整体渲染流程
 *
 * 每个文本节点（node）由 node-parser 解析自浏览器 DOM，坐标（x/y）直接来自
 * getBoundingClientRect()，单位为 px，渲染时通过 ctx 转换为 PDF mm/pt 坐标。
 *
 * 节点分三条渲染路径：
 *
 * ### 路径 1：无自定义字体配置
 *   - 使用 helvetica 兜底字体渲染
 *   - RTL 文本附加 jsPDF BiDi 选项（isInputRtl/isOutputVisual 等）
 *   - 适用场景：用户未传 fonts 配置，或纯 LTR 英文文档
 *
 * ### 路径 2：合并后的 RTL 节点（node._isRTLMerged = true）
 *   - 由 node-parser 的 mergeRTLTextNodes() 将同行、同父元素的多个 RTL 单词
 *     合并为一个节点，并记录 _rightEdge（最右单词的右边界 px）
 *   - 原因：jsPDF BiDi 引擎需要完整句子上下文才能正确处理 "100%"→"%100"、
 *     括号镜像等；单独的 "100%" token 没有阿拉伯上下文，BiDi 引擎无法判断方向
 *   - 渲染方式：整体文本一次性传给 doc.text()，使用 align:'right' + rightEdge
 *     作为右对齐基准点，让 jsPDF BiDi 引擎处理字符重排序
 *   - 注意：不能走 segmentTextByFont 逐段渲染——每段都 align:right 会导致
 *     所有段叠在同一个 x 坐标上，产生文字重叠
 *   - 字体选择：通过 segmentTextByFont 匹配文本中第一个有自定义字体的 segment
 *
 * ### 路径 3：普通分段渲染（LTR 或未合并的单个 RTL 单词）
 *   - 通过 segmentTextByFont() 将文本按字体配置拆分为多段
 *     例如 "VAT 15% ضريبة" → [{text:"VAT 15% ", font:null}, {text:"ضريبة", font:arabicFont}]
 *   - 每段独立设置字体后渲染，curX 从 node.x 向右累积
 *   - RTL 单词段：使用浏览器已计算好的 curX 坐标 + RTL 引擎处理字符顺序
 *   - LTR 段：普通 doc.text() 渲染
 *   - 适用场景：英阿混排的单行文本、表格标题等
 *
 * @param {Object} doc - jsPDF 实例
 * @param {Object} node - 文本节点，包含 text/x/y/style/_isRTLMerged/_rightEdge 等字段
 * @param {Object} ctx - 渲染上下文，提供 toMM/toPt/toPdfX/toPdfY 等坐标转换方法
 * @param {number} clipTop - 裁剪顶部（mm），节点顶部低于此值时跳过（用于分页边界）
 * @param {Array}  sortedFontConfig - 已按 priority 排好序的字体配置数组
 * @param {string} fallbackFontFamily - 兜底字体名（默认 'helvetica'）
 */
function drawText({
  doc,
  node,
  ctx,
  clipTop,
  sortedFontConfig = [],
  fallbackFontFamily = 'helvetica',
}) {
  if (!node.text) return;

  const nodeTop = ctx.toMM(node.y);
  if (nodeTop < clipTop) return;

  const { style } = node;
  const fontSize = parsePx(style.fontSize);
  if (fontSize <= 0) return;

  // ── 公共前置：颜色、字号 ────────────────────────────────────────────────────
  const color = parseColor(style.color);
  if (color) doc.setTextColor(color[0], color[1], color[2]);
  else doc.setTextColor(0, 0, 0);

  doc.setFontSize(ctx.toPt(fontSize));

  const fontStyle = getCombinedFontStyle(style.fontStyle, style.fontWeight);
  const x = ctx.toPdfX(node.x);
  const y = ctx.toPdfY(node.y) + ctx.toMM(fontSize);
  const isRTL = style.direction === 'rtl';

  // ── 路径 1：无自定义字体配置 → 简单渲染 ────────────────────────────────────
  if (sortedFontConfig.length === 0) {
    doc.setFont('helvetica', fontStyle);
    doc.text(node.text, x, y, {
      baseline: 'alphabetic',
      ...(isRTL && {
        isInputVisual: false,
        isOutputVisual: true,
        isInputRtl: true,
        isOutputRtl: false,
        isSymmetricSwapping: true,
      }),
    });

    return;
  }

  // ── 路径 2：合并后的 RTL 节点 → 整体渲染，提前 return ──────────────────────
  // 不走 segmentTextByFont，避免逐 segment 右对齐导致重叠
  if (isRTL && node._isRTLMerged) {
    drawRTLMerged({
      doc,
      node,
      ctx,
      y,
      fontStyle,
      sortedFontConfig,
      fallbackFontFamily,
    });

    return;
  }

  // ── 路径 3：分 segment 渲染（LTR + RTL 单词混合）──────────────────────────
  const segments = segmentTextByFont(node.text, sortedFontConfig);
  let curX = x;

  for (const segment of segments) {
    // 设置该 segment 的字体
    if (segment.font?.fontFamily) {
      setFont(doc, segment.font.fontFamily, fontStyle, fallbackFontFamily);
    } else {
      doc.setFont(fallbackFontFamily, fontStyle);
    }

    if (isRTL && segment.font?.fontFamily) {
      // RTL 单词（有自定义字体）：使用浏览器坐标 + RTL 引擎处理字符顺序
      doc.text(segment.text, curX, y, {
        baseline: 'alphabetic',
        isInputVisual: false,
        isOutputVisual: true,
        isInputRtl: true,
        isOutputRtl: false,
        isSymmetricSwapping: true,
      });
    } else {
      // LTR 或无自定义字体的 segment
      doc.text(segment.text, curX, y, { baseline: 'alphabetic' });
    }

    curX += doc.getTextWidth(segment.text);
  }
}

export { drawText };
