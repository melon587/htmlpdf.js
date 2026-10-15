/**
 * @file form/textarea.js
 * TEXTAREA 渲染
 *
 * 与 INPUT 的差异：
 * 1. Y 坐标从顶部 + paddingTop 开始，不垂直居中
 * 2. value 按硬换行 \n 分段，每段用 getTextWidth 逐字符测量 wrap，逐行绘制
 * 3. 按 scrollTop 偏移，还原用户当前可见区域
 */

import { parsePx, parseColor } from '../../utils';
import {
  getCombinedFontStyle,
  buildEffectiveFontConfig,
  drawTextLine,
  segmentTextByFont,
  applySegmentFont,
} from '../text';
import { parsePaddingPx, applyNodeClip } from './utils';

/**
 * 根据 value/placeholder 决定渲染文本和颜色
 *
 * @param {object} formMeta - TEXTAREA 表单元数据（value, placeholder, scrollTop）
 * @param {object} style    - 元素 computedStyle 快照
 * @returns {{ text: string, color: string } | null} 有文本时返回文本和颜色，否则返回 null
 */
function resolveTextareaContent(formMeta, style) {
  const { value, placeholder } = formMeta;

  if (value !== '') {
    return { text: value, color: style.color };
  }

  if (placeholder !== '') {
    return { text: placeholder, color: 'rgb(153, 153, 153)' };
  }

  return null;
}

/**
 * 用 getTextWidth 逐字符测量，将单段硬行 wrap 成视觉行数组。
 * 每个字符先切换到对应字体再测宽，保证混合字体宽度准确。
 *
 * @param {object} opts
 * @param {string} opts.hardLine            - 不含 \n 的单段文字
 * @param {object} opts.ctx                 - 渲染上下文（含 doc）
 * @param {number} opts.maxWidthMm          - 内容区可用宽度（mm）
 * @param {string} opts.fontStyle           - jsPDF 字体样式
 * @param {Array}  opts.effectiveFontConfig - 字体优先级配置
 * @returns {string[]} 视觉行数组
 */
function wrapHardLine({
  hardLine,
  ctx,
  maxWidthMm,
  fontStyle,
  effectiveFontConfig,
}) {
  const { doc } = ctx;
  const lines = [];
  let currentLine = '';
  let currentWidth = 0;

  for (const char of hardLine) {
    const seg = segmentTextByFont(char, effectiveFontConfig)[0] ?? {
      font: null,
    };
    applySegmentFont(ctx, seg, fontStyle);
    const charWidth = doc.getTextWidth(char);

    if (currentWidth + charWidth > maxWidthMm && currentLine !== '') {
      lines.push(currentLine);
      currentLine = char;
      currentWidth = charWidth;
    } else {
      currentLine += char;
      currentWidth += charWidth;
    }
  }

  if (currentLine !== '') {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * 把文本按硬换行分段，每段用 wrapHardLine 展开为视觉行数组。
 *
 * @param {object} opts
 * @param {string} opts.text                - 原始文本（含 \n）
 * @param {object} opts.ctx                 - 渲染上下文
 * @param {number} opts.maxWidthMm          - 内容区可用宽度（mm）
 * @param {string} opts.fontStyle           - jsPDF 字体样式
 * @param {Array}  opts.effectiveFontConfig - 字体优先级配置
 * @returns {string[]} 展开后的视觉行数组（空行保留为 ''）
 */
function expandToVisualLines({
  text,
  ctx,
  maxWidthMm,
  fontStyle,
  effectiveFontConfig,
}) {
  const hardLines = text.split('\n');
  const visualLines = [];

  for (const hardLine of hardLines) {
    if (hardLine === '') {
      visualLines.push('');
    } else {
      const wrapped = wrapHardLine({
        hardLine,
        ctx,
        maxWidthMm,
        fontStyle,
        effectiveFontConfig,
      });
      for (const wl of wrapped) {
        visualLines.push(wl);
      }
    }
  }

  return visualLines;
}

/**
 * 绘制 TEXTAREA 文本内容到 PDF
 *
 * 逻辑：
 * 1. 有 value → 以 CSS color 逐行绘制 value（含 wrap 和 scrollTop 偏移）
 * 2. 无 value 且有 placeholder → 以灰色（#999）绘制 placeholder（单行）
 * 3. 两者均无 → 不绘制
 *
 * @param {object} params.node             - 调整后的节点（y 为页内坐标）
 * @param {object} params.ctx              - 渲染上下文
 * @param {Array}  params.sortedFontConfig - 已排序字体配置数组
 * @returns {void}
 */
export function drawTextareaText({ node, ctx, sortedFontConfig = [] }) {
  const { formMeta, style } = node;

  if (formMeta && formMeta.tag === 'TEXTAREA') {
    const fontSize = parsePx(style.fontSize);
    const resolved = resolveTextareaContent(formMeta, style);

    if (fontSize > 0 && resolved) {
      const { text, color } = resolved;
      const { doc, toPt, toPdfX, toPdfY, toMM } = ctx;

      doc.setFontSize(toPt(fontSize));

      const rgb = parseColor(color);
      if (rgb) {
        doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      } else {
        doc.setTextColor(0, 0, 0);
      }

      const fontStyle = getCombinedFontStyle(style.fontStyle, style.fontWeight);
      const paddingLeft = parsePaddingPx(style.paddingLeft);
      const paddingRight = parsePaddingPx(style.paddingRight);
      const paddingTop = parsePaddingPx(style.paddingTop);
      const lineHeightPx = parsePx(style.lineHeight) || fontSize * 1.2;
      const { scrollTop = 0, scrollbarWidth = 0 } = formMeta;

      // scrollbarWidth = offsetWidth - clientWidth，排除滚动条占用，对齐浏览器内容区宽度
      const contentWidthMm = toMM(
        node.width - paddingLeft - paddingRight - scrollbarWidth,
      );
      const x = toPdfX(node.x + paddingLeft);

      doc.saveGraphicsState();
      applyNodeClip(doc, node, ctx);

      const effectiveFontConfig = buildEffectiveFontConfig(
        { pdfFont: node.pdfFont },
        sortedFontConfig,
      );

      const visualLines = expandToVisualLines({
        text,
        ctx,
        maxWidthMm: contentWidthMm,
        fontStyle,
        effectiveFontConfig,
      });

      for (let i = 0; i < visualLines.length; i += 1) {
        const line = visualLines[i];
        // baseline: 'middle'，y 取行中线：paddingTop + fontSize/2 + 行间距累加
        const yPx =
          node.y + paddingTop + fontSize / 2 + lineHeightPx * i - scrollTop;
        const y = toPdfY(yPx);

        if (line !== '') {
          drawTextLine({ line, ctx, x, y, fontStyle, effectiveFontConfig });
        }
      }

      doc.restoreGraphicsState();
    }
  }
}
