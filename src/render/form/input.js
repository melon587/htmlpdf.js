/**
 * @file form/input.js
 * INPUT[type=text/number/email/…] 渲染
 */

import { parsePx, parseColor } from '../../utils';
import {
  getCombinedFontStyle,
  buildEffectiveFontConfig,
  segmentTextByFont,
  drawSegmentAligned,
  drawMultiSegmentAligned,
} from '../text';
import { parsePaddingPx, applyNodeClip } from './utils';

/**
 * 判断 INPUT type 是否属于文本类输入框（需要绘制 value 文本）
 * @param {string} type - origEl.type 的小写值
 * @returns {boolean}
 */
function isTextInputType(type) {
  const TEXT_TYPES = new Set([
    'text',
    'number',
    'email',
    'search',
    'url',
    'tel',
    'password',
    'date',
    'time',
    'datetime-local',
    'month',
    'week',
    'color',
  ]);

  return TEXT_TYPES.has(type);
}

/**
 * 计算文本在 INPUT 框内的渲染坐标（居左，垂直居中于内容区）
 *
 * @param {object} node        - 已调整为页内坐标的节点
 * @param {object} ctx         - 渲染上下文
 * @param {number} paddingLeft - 左侧内边距（px）
 * @returns {{ x: number, y: number }} mm 坐标
 */
function resolveInputTextPos(node, ctx, paddingLeft) {
  const { toPdfX, toPdfY } = ctx;
  const x = toPdfX(node.x + paddingLeft);
  const y = toPdfY(node.y + node.height / 2);

  return { x, y };
}

/**
 * 根据 value/placeholder 决定渲染文本和颜色
 *
 * @param {object} formMeta - INPUT 表单元数据（type, value, placeholder）
 * @param {object} style    - 元素 computedStyle 快照
 * @returns {{ text: string, color: string } | null} 文本和颜色，两者均无时返回 null
 */
function resolveInputTextAndColor(formMeta, style) {
  const hasValue = formMeta.value !== '';
  const hasPlaceholder = formMeta.placeholder !== '';

  if (hasValue === false && hasPlaceholder === false) return null;

  if (hasValue) {
    const text =
      formMeta.type === 'password'
        ? '\u2022'.repeat(formMeta.value.length)
        : formMeta.value;

    return { text, color: style.color };
  }

  return { text: formMeta.placeholder, color: 'rgb(153, 153, 153)' };
}

/**
 * 绘制 INPUT 文本内容到 PDF
 *
 * 逻辑：
 * 1. 有 value → 以 CSS color 绘制 value 文本
 * 2. 无 value 且有 placeholder → 以灰色（#999）绘制 placeholder
 * 3. 两者均无 → 不绘制
 *
 * clip 到 INPUT 元素区域，防止文字溢出边框。
 * password 类型：value 显示为等长 • 符号。
 *
 * @param {object} params.node            - 调整后的节点（y 为页内坐标）
 * @param {object} params.ctx             - 渲染上下文
 * @param {Array}  params.sortedFontConfig - 已排序字体配置数组
 * @returns {void}
 */
export function drawInputText({ node, ctx, sortedFontConfig = [] }) {
  const { formMeta, style } = node;

  if (formMeta && isTextInputType(formMeta.type)) {
    const fontSize = parsePx(style.fontSize);
    const resolved = resolveInputTextAndColor(formMeta, style);

    if (fontSize > 0 && resolved) {
      const { text, color } = resolved;
      const { doc, toPt } = ctx;

      doc.setFontSize(toPt(fontSize));

      const rgb = parseColor(color);
      if (rgb) {
        doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      } else {
        doc.setTextColor(0, 0, 0);
      }

      const fontStyle = getCombinedFontStyle(style.fontStyle, style.fontWeight);
      const paddingLeft = parsePaddingPx(style.paddingLeft);
      const { x, y } = resolveInputTextPos(node, ctx, paddingLeft);

      doc.saveGraphicsState();
      applyNodeClip(doc, node, ctx);

      const effectiveFontConfig = buildEffectiveFontConfig(
        { pdfFont: node.pdfFont },
        sortedFontConfig,
      );
      const segments = segmentTextByFont(text, effectiveFontConfig);

      if (segments.length <= 1) {
        drawSegmentAligned({
          text,
          fontFamily: segments[0]?.font?.fontFamily ?? null,
          ctx,
          x,
          y,
          fontStyle,
          textAlign: 'left',
        });
      } else {
        drawMultiSegmentAligned({
          segments,
          textAlign: 'left',
          x,
          y,
          fontStyle,
          ctx,
        });
      }

      doc.restoreGraphicsState();
    }
  }
}
