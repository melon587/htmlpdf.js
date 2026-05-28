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
 * 转换px
 */
export function parsePx(val) {
  return parseFloat(val) || 0;
}

/**
 * 解析 CSS 颜色字符串 → [r, g, b]
 */
export function parseColor(colorStr) {
  if (
    !colorStr ||
    colorStr === 'transparent' ||
    colorStr === 'rgba(0, 0, 0, 0)'
  )
    return null;

  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;

  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
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
