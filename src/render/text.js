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
 * 根据字符找到对应的字体配置
 * @param {string} char - 单个字符
 * @param {Array} fontConfig - 字体配置数组
 * @returns {Object|null} 匹配的字体配置，找不到返回 null
 */
function findFontForChar(char, sortedFontConfig) {
  const code = char.charCodeAt(0);

  for (const config of sortedFontConfig) {
    if (config.isDefault) return config;

    if (config.charRanges) {
      for (const [start, end] of config.charRanges) {
        if (code >= start && code <= end) return config;
      }
    }
  }

  return (
    sortedFontConfig.find((f) => f.isDefault) || sortedFontConfig[0] || null
  );
}

/**
 * 把混合语言文本按字体分段
 * @param {string} text - 原始文本，如 "Hello 你好 World"
 * @param {Array} fontConfig - 字体配置数组
 * @returns {Array} 分段结果，如 [{ text: "Hello ", font: {...} }, { text: "你好", font: {...} }, ...]
 */
function segmentTextByFont(text, fontConfig) {
  if (!text) return [];

  if (!fontConfig || fontConfig.length === 0) {
    return [{ text, font: null }];
  }

  // 排序一次，所有字符共用
  const sortedFontConfig = fontConfig
    .slice()
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const segments = [];
  let currentFont = null;
  let currentText = '';

  // 遍历每个字符，按字体分段
  for (const char of text) {
    const font = findFontForChar(char, sortedFontConfig);

    // 同字体：累积
    if (currentFont && font && currentFont.fontFamily === font.fontFamily) {
      currentText += char;
    } else {
      // 字体切换：保存上一段
      if (currentText) {
        segments.push({ text: currentText, font: currentFont });
      }

      currentFont = font;
      currentText = char;
    }
  }

  // 保存最后一段
  if (currentText) {
    segments.push({ text: currentText, font: currentFont });
  }

  return segments;
}

/**
 * 绘制文本节点（支持混合字体）
 * @param {Object} doc - jsPDF 实例
 * @param {Object} node - 文本节点
 * @param {Object} ctx - 渲染上下文
 * @param {number} pageOffsetY - 当前页顶部偏移（mm）
 * @param {number} clipTop - 裁剪顶部（mm）
 * @param {Array} fontConfig - 字体配置数组
 */
function drawText({ doc, node, ctx, pageOffsetY, clipTop, fontConfig = [] }) {
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

  // 计算组合的字体样式
  const fontStyle = getCombinedFontStyle(style.fontStyle, style.fontWeight);

  // 如果没有字体配置，走老逻辑（单字体）
  if (!fontConfig || fontConfig.length === 0) {
    doc.setFont('helvetica', fontStyle);
    const x = ctx.toPdfX(node.x);
    const y = ctx.toPdfY(node.y, pageOffsetY) + ctx.toMM(fontSize);
    doc.text(node.text, x, y, { baseline: 'alphabetic' });

    return;
  }

  // 混合字体渲染
  const segments = segmentTextByFont(node.text, fontConfig);
  let x = ctx.toPdfX(node.x);
  const y = ctx.toPdfY(node.y, pageOffsetY) + ctx.toMM(fontSize);

  // 获取兜底字体
  const defaultFont = fontConfig.find((f) => f.isDefault);
  const fallbackFontFamily = defaultFont ? defaultFont.fontFamily : 'helvetica';

  for (const segment of segments) {
    if (segment.font && segment.font.fontFamily) {
      try {
        doc.setFont(segment.font.fontFamily, fontStyle);
      } catch (e) {
        doc.setFont(fallbackFontFamily, fontStyle);
      }
    } else {
      doc.setFont(fallbackFontFamily, fontStyle);
    }

    doc.text(segment.text, x, y, { baseline: 'alphabetic' });
    x += doc.getTextWidth(segment.text);
  }
}

export { drawText };
