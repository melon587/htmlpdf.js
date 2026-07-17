import { parsePx, parseColor } from '../utils';

/**
 * 计算组合的字体样式
 * @param {string} fontStyle - CSS font-style 值 ('normal' | 'italic')
 * @param {string|number} fontWeight - CSS font-weight 值 ('bold' | '400' | 700 等)
 * @returns {string} jsPDF 字体样式 ('normal' | 'bold' | 'italic' | 'bolditalic')
 */
export function getCombinedFontStyle(fontStyle, fontWeight) {
  const isBold = fontWeight === 'bold' || parseInt(fontWeight) >= 700;
  const isItalic = fontStyle === 'italic';

  if (isBold && isItalic) return 'bolditalic';

  if (isBold) return 'bold';

  if (isItalic) return 'italic';

  return 'normal';
}

/**
 * 根据 css font-family 查找匹配的字体配置
 * @param {string} cssFontFamily
 * @param {Array} sortedFontConfig
 * @returns {Object|null}
 */
export function findFontByFamily(cssFontFamily, sortedFontConfig) {
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
 * 支持数组（Vue 动态绑定）、逗号分隔字符串、单字符串
 * @param {string|string[]} pdfFont
 * @returns {string[]}
 */
export function parsePdfFontNames(pdfFont) {
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
 * 根据节点的 pdf-font 属性，构造本节点实际使用的字体优先级列表
 *
 * 优先级链：pdf-font+charRanges > pdf-font(无charRanges 作 isDefault) > 全局 charRanges > isDefault > helvetica
 *
 * @param {Object} node            - 文本节点，包含 pdfFont 字段
 * @param {Array}  sortedFontConfig - 全局已排序字体配置数组
 * @returns {Array}
 */
export function buildEffectiveFontConfig(node, sortedFontConfig) {
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

  // 有 charRanges → 插到最前（精确匹配）；无 charRanges → 第一个作为 isDefault
  const withRanges = resolvedConfigs.filter((c) => c.charRanges);
  const withoutRanges = resolvedConfigs.filter((c) => !c.charRanges);
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
export function findFontForChar(code, sortedFontConfig) {
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
export function isSameFont(a, b) {
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
export function segmentTextByFont(text, sortedFontConfig) {
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
export function setFont(ctx, fontFamily, fontStyle) {
  const { doc } = ctx;
  try {
    doc.setFont(fontFamily, fontStyle);
  } catch (e) {
    // 字体未注册时静默回退；如遇渲染异常请检查 fontFamily 是否已通过 addFont 注册
    doc.setFont('helvetica', fontStyle);
  }
}

/**
 * 将文本颜色和字号写入 doc（副作用）
 * @param {Object} doc      - jsPDF 实例
 * @param {Object} style    - 节点 CSS 样式
 * @param {number} fontSize - 已解析的像素字号
 * @param {Function} toPt   - px → pt 转换函数
 */
export function applyTextStyle(doc, style, fontSize, toPt) {
  const color = parseColor(style.color);

  if (color) {
    doc.setTextColor(color[0], color[1], color[2]);
  } else {
    doc.setTextColor(0, 0, 0);
  }

  doc.setFontSize(toPt(fontSize));
}

/**
 * 根据节点样式和坐标上下文，计算文本渲染所需的公共布局参数（纯函数）
 * @param {Object}   node     - 文本节点
 * @param {Object}   style    - 节点 CSS 样式
 * @param {number}   fontSize - 已解析的像素字号
 * @param {Object}   ctx      - 渲染上下文
 * @returns {{ fontStyle: string, textAlign: string, isRTL: boolean, x: number, y: number, rtlOptions: Object|undefined }}
 */
export function resolveTextLayout(node, style, fontSize, ctx) {
  const { toPdfX, toPdfY, toMM } = ctx;
  const { textAlign, direction, fontStyle: fs, fontWeight: fw } = style;
  const fontStyle = getCombinedFontStyle(fs, fw);
  const isRTL = direction === 'rtl';

  let x;
  if (textAlign === 'right') x = toPdfX(node.x + node.width);
  else if (textAlign === 'center') x = toPdfX(node.x + node.width / 2);
  else x = toPdfX(node.x);

  const y = toPdfY(node.y) + toMM(fontSize);

  const rtlOptions = isRTL
    ? {
        isInputVisual: false,
        isOutputVisual: true,
        isInputRtl: true,
        isOutputRtl: false,
        isSymmetricSwapping: true,
      }
    : undefined;

  return { fontStyle, textAlign, isRTL, x, y, rtlOptions };
}

/**
 * 为单个文本段设置字体（副作用），无字体时回退 helvetica
 * @param {Object} ctx
 * @param {{font: Object|null}} segment
 * @param {string} fontStyle
 */
export function applySegmentFont(ctx, segment, fontStyle) {
  if (segment.font?.fontFamily) {
    setFont(ctx, segment.font.fontFamily, fontStyle);
  } else {
    ctx.doc.setFont('helvetica', fontStyle);
  }
}

/**
 * 测量各段在各自字体下的宽度（副作用：会切换 doc 当前字体）
 * @param {Array<{text: string, font: Object|null}>} segments
 * @param {string} fontStyle
 * @param {Object} ctx
 * @returns {number[]} 与 segments 等长的宽度数组（mm）
 */
export function measureSegmentWidths(segments, fontStyle, ctx) {
  return segments.map((segment) => {
    applySegmentFont(ctx, segment, fontStyle);

    return ctx.doc.getTextWidth(segment.text);
  });
}

/**
 * 多字体多段精确渲染（left / right / center 均支持）
 *
 * left  ：从左锚点正向逐段绘制
 * right ：从右锚点反向排列（segments 反转后正向绘制）
 * center：计算总宽后从中点左移半宽正向绘制
 *
 * @param {Object}  opts
 * @param {Array<{text: string, font: Object|null}>} opts.segments
 * @param {string}  opts.textAlign   - 'left' | 'right' | 'center'
 * @param {number}  opts.x           - left/right 时为对应边缘，center 时为中点（mm）
 * @param {number}  opts.y
 * @param {string}  opts.fontStyle
 * @param {Object}  opts.ctx
 * @param {Object}  [opts.rtlOptions] - RTL 时逐段传入，触发 jsPDF BiDi 重排
 */
export function drawMultiSegmentAligned({
  segments,
  textAlign,
  x,
  y,
  fontStyle,
  ctx,
  rtlOptions,
}) {
  const widths = measureSegmentWidths(segments, fontStyle, ctx);
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);

  const isRight = textAlign === 'right';
  const orderedSegments = isRight ? [...segments].reverse() : segments;
  const orderedWidths = isRight ? [...widths].reverse() : widths;

  let curX;
  if (isRight) curX = x - totalWidth;
  else if (textAlign === 'center') curX = x - totalWidth / 2;
  else curX = x; // left

  for (let i = 0; i < orderedSegments.length; i++) {
    const seg = orderedSegments[i];
    applySegmentFont(ctx, seg, fontStyle);

    ctx.doc.text(seg.text, curX, y, {
      baseline: 'alphabetic',
      ...rtlOptions,
    });
    curX += orderedWidths[i];
  }
}

/**
 * 整体渲染一段文本（right / center / left 均适用）
 * 适用于：无自定义字体的简单路径、单段对齐路径
 * @param {string|null} fontFamily - null 时回退 helvetica
 */
export function drawSegmentAligned({
  text,
  fontFamily,
  ctx,
  x,
  y,
  fontStyle,
  textAlign,
  rtlOptions,
}) {
  applySegmentFont(
    ctx,
    { font: fontFamily ? { fontFamily } : null },
    fontStyle,
  );

  const align =
    textAlign === 'right' || textAlign === 'center' ? textAlign : undefined;

  ctx.doc.text(text, x, y, {
    baseline: 'alphabetic',
    ...(align && { align }),
    ...rtlOptions,
  });
}

/**
 * 绘制文本节点到 PDF（支持混合字体、LTR/RTL 混排）
 *
 * 渲染路径：
 * 1. 单段 → drawSegmentAligned（jsPDF align 选项处理锚点；无字体时 helvetica 兜底）
 * 2. 多段 → drawMultiSegmentAligned 逐段精确定位（left / right / center 统一）
 *
 * @param {Object} node           - 文本节点
 * @param {Object} ctx            - 渲染上下文
 * @param {number} clipTop        - 裁剪顶部（mm），节点顶部低于此值时跳过
 * @param {Array}  sortedFontConfig - 已排序字体配置
 */
export function drawText({ node, ctx, clipTop, sortedFontConfig = [] }) {
  if (!node.text) return;

  const { doc, toMM, toPt } = ctx;
  if (toMM(node.y) < clipTop) return;

  const { style } = node;
  const fontSize = parsePx(style.fontSize);
  if (fontSize <= 0) return;

  applyTextStyle(doc, style, fontSize, toPt);

  // ── 坐标（x 锚点按 textAlign 计算）、公共参数 ────────────────────────────────
  const { fontStyle, textAlign, isRTL, x, y, rtlOptions } = resolveTextLayout(
    node,
    style,
    fontSize,
    ctx,
  );

  const effectiveFontConfig = buildEffectiveFontConfig(node, sortedFontConfig);

  // ── 路径 1/2：统一分段渲染（left / right / center）──────────────────────────
  // 单段：整体一次渲染，让 jsPDF align 选项处理锚点偏移（简单高效）
  // 多段：逐段量宽后精确定位，统一走 drawMultiSegmentAligned
  const segments = segmentTextByFont(node.text, effectiveFontConfig);

  if (segments.length <= 1) {
    drawSegmentAligned({
      text: node.text,
      fontFamily: segments[0]?.font?.fontFamily ?? null,
      ctx,
      x,
      y,
      fontStyle,
      textAlign,
      rtlOptions: isRTL ? rtlOptions : undefined,
    });

    return;
  }

  drawMultiSegmentAligned({
    segments,
    textAlign,
    x,
    y,
    fontStyle,
    ctx,
    rtlOptions: isRTL ? rtlOptions : undefined,
  });
}
