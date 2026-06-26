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
 * 优先级：charRanges 精确匹配 > isDefault 字体 > null（由外部 fallbackFontFamily 兜底）
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
 * 绘制文本节点（支持混合字体）
 * @param {Object} doc - jsPDF 实例
 * @param {Object} node - 文本节点
 * @param {Object} ctx - 渲染上下文
 * @param {number} clipTop - 裁剪顶部（mm），节点顶部低于此值时跳过
 * @param {Array} sortedFontConfig - 已按 priority 排好序的字体配置数组
 * @param {string} fallbackFontFamily - 兜底字体名
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

  const color = parseColor(style.color);
  if (color) doc.setTextColor(color[0], color[1], color[2]);
  else doc.setTextColor(0, 0, 0);

  doc.setFontSize(ctx.toPt(fontSize));

  const fontStyle = getCombinedFontStyle(style.fontStyle, style.fontWeight);
  const x = ctx.toPdfX(node.x);
  const y = ctx.toPdfY(node.y) + ctx.toMM(fontSize);
  const isRTL = style.direction === 'rtl';

  // 无字体配置，走简单路径
  if (!sortedFontConfig || sortedFontConfig.length === 0) {
    doc.setFont('helvetica', fontStyle);

    if (isRTL) {
      // RTL 文本：使用 jsPDF 的 RTL 处理，但不使用 align
      // 关键：使用浏览器计算的坐标，让 RTL 引擎处理文本顺序即可
      doc.text(node.text, x, y, {
        baseline: 'alphabetic',
        isInputVisual: false,
        isOutputVisual: true,
        isInputRtl: true,
        isOutputRtl: false,
        isSymmetricSwapping: true,
      });
    } else {
      doc.text(node.text, x, y, { baseline: 'alphabetic' });
    }

    return;
  }

  // 混合字体渲染:按字体分段分别绘制
  const segments = segmentTextByFont(node.text, sortedFontConfig);

  let curX = x;

  for (const segment of segments) {
    if (segment.font?.fontFamily) {
      try {
        doc.setFont(segment.font.fontFamily, fontStyle);
      } catch {
        doc.setFont(fallbackFontFamily, fontStyle);
      }
    } else {
      doc.setFont(fallbackFontFamily, fontStyle);
    }

    // 如果在 RTL 环境中且使用了自定义字体，使用 RTL 引擎
    const shouldUseRTL = isRTL && segment.font?.fontFamily;

    if (shouldUseRTL) {
      // 检查是否为合并后的 RTL 节点
      const isRTLMerged = node._isRTLMerged;

      if (isRTLMerged) {
        // 合并后的 RTL 节点：使用保存的最右边单词右边界作为对齐点
        const rightEdge = ctx.toPdfX(node._rightEdge);

        doc.text(segment.text, rightEdge, y, {
          baseline: 'alphabetic',
          align: 'right', // 右对齐
          isInputVisual: false,
          isOutputVisual: true,
          isInputRtl: true,
          isOutputRtl: false,
          isSymmetricSwapping: true,
        });
      } else {
        // 未合并的单个 RTL 单词：使用浏览器坐标
        doc.text(segment.text, curX, y, {
          baseline: 'alphabetic',
          isInputVisual: false,
          isOutputVisual: true,
          isInputRtl: true,
          isOutputRtl: false,
          isSymmetricSwapping: true,
        });
      }
    } else {
      doc.text(segment.text, curX, y, { baseline: 'alphabetic' });
    }

    // 继续向右累积（浏览器已经处理了 RTL 布局）
    curX += doc.getTextWidth(segment.text);
  }
}

export { drawText };
