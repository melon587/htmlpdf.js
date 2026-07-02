// IMG/CANVAS 支持跨页裁切，不使用 avoid；TR/SVG/VIDEO 保持 avoid 避免跨页撕裂
const AUTO_AVOID_TAGS = new Set(['TR', 'SVG', 'VIDEO']);

/**
 * 判断一个元素是否可见
 */
export function isVisible(style) {
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    parseFloat(style.opacity) > 0
  );
}

/**
 * 匹配 CSS 选择器（支持 id/class 简写）
 */
export function matchesSelector(el, selector) {
  if (el) {
    if (el.matches?.(selector)) {
      return true;
    }

    if (selector.startsWith('#') && el.id === selector.slice(1)) {
      return true;
    }

    if (selector.startsWith('.') && el.classList?.contains(selector.slice(1))) {
      return true;
    }
  }

  return false;
}

/**
 * 转换px
 */
export function parsePx(val) {
  return parseFloat(val) || 0;
}

/**
 * 解析 CSS 颜色字符串 → [r, g, b]
 * 支持：rgb(...) / rgba(...) / #RGB / #RRGGBB / #RRGGBBAA
 */
export function parseColor(colorStr) {
  if (
    !colorStr ||
    colorStr === 'transparent' ||
    colorStr === 'rgba(0, 0, 0, 0)'
  )
    return null;

  // rgb / rgba
  const rgbMatch = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch)
    return [
      parseInt(rgbMatch[1]),
      parseInt(rgbMatch[2]),
      parseInt(rgbMatch[3]),
    ];

  // #hex (#RGB 或 #RRGGBB 或 #RRGGBBAA)
  const hexMatch = colorStr.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }

    // 6 or 8 digits — ignore alpha channel
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  return null;
}

/**
 * 获取元素的 page-break 属性值
 */
export function getPageBreak(el) {
  const v = el.getAttribute('page-break');
  if (v !== null) {
    return v === '' || v === true ? 'before' : v;
  }

  if (AUTO_AVOID_TAGS.has(el.tagName)) return 'avoid';

  return null;
}

/**
 * 解析 background-size 的单个分量值（百分比 / px），不处理 auto
 * @param {string} val   - 分量字符串，如 '50%' / '200px'
 * @param {number} ref   - 对应方向的元素尺寸（mm），用于百分比计算
 * @returns {number} 计算后的尺寸（mm）
 */
export function parseBgSizeVal(val, ref) {
  if (val.endsWith('%')) return (parseFloat(val) / 100) * ref;

  return parsePx(val);
}

/**
 * 解析 background-position 的单个分量值（关键字 / 百分比 / px）
 * @param {string} val     - 分量字符串，如 'left' / 'center' / '50%' / '10px'
 * @param {number} elSize  - 对应方向的元素尺寸（mm）
 * @param {number} imgSize - 对应方向的图片尺寸（mm）
 * @returns {number} 图片在该方向的偏移量（mm）
 */
export function parseBgPosVal(val, elSize, imgSize) {
  if (val === 'left' || val === 'top') return 0;

  if (val === 'right' || val === 'bottom') return elSize - imgSize;

  if (val === 'center') return (elSize - imgSize) / 2;

  if (val.endsWith('%')) return (parseFloat(val) / 100) * (elSize - imgSize);

  return parsePx(val);
}

/**
 * 将 charRanges 转换为 CSS unicode-range 声明
 * @param {Array<[number, number]>} charRanges - 字符范围数组，每项为 [start, end]
 * @returns {string} 如 'unicode-range: U+0600-06FF;'，无范围时返回空字符串
 */
export function buildUnicodeRange(charRanges) {
  if (!charRanges || charRanges.length === 0) return '';

  const ranges = charRanges
    .map(
      ([start, end]) =>
        `U+${start.toString(16).toUpperCase()}-${end.toString(16).toUpperCase()}`,
    )
    .join(', ');

  return `unicode-range: ${ranges};`;
}

/**
 * 生成单个 @font-face CSS 规则字符串
 * @param {Object} config     - 字体配置项
 * @param {string} fontBase64 - 字体的 Base64 数据
 * @returns {string} @font-face 规则字符串
 */
export function buildFontFaceRule(config, fontBase64) {
  const unicodeRange = buildUnicodeRange(config.charRanges);

  return `@font-face {
  font-family: '${config.fontFamily}';
  font-style: ${config.fontStyle || 'normal'};
  font-weight: ${config.fontWeight || 400};
  src: url(data:font/truetype;charset=utf-8;base64,${fontBase64}) format('truetype');
  ${unicodeRange}
}`;
}

/**
 * 检测 canvas 是否含有透明像素（alpha < 255）
 * 无法读取像素时（跨域等）保守返回 true
 * @param {HTMLCanvasElement} canvasEl
 * @returns {boolean}
 */
export function canvasHasAlpha(canvasEl) {
  try {
    const ctx2d = canvasEl.getContext('2d');
    if (!ctx2d || canvasEl.width === 0 || canvasEl.height === 0) return false;

    const pixels = ctx2d.getImageData(
      0,
      0,
      canvasEl.width,
      canvasEl.height,
    ).data;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 255) return true;
    }

    return false;
  } catch (_) {
    return true;
  }
}

/**
 * 解码 CSS content 属性值（移除引号，处理转义）
 * @param {string} content - CSS content 属性值（如 '"Hello"' 或 '"\f00d"'）
 * @returns {string} 解码后的文本内容
 */
