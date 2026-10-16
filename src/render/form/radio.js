/**
 * @file form/radio.js
 * INPUT[type=radio] 渲染
 *
 * 仅处理原生外观（appearance != none）的 radio：
 * - 外圈空心圆（strokeColor 取 borderColor，回退到 #767676）
 * - 选中时内部实心小圆（fillColor 取 accentColor，auto 时回退到 #0067C0）
 *
 * appearance:none 的 radio 由用户 CSS 自行控制外观（背景/边框/伪元素），
 * 我们的渲染流程已覆盖，此处不插手。
 */

import { parseColor } from '../../utils';

/** 内圆半径相对外圆半径的比例（对齐浏览器默认视觉） */
const INNER_RADIUS_RATIO = 0.45;

/** 外圆线宽（mm） */
const STROKE_WIDTH_MM = 0.4;

/** 外圈默认描边颜色（浏览器系统色近似值） */
const DEFAULT_STROKE_COLOR = [118, 118, 118]; // #767676

/**
 * 选中状态默认填充色（Windows 11 系统强调色默认蓝色）
 * Chromium PaintRadio 颜色来自 CSS accent-color → OS 系统强调色，
 * accent-color:auto 时无法从 getComputedStyle 读到具体色值，回退此默认值。
 */
const DEFAULT_ACCENT_COLOR = [0, 103, 192]; // #0067C0

/**
 * 解析外圈描边颜色
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
  const accentColor = style.accentColor;
  if (accentColor && accentColor !== 'auto') {
    const parsed = parseColor(accentColor);
    if (parsed) return [parsed[0], parsed[1], parsed[2]];
  }

  return DEFAULT_ACCENT_COLOR;
}

/**
 * 检测 radio 是否使用原生外观
 * appearance:none 表示用户已用 CSS 自定义外观，不需要我们画圆圈
 *
 * @param {object} style - computedStyle 快照
 * @returns {boolean}
 */
function hasNativeAppearance(style) {
  const appearance = style.appearance || style.webkitAppearance || '';

  return appearance !== 'none';
}

/**
 * 绘制 INPUT[type=radio] 到 PDF
 *
 * 逻辑：
 * 1. appearance:none → 跳过（用户自定义样式，CSS 渲染流程已覆盖）
 * 2. 原生外观 → 未选中：外圈灰色空心圆；选中：外圈 + 内点都用 accentColor 蓝色
 *
 * @param {object} params.node - 调整后的节点（y 为页内坐标）
 * @param {object} params.ctx  - 渲染上下文
 * @returns {void}
 */
export function drawRadio({ node, ctx }) {
  const { formMeta, style } = node;

  if (formMeta && formMeta.tag === 'INPUT' && formMeta.type === 'radio') {
    if (hasNativeAppearance(style)) {
      const { doc, toPdfX, toPdfY, toMM } = ctx;

      const cx = toPdfX(node.x + node.width / 2);
      const cy = toPdfY(node.y + node.height / 2);
      const r = toMM(Math.min(node.width, node.height) / 2) * 0.8;

      doc.saveGraphicsState();
      doc.setLineWidth(STROKE_WIDTH_MM);

      if (formMeta.checked) {
        // 选中：外圈和内点都用 accentColor
        const [ar, ag, ab] = resolveAccentColor(style);
        doc.setDrawColor(ar, ag, ab);
        doc.circle(cx, cy, r, 'S');
        doc.setFillColor(ar, ag, ab);
        doc.circle(cx, cy, r * INNER_RADIUS_RATIO, 'F');
      } else {
        // 未选中：外圈用 borderColor / 灰色
        const [sr, sg, sb] = resolveStrokeColor(style);
        doc.setDrawColor(sr, sg, sb);
        doc.circle(cx, cy, r, 'S');
      }

      doc.restoreGraphicsState();
    }
  }
}
