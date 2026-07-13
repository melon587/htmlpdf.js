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
 * 根据 CSS font-family 查找匹配的字体配置
 * @param {string} cssFontFamily - CSS font-family 值（已规范化，去除引号）
 * @param {Array} sortedFontConfig - 已排序的字体配置数组
 * @returns {Object|null} 匹配的字体配置，无匹配返回 null
 */
function findFontByFamily(cssFontFamily, sortedFontConfig) {
  if (!cssFontFamily || !sortedFontConfig) return null;

  // 规范化：转小写、去除引号和空格
  const normalizedFamily = cssFontFamily
    .toLowerCase()
    .replace(/["']/g, '')
    .trim();

  for (const config of sortedFontConfig) {
    if (
      config.fontFamily &&
      config.fontFamily.toLowerCase().trim() === normalizedFamily
    ) {
      return config;
    }
  }

  return null;
}

/**
 * 解析 pdf-font 属性值为字体名数组
 * 支持：
 * - JS 数组（:pdf-font="['roboto','notoSansArabic']" Vue 动态绑定）
 * - 逗号分隔字符串 "roboto,notoSansArabic"（静态 attribute）
 * - 单字符串 "roboto"
 * @param {string|string[]} pdfFont - pdf-font 属性值
 * @returns {string[]} 字体名数组，按用户声明的优先级排列
 */
function parsePdfFontNames(pdfFont) {
  if (!pdfFont) return [];

  // 已经是数组（Vue :pdf-font 动态绑定传入）
  if (Array.isArray(pdfFont)) {
    return pdfFont.map((s) => String(s).trim()).filter(Boolean);
  }

  // 字符串：按逗号分割，支持 "roboto" 和 "roboto,notoSansArabic"
  return String(pdfFont)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 根据节点的 pdf-font 属性，构造本节点实际使用的字体优先级列表（仅对当前节点生效）
 *
 * 完整优先级链（对每个字符独立决策）：
 * 1. pdf-font 数组中有 charRanges 的字体 → 按声明顺序插到最前，精确匹配优先
 * 2. pdf-font 数组中第一个无 charRanges 的字体 → 作为本节点的 isDefault 兜底
 * 3. 全局 charRanges 匹配
 * 4. 全局 isDefault 字体
 * 5. helvetica（渲染层兜底，不在此处理）
 *
 * 用法示例：
 *   pdf-font="roboto"                      → 单字体，无 charRanges 时作为本节点 isDefault
 *   :pdf-font="['roboto','notoSansArabic']"  → roboto 精确匹配其 charRanges 范围，
 *                                             notoSansArabic 精确匹配其 charRanges 范围，
 *                                             若两者都无 charRanges，第一个作为 isDefault
 *
 * @param {Object} node - 文本节点，包含 pdfFont 字段
 * @param {Array} sortedFontConfig - 全局已排序字体配置数组
 * @returns {Array} 用于本节点分段渲染的字体配置数组
 */
function buildEffectiveFontConfig(node, sortedFontConfig) {
  if (!node.pdfFont) return sortedFontConfig;

  const fontNames = parsePdfFontNames(node.pdfFont);
  if (fontNames.length === 0) return sortedFontConfig;

  // 按声明顺序找到各字体的 config
  const resolvedConfigs = fontNames
    .map((name) => {
      const config = findFontByFamily(name, sortedFontConfig);
      if (!config) {
        console.warn(
          `[htmlpdf] pdf-font: "${name}" not found in config, skipping`,
        );
      }

      return config;
    })
    .filter(Boolean);

  if (resolvedConfigs.length === 0) return sortedFontConfig;

  // 有 charRanges 的字体：按顺序插到最前（精确匹配）
  const withRanges = resolvedConfigs.filter((c) => c.charRanges);
  // 无 charRanges 的字体：取最后一个作为本节点 isDefault（用户声明的最低优先级兜底）
  const withoutRanges = resolvedConfigs.filter((c) => !c.charRanges);
  // 取第一个无 charRanges 的字体作为 isDefault（声明顺序即优先级）
  const nodeDefault = withoutRanges[0] ?? null;

  // 从全局配置中移除已被 pdf-font 占据的位置，避免重复
  const resolvedSet = new Set(resolvedConfigs);
  let rest = sortedFontConfig.filter((f) => !resolvedSet.has(f));

  // 如果有 nodeDefault，替换掉全局 isDefault 的兜底位置
  if (nodeDefault) {
    rest = rest.filter((f) => !f.isDefault);
    rest = [...rest, { ...nodeDefault, isDefault: true }];
  }

  return [...withRanges, ...rest];
}

/**
 * 根据字符码点找到对应的字体配置
 * 优先级：charRanges 精确匹配 > isDefault 字体 > null
 * 返回 null 表示用户配置中无匹配，由渲染层用 helvetica 兜底
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
 * 设置字体，失败则回退到 helvetica
 */
function setFont(ctx, fontFamily, fontStyle) {
  const { doc } = ctx;
  try {
    doc.setFont(fontFamily, fontStyle);
  } catch (e) {
    // 字体未注册时静默回退；如遇渲染异常请检查 fontFamily 是否已通过 addFont 注册
    doc.setFont('helvetica', fontStyle);
  }
}

/**
 * 渲染合并后的 RTL 节点（整体一次性渲染，使用 align:right + rightEdge）
 * 不走 segmentTextByFont，避免逐 segment 右对齐导致重叠
 */
function drawRTLMerged({ node, ctx, y, fontStyle, effectiveFontConfig }) {
  const { doc, toPdfX } = ctx;
  const rightEdge = toPdfX(node._rightEdge);

  // 字体选择：取 isDefault（用户为本节点指定的兜底字体），找不到再取列表第一个，再回退 helvetica
  const selectedFontFamily =
    effectiveFontConfig.find((f) => f.isDefault)?.fontFamily ??
    effectiveFontConfig[0]?.fontFamily ??
    'helvetica';

  setFont(ctx, selectedFontFamily, fontStyle);

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
 * 渲染路径：
 * - 路径 1：无自定义字体配置 → helvetica 直接渲染
 * - 路径 2：合并后的 RTL 节点（_isRTLMerged）→ 整体一次性渲染（不可分段，否则 align:right 重叠）
 * - 路径 3：其余节点 → buildEffectiveFontConfig 融入 pdf-font 优先级后，segmentTextByFont 分段渲染
 *
 * 字体优先级（路径 2/3）：
 *   pdf-font+charRanges > pdf-font(无charRanges 作 isDefault) > 全局 charRanges > isDefault > helvetica
 *
 * 坐标系：node.x/node.y 为相对克隆根元素左上角的 px 值，经 ctx 转换为 PDF mm 坐标。
 *
 * @param {Object} node - 文本节点
 * @param {Object} ctx - 坐标转换上下文（toMM / toPt / toPdfX / toPdfY / doc）
 * @param {number} clipTop - 裁剪顶部（mm），节点顶部低于此值时跳过
 * @param {Array}  sortedFontConfig - 已按 priority 排好序的字体配置数组
 */
function drawText({ node, ctx, clipTop, sortedFontConfig = [] }) {
  if (!node.text) return;

  const { doc, toMM, toPt, toPdfX, toPdfY } = ctx;
  const nodeTop = toMM(node.y);
  if (nodeTop < clipTop) {
    return;
  }

  const { style } = node;
  const fontSize = parsePx(style.fontSize);
  if (fontSize <= 0) return;

  // ── 公共前置：颜色、字号 ────────────────────────────────────────────────────
  const color = parseColor(style.color);
  if (color) doc.setTextColor(color[0], color[1], color[2]);
  else doc.setTextColor(0, 0, 0);

  doc.setFontSize(toPt(fontSize));

  const fontStyle = getCombinedFontStyle(style.fontStyle, style.fontWeight);
  const x = toPdfX(node.x);
  const y = toPdfY(node.y) + toMM(fontSize);
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

  // 路径 2/3 共用：融入 pdf-font 优先级，只算一次
  const effectiveFontConfig = buildEffectiveFontConfig(node, sortedFontConfig);

  // ── 路径 2：合并后的 RTL 节点 → 整体渲染，提前 return ──────────────────────
  // 不走 segmentTextByFont，避免逐 segment 右对齐导致重叠
  if (isRTL && node._isRTLMerged) {
    drawRTLMerged({
      node,
      ctx,
      y,
      fontStyle,
      effectiveFontConfig,
    });

    return;
  }

  // ── 路径 3：分 segment 渲染（LTR + RTL 单词混合）──────────────────────────
  // 优先级：pdf-font+charRanges > pdf-font(无charRanges,作isDefault) > 全局charRanges > isDefault > fallback
  const segments = segmentTextByFont(node.text, effectiveFontConfig);
  let curX = x;

  for (const segment of segments) {
    // 设置该 segment 的字体
    if (segment.font?.fontFamily) {
      setFont(ctx, segment.font.fontFamily, fontStyle);
    } else {
      doc.setFont('helvetica', fontStyle);
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

export { drawText, parsePdfFontNames, buildEffectiveFontConfig };