export function decodeCSSContent(content) {
  if (!content || content === 'none' || content === 'normal') {
    return '';
  }

  // 移除首尾引号
  let str = content.trim();
  if (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'"))
  ) {
    str = str.slice(1, -1);
  }

  // 处理转义序列
  str = str.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });

  // 处理其他转义字符
  str = str.replace(/\\(.)/g, '$1');

  return str;
}

/**
 * 复制伪元素样式到 span 元素
 *
 * ## 功能说明
 *
 * 将 CSS 伪元素（::before / ::after）的计算样式复制到真实 DOM 元素（span），
 * 使物化后的伪元素在浏览器中呈现出与原始伪元素相同的视觉效果。
 *
 * ## 策略
 *
 * 1. **保留原始布局属性**：
 *    - 不强制修改 position/display，让浏览器自然布局
 *    - 对于绝对定位伪元素，复制 top/left/right/bottom
 *
 * 2. **性能优化**：
 *    - 提前判断 isPositioned，避免重复条件判断
 *    - 使用局部变量 spanStyle，避免 ESLint no-param-reassign 警告
 *
 * 3. **样式覆盖范围**：
 *    - 文本样式：color, fontSize, fontWeight, fontStyle, fontFamily, lineHeight
 *    - 盒模型：width, height, padding, margin
 *    - 背景：backgroundColor（跳过透明背景）
 *    - 边框：borderWidth, borderStyle, borderColor, borderRadius
 *    - 定位：position, top, left, right, bottom（仅限绝对/固定定位）
 *
 * ## 使用场景
 *
 * 在 document-cloner.js 的 materializePseudoElements() 函数中调用，
 * 将伪元素物化为真实 DOM 元素时复制样式。
 *
 * @param {HTMLSpanElement} span - 目标 span 元素（物化后的伪元素）
 * @param {CSSStyleDeclaration} pseudoStyle - 伪元素的计算样式（getComputedStyle 返回值）
 *
 * @example
 * const beforeStyle = window.getComputedStyle(el, '::before');
 * const span = document.createElement('span');
 * copyPseudoStyles(span, beforeStyle);
 * el.insertBefore(span, el.firstChild);
 */
export function copyPseudoStyles(span, pseudoStyle) {
  // 提前判断是否为定位元素，避免重复判断（性能优化）
  const isPositioned =
    pseudoStyle.position === 'absolute' || pseudoStyle.position === 'fixed';

  // 需要复制的样式属性列表
  const stylesToCopy = {
    // 布局和定位（保留原始值）
    position: pseudoStyle.position,
    display: pseudoStyle.display || 'inline',

    // 文本
    color: pseudoStyle.color,
    fontSize: pseudoStyle.fontSize,
    fontWeight: pseudoStyle.fontWeight,
    fontStyle: pseudoStyle.fontStyle,
    fontFamily: pseudoStyle.fontFamily,
    lineHeight: pseudoStyle.lineHeight,
    verticalAlign: pseudoStyle.verticalAlign,

    // 盒模型
    width: pseudoStyle.width !== 'auto' ? pseudoStyle.width : null,
    height: pseudoStyle.height !== 'auto' ? pseudoStyle.height : null,
    paddingTop: pseudoStyle.paddingTop,
    paddingRight: pseudoStyle.paddingRight,
    paddingBottom: pseudoStyle.paddingBottom,
    paddingLeft: pseudoStyle.paddingLeft,
    marginTop: pseudoStyle.marginTop,
    marginRight: pseudoStyle.marginRight,
    marginBottom: pseudoStyle.marginBottom,
    marginLeft: pseudoStyle.marginLeft,

    // 背景
    backgroundColor:
      pseudoStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
      pseudoStyle.backgroundColor !== 'transparent'
        ? pseudoStyle.backgroundColor
        : null,

    // 定位属性（如果是绝对/固定定位）
    top: isPositioned ? pseudoStyle.top : null,
    left: isPositioned ? pseudoStyle.left : null,
    right: isPositioned ? pseudoStyle.right : null,
    bottom: isPositioned ? pseudoStyle.bottom : null,
  };

  const spanStyle = span.style;

  // 应用样式（跳过 null 值）
  Object.entries(stylesToCopy).forEach(([prop, value]) => {
    if (value !== null) {
      spanStyle[prop] = value;
    }
  });

  // 边框（需要组合属性）
  if (pseudoStyle.borderTopWidth !== '0px') {
    spanStyle.borderTop = `${pseudoStyle.borderTopWidth} ${pseudoStyle.borderTopStyle} ${pseudoStyle.borderTopColor}`;
  }

  if (pseudoStyle.borderRightWidth !== '0px') {
    spanStyle.borderRight = `${pseudoStyle.borderRightWidth} ${pseudoStyle.borderRightStyle} ${pseudoStyle.borderRightColor}`;
  }

  if (pseudoStyle.borderBottomWidth !== '0px') {
    spanStyle.borderBottom = `${pseudoStyle.borderBottomWidth} ${pseudoStyle.borderBottomStyle} ${pseudoStyle.borderBottomColor}`;
  }

  if (pseudoStyle.borderLeftWidth !== '0px') {
    spanStyle.borderLeft = `${pseudoStyle.borderLeftWidth} ${pseudoStyle.borderLeftStyle} ${pseudoStyle.borderLeftColor}`;
  }

  // 边框圆角
  if (pseudoStyle.borderRadius && pseudoStyle.borderRadius !== '0px') {
    spanStyle.borderRadius = pseudoStyle.borderRadius;
  }
}
