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
 * 2. pdf-font 数组中最后一个无 charRanges 的字体 → 作为本节点的 isDefault 兜底
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

  // 字体选择：用 buildEffectiveFontConfig 融入 pdf-font 优先级，再取第一个匹配的字体
  const effectiveFontConfig = buildEffectiveFontConfig(node, sortedFontConfig);
  const segments = segmentTextByFont(node.text, effectiveFontConfig);
  const selectedFontFamily =
    segments.find((s) => s.font?.fontFamily)?.font?.fontFamily ??
    fallbackFontFamily;

  setFont(doc, selectedFontFamily, fontStyle, fallbackFontFamily);

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
 * drawText(doc, node, ctx, clipTop, sortedFontConfig, fallbackFontFamily)
 * │
 * ├─ 坐标系
 * │ ├─ 输入坐标（node.x / node.y）
 * │ │ ├─ 来源：node-parser.js 的 collectNodes() 输出
 * │ │ ├─ 坐标系：相对于克隆根元素左上角（iframe 内的独立坐标系）
 * │ │ └─ 单位：px（浏览器像素）
 * │ ├─ 坐标转换（通过 ctx）
 * │ │ ├─ ctx.toPdfX(node.x) → PDF X 坐标（mm，相对于 PDF 页面左边缘）
 * │ │ ├─ ctx.toPdfY(node.y) → PDF Y 坐标（mm，相对于 PDF 页面顶边缘）
 * │ │ └─ ctx.toMM(fontSize) → 字号转换为 mm（基线偏移）
 * │ └─ 最终 PDF 坐标
 * │   ├─ x = ctx.toPdfX(node.x)                       // PDF X 坐标（mm）
 * │   └─ y = ctx.toPdfY(node.y) + ctx.toMM(fontSize)  // PDF Y 坐标（mm）+ 基线偏移
 * │
 * ├─ 路径 1：无自定义字体配置（sortedFontConfig.length === 0）
 * │ ├─ 字体：helvetica（兜底字体）
 * │ ├─ RTL 处理：附加 jsPDF BiDi 选项（isInputRtl/isOutputVisual 等）
 * │ └─ 适用场景：用户未传 fonts 配置，或纯 LTR 英文文档
 * │
 * ├─ 路径 2：合并后的 RTL 节点（isRTL && node._isRTLMerged）
 * │ ├─ 来源：node-parser 的 mergeRTLTextNodes() 合并同行、同父、同样式的 RTL 单词
 * │ │ └─ 记录 _rightEdge（最右单词的右边界 px）
 * │ ├─ 原因：jsPDF BiDi 引擎需要完整句子上下文
 * │ │ ├─ 处理 "100%"→"%100" 的字符重排序
 * │ │ ├─ 处理括号镜像 "(" → ")"
 * │ │ └─ 单独的 "100%" token 没有阿拉伯上下文，BiDi 引擎无法判断方向
 * │ ├─ 字体选择：pdf-font > charRanges > fallback
 * │ ├─ 渲染方式：整体文本一次性传给 doc.text()
 * │ │ ├─ 使用 align:'right' + rightEdge 作为右对齐基准点
 * │ │ └─ 让 jsPDF BiDi 引擎处理字符重排序
 * │ └─ 注意：不能走 segmentTextByFont 逐段渲染
 * │   └─ 每段都 align:right 会导致所有段叠在同一个 x 坐标上，产生文字重叠
 * │
 * └─ 路径 3：普通分段渲染（LTR 或未合并的单个 RTL 单词）
 *   ├─ 步骤 1：字体选择（selectFont）
 *   │ ├─ 优先级 1：pdf-font 属性匹配
 *   │ │ └─ 如果匹配成功，整个节点用该字体渲染（不分段）→ return
 *   │ └─ 优先级 2：pdf-font 未匹配 → 走 charRanges 自动分段
 *   ├─ 步骤 2：自动分段（segmentTextByFont）
 *   │ ├─ 按字体配置拆分文本
 *   │ │ └─ 例如 "VAT 15% ضريبة" → [{text:"VAT 15% ", font:null}, {text:"ضريبة", font:arabicFont}]
 *   │ └─ 每段独立设置字体后渲染，curX 从 node.x 向右累积
 *   ├─ 步骤 3：逐段渲染
 *   │ ├─ RTL 单词段：使用浏览器已计算好的 curX 坐标 + RTL 引擎处理字符顺序
 *   │ └─ LTR 段：普通 doc.text() 渲染
 *   └─ 适用场景：英阿混排的单行文本、表格标题等
 *
 * @param {Object} doc - jsPDF 实例
 * @param {Object} node - 文本节点，包含 text/x/y/style/pdfFont/_isRTLMerged/_rightEdge 等字段
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
  // pdf-font（若有）已融入 effectiveFontConfig 的优先级，统一走 segmentTextByFont
  // 优先级：pdf-font+charRanges > pdf-font(无charRanges,作isDefault) > 全局charRanges > isDefault > fallback
  const effectiveFontConfig = buildEffectiveFontConfig(node, sortedFontConfig);
  const segments = segmentTextByFont(node.text, effectiveFontConfig);
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
