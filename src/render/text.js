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
 * 优先级链（有 nodeDefault 时）：
 *   pdf-font+charRanges > pdf-font(无charRanges，作isDefault) > 全局charRanges > 全局isDefault > helvetica
 *
 * 关键语义：
 *   - pdf-font="roboto"（roboto 无 charRanges）：
 *       roboto 优先兜底，全局 charRanges 字体（阿拉伯/中文）排在 roboto 之后。
 *       => 空格、标点等字符由 roboto 渲染，不会被阿拉伯字体抢走。
 *       => 若需要阿拉伯字体，需显式声明：pdf-font="roboto,noto-sans-arabic"
 *   - pdf-font="roboto,noto-sans-arabic"（多字体）：
 *       noto-sans-arabic 的 charRanges 插最前做精确匹配，roboto 作兜底。
 *   - 无 pdf-font：返回全局 sortedFontConfig（charRanges 优先，isDefault 兜底）
 *
 * @param {Object} node            - 文本节点，包含 pdfFont 字段
 * @param {Array}  sortedFontConfig - 全局已排序字体配置数组
 * @returns {Array}
 */
export function buildEffectiveFontConfig(node, sortedFontConfig) {
  if (!node.pdfFont) return sortedFontConfig;

  const fontNames = parsePdfFontNames(node.pdfFont);
  if (fontNames.length === 0) return sortedFontConfig;

  // 找出 pdf-font 声明的所有字体的全部变体（同一 fontFamily 含 bold/italic 等）
  const resolvedConfigs = [];

  for (const name of fontNames) {
    const normalizedName = name.toLowerCase().trim();
    const matched = sortedFontConfig.filter(
      (c) =>
        c.fontFamily && c.fontFamily.toLowerCase().trim() === normalizedName,
    );

    if (matched.length === 0) {
      console.warn(
        `[htmlpdf] pdf-font: "${name}" not found in config, skipping`,
      );
      continue;
    }

    for (const c of matched) resolvedConfigs.push(c);
  }

  if (resolvedConfigs.length === 0) return sortedFontConfig;

  // 分类：显式指定的字体中，有 charRanges 的做精确匹配，无 charRanges 的作 isDefault
  const withRanges = resolvedConfigs.filter((c) => c.charRanges);
  const withoutRanges = resolvedConfigs.filter((c) => !c.charRanges);
  const nodeDefault = withoutRanges[0] ?? null;

  // 从全局配置中移除已被 pdf-font 明确指定的字体，避免重复
  const resolvedSet = new Set(resolvedConfigs);
  const globalRest = sortedFontConfig.filter((f) => !resolvedSet.has(f));

  if (nodeDefault) {
    // 有 nodeDefault（pdf-font 指定了无 charRanges 的字体，如 roboto）：
    // nodeDefault 的全部变体作为 isDefault，全局 charRanges 字体降级排在其后
    // 顺序：pdf-font 的 charRanges > nodeDefault 变体(isDefault) > 全局 charRanges > 全局 isDefault
    const nodeDefaultVariants = withoutRanges.map((c) => ({
      ...c,
      isDefault: true,
    }));
    // 全局剩余字体中，去掉全局 isDefault（已被 nodeDefault 替换），保留全局 charRanges 字体
    const globalCharRanges = globalRest.filter(
      (f) => f.charRanges && !f.isDefault,
    );
    const globalIsDefault = globalRest.filter((f) => f.isDefault);

    // 最终顺序：[pdf-font的charRanges] + [nodeDefault变体] + [全局charRanges] + [全局isDefault降级兜底]
    // 注意：全局 isDefault 此处放最后作为最终兜底（通常和 nodeDefault 是同一字体，resolvedSet 已过滤）
    return [
      ...withRanges,
      ...nodeDefaultVariants,
      ...globalCharRanges,
      ...globalIsDefault,
    ];
  }

  // 无 nodeDefault（pdf-font 指定的字体全都有 charRanges）：
  // 这些字体的 charRanges 插到最前，其余保持全局顺序
  return [...withRanges, ...globalRest];
}

/**
 * 根据字符码点找到对应的字体配置
 *
 * 遍历顺序决定优先级：
 * - 遇到有 charRanges 的条目：检查字符是否在范围内，命中则返回
 * - 遇到 isDefault 的条目（无 charRanges）：直接返回作为兜底，不再继续
 *   => 这保证了 pdf-font 指定的 nodeDefault 字体能真正"挡住"后面的全局 charRanges
 * - 所有条目遍历完没命中：返回 null，由渲染层用 helvetica 兜底
 */
