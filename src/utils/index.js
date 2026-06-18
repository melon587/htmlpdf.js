const AUTO_AVOID_TAGS = new Set(['TR', 'IMG', 'SVG', 'VIDEO', 'CANVAS']);

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
 * 解析 background-size 的单个分量值（auto / 百分比 / px）
 * @param {string} val   - 分量字符串，如 'auto' / '50%' / '200px'
 * @param {number} ref   - 对应方向的元素尺寸（mm）
 * @param {number} nat   - 图片在该方向的原始尺寸（mm）
 * @param {number} natRef- 图片在另一方向的原始尺寸（mm），用于 auto 等比
 * @returns {number} 计算后的尺寸（mm）
 */
export function parseBgSizeVal(val, ref, nat, natRef) {
  if (val === 'auto') return (nat / natRef) * ref;

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
