/**
 * @file form/select.js
 * SELECT 渲染：绘制当前选中项文本到 PDF
 */

import { parsePx, parseColor } from '../../utils';
import {
  getCombinedFontStyle,
  buildEffectiveFontConfig,
  drawTextLine,
} from '../text';
import { parsePaddingPx, applyNodeClip } from './utils';

/**
 * 计算文本在 SELECT 框内的渲染坐标（居左，垂直居中于内容区）
 *
 * @param {object} node        - 已调整为页内坐标的节点
 * @param {object} ctx         - 渲染上下文
 * @param {number} paddingLeft - 左侧内边距（px）
 * @returns {{ x: number, y: number }} mm 坐标
 */
function resolveSelectTextPos(node, ctx, paddingLeft) {
  const { toPdfX, toPdfY } = ctx;
  const x = toPdfX(node.x + paddingLeft);
  const y = toPdfY(node.y + node.height / 2);

  return { x, y };
}

/**
 * 绘制 SELECT 选中项文本到 PDF
 *
 * 逻辑：
 * 1. 有选中项（value 非空）→ 以 CSS color 绘制选中文本
 * 2. 无选中项 → 不绘制
 *
 * clip 到 SELECT 元素区域，防止文字溢出边框。
 *
 * @param {object} params.node            - 调整后的节点（y 为页内坐标）
 * @param {object} params.ctx             - 渲染上下文
 * @param {Array}  params.sortedFontConfig - 已排序字体配置数组
 * @returns {void}
 */
export function drawSelectText({ node, ctx, sortedFontConfig = [] }) {
  const { formMeta, style } = node;

  if (formMeta && formMeta.tag === 'SELECT' && formMeta.value !== '') {
    const fontSize = parsePx(style.fontSize);

    if (fontSize > 0) {
      const { doc, toPt } = ctx;

      doc.setFontSize(toPt(fontSize));

      const rgb = parseColor(style.color);
      if (rgb) {
        doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      } else {
        doc.setTextColor(0, 0, 0);
      }

      const fontStyle = getCombinedFontStyle(style.fontStyle, style.fontWeight);
      const paddingLeft = parsePaddingPx(style.paddingLeft);
      const { x, y } = resolveSelectTextPos(node, ctx, paddingLeft);

      doc.saveGraphicsState();
      applyNodeClip(doc, node, ctx);

      const effectiveFontConfig = buildEffectiveFontConfig(
        { pdfFont: node.pdfFont },
        sortedFontConfig,
      );

      drawTextLine({
        line: formMeta.value,
        ctx,
        x,
        y,
        fontStyle,
        effectiveFontConfig,
      });

      doc.restoreGraphicsState();
    }
  }
}
