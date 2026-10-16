/**
 * @file form/checkbox.js
 * INPUT[type=checkbox] 渲染
 *
 * 仅处理原生外观（appearance != none）的 checkbox：
 * - 未选中：空心圆角方框（borderColor / 灰色）
 * - 选中：实心蓝色填充方框（accentColor / #0067C0）+ 白色对勾
 *
 * appearance:none 的 checkbox 由用户 CSS 自行控制外观，此处不插手。
 */

import { parseColor } from '../../utils';

/** 外框线宽（mm） */
const STROKE_WIDTH_MM = 0.4;

/** 外框圆角半径相对边长的比例 */
const BORDER_RADIUS_RATIO = 0.15;

/** 外框默认描边颜色 */
const DEFAULT_STROKE_COLOR = [118, 118, 118]; // #767676

/**
 * 选中状态默认填充色（与 radio 对齐，来自 OS 系统强调色默认值）
 * accent-color:auto 时无法从 getComputedStyle 读到具体色值，回退此默认值。
 */
const DEFAULT_ACCENT_COLOR = [0, 103, 192]; // #0067C0

/**
 * 解析外框描边颜色
 * 取 borderColor，失败则回退默认灰色。
 *
 * @param {object} style - computedStyle 快照
 * @returns {[number, number, number]} [r, g, b]
 */
function resolveStrokeColor(style) {
  const fromBorder = parseColor(style.borderColor || style.borderTopColor);
  if (fromBorder) return [fromBorder[0], fromBorder[1], fromBorder[2]];

  return DEFAULT_STROKE_COLOR;
}

/**
 * 解析选中状态填充色
 * 取 CSS accent-color（用户自定义时为具体色值），auto 时回退默认蓝色。
 *
 * @param {object} style - computedStyle 快照
 * @returns {[number, number, number]} [r, g, b]
 */
function resolveAccentColor(style) {
  const { accentColor } = style;
  if (accentColor && accentColor !== 'auto') {
    const parsed = parseColor(accentColor);
    if (parsed) return [parsed[0], parsed[1], parsed[2]];
  }

  return DEFAULT_ACCENT_COLOR;
}

/**
 * 检测 checkbox 是否使用原生外观
 *
 * @param {object} style - computedStyle 快照
 * @returns {boolean}
 */
function hasNativeAppearance(style) {
  const appearance = style.appearance || style.webkitAppearance || '';

  return appearance !== 'none';
}

/**
 * 绘制选中状态对勾（白色）
 * 对勾由两段线段组成：左下角 → 中下 → 右上，比例对齐浏览器视觉
 *
 * @param {object} doc   - jsPDF 实例
 * @param {number} x     - 方框左上角 x（mm，PDF 坐标）
 * @param {number} y     - 方框左上角 y（mm，PDF 坐标）
 * @param {number} size  - 方框边长（mm）
 * @returns {void}
 */
function drawCheckmark(doc, x, y, size) {
  // 对勾三个点的相对坐标（比例系数基于浏览器视觉对齐）
  const p1x = x + size * 0.18;
  const p1y = y + size * 0.52;
  const p2x = x + size * 0.4;
  const p2y = y + size * 0.72;
  const p3x = x + size * 0.82;
  const p3y = y + size * 0.26;

  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(size * 0.12);
  doc.setLineCap('round');
  doc.setLineJoin('round');
  doc.lines(
    [
      [p2x - p1x, p2y - p1y],
      [p3x - p2x, p3y - p2y],
    ],
    p1x,
    p1y,
    [1, 1],
    'S',
  );
}

/**
 * 绘制 INPUT[type=checkbox] 到 PDF
 *
 * 逻辑：
 * 1. appearance:none → 跳过（用户自定义样式，CSS 渲染流程已覆盖）
 * 2. 未选中 → 空心圆角方框（描边色取 borderColor / 灰色）
 * 3. 选中 → 实心填充方框（accentColor / 蓝色）+ 白色对勾
 *
 * @param {object} params.node - 调整后的节点（y 为页内坐标）
 * @param {object} params.ctx  - 渲染上下文
 * @returns {void}
 */
export function drawCheckbox({ node, ctx }) {
  const { formMeta, style } = node;

  if (formMeta && formMeta.tag === 'INPUT' && formMeta.type === 'checkbox') {
    if (hasNativeAppearance(style)) {
      const { doc, toPdfX, toPdfY, toMM } = ctx;

      const size = toMM(Math.min(node.width, node.height)) * 0.85;
      const cx = toPdfX(node.x + node.width / 2);
      const cy = toPdfY(node.y + node.height / 2);
      const x = cx - size / 2;
      const y = cy - size / 2;
      const rx = size * BORDER_RADIUS_RATIO;

      doc.saveGraphicsState();

      if (formMeta.checked) {
        // 选中：实心填充方框 + 白色对勾
        const [ar, ag, ab] = resolveAccentColor(style);
        doc.setFillColor(ar, ag, ab);
        doc.setDrawColor(ar, ag, ab);
        doc.setLineWidth(STROKE_WIDTH_MM);
        doc.roundedRect(x, y, size, size, rx, rx, 'FD');

        drawCheckmark(doc, x, y, size);
      } else {
        // 未选中：空心圆角方框
        const [sr, sg, sb] = resolveStrokeColor(style);
        doc.setDrawColor(sr, sg, sb);
        doc.setLineWidth(STROKE_WIDTH_MM);
        doc.roundedRect(x, y, size, size, rx, rx, 'S');
      }

      doc.restoreGraphicsState();
    }
  }
}