export function findFontForChar(code, sortedFontConfig) {
  for (const config of sortedFontConfig) {
    if (config.charRanges) {
      for (const [start, end] of config.charRanges) {
        if (code >= start && code <= end) return config;
      }
    } else if (config.isDefault) {
      // 遇到 isDefault 条目直接作为兜底返回，阻止后续 charRanges 字体匹配
      return config;
    }
  }

  return null;
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
  const { toPdfX, toPdfY } = ctx;
  const { textAlign, direction, fontStyle: fs, fontWeight: fw } = style;
  const fontStyle = getCombinedFontStyle(fs, fw);
  const isRTL = direction === 'rtl';

  let x;
  if (textAlign === 'right') x = toPdfX(node.x + node.width);
  else if (textAlign === 'center') x = toPdfX(node.x + node.width / 2);
  else x = toPdfX(node.x);

  const y = toPdfY(node.y);

  const rtlOptions = isRTL
    ? {
        isInputVisual: false,
        isOutputVisual: true,
        isInputRtl: true,
        isOutputRtl: false,
        isSymmetricSwapping: true,
      }
    : undefined;

  // 规范化为 jsPDF 支持的对齐值；justify / start / end 等均回退到 left
  const pdfAlign =
    textAlign === 'right' || textAlign === 'center' ? textAlign : 'left';

  return { fontStyle, textAlign: pdfAlign, isRTL, x, y, rtlOptions };
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
 * 多字体多段精确渲染（left / right / center 均支持，LTR / RTL 均支持）
 *
 * LTR（无 rtlOptions）：
 *   left  ：从左锚点正向逐段绘制
 *   right ：x 是右边缘，curX = x - totalWidth 开始正向绘制
 *   center：x 是中点，curX = x - totalWidth/2 开始正向绘制
 *
 * RTL（有 rtlOptions）：
 *   段在视觉上需要反转（Unicode BiDi：逻辑首段在视觉最左，逻辑末段在视觉最右）
 *   反转后，从右锚点向左逐段绘制，每段注入 rtlOptions 处理段内字符顺序：
 *     right ：curX 从 x 开始，每段先减宽度再绘制
 *     left  ：curX 从 x + totalWidth 开始，每段先减宽度再绘制
 *     center：curX 从 x + totalWidth/2 开始，每段先减宽度再绘制
 *
 * @param {Object}  opts
 * @param {Array<{text: string, font: Object|null}>} opts.segments
 * @param {string}  opts.textAlign   - 'left' | 'right' | 'center'
 * @param {number}  opts.x           - left/right 时为对应边缘，center 时为中点（mm）
 * @param {number}  opts.y
 * @param {string}  opts.fontStyle
 * @param {Object}  opts.ctx
 * @param {Object}  [opts.rtlOptions] - RTL 时传入；undefined 表示 LTR
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

  if (rtlOptions) {
    // RTL：逻辑顺序 = 视觉从右到左顺序（Unicode BiDi 段间不反转，index 0 在最右）
    // 从右锚点开始，正向遍历 segments，每段先减去宽度再绘制
    let curX;
    if (textAlign === 'right') curX = x;
    else if (textAlign === 'center') curX = x + totalWidth / 2;
    else curX = x + totalWidth; // left

    for (let i = 0; i < segments.length; i += 1) {
      curX -= widths[i];
      const seg = segments[i];
      applySegmentFont(ctx, seg, fontStyle);
      ctx.doc.text(seg.text, curX, y, {
        baseline: 'top',
        ...rtlOptions,
      });
    }
  } else {
    // LTR：正向逐段绘制，x 为对应锚点
    let curX;
    if (textAlign === 'right') curX = x - totalWidth;
    else if (textAlign === 'center') curX = x - totalWidth / 2;
    else curX = x;

    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      applySegmentFont(ctx, seg, fontStyle);
      ctx.doc.text(seg.text, curX, y, { baseline: 'top' });
      curX += widths[i];
    }
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

  ctx.doc.text(text, x, y, {
    baseline: 'top',
    ...(textAlign !== 'left' && { align: textAlign }),
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
