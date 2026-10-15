/**
 * @file form/utils.js
 * 表单渲染共用工具函数
 */

import { parsePx } from '../../utils';

/**
 * 解析 CSS padding 字符串为像素数值，解析失败返回 0
 * @param {string} val - CSS paddingLeft / paddingTop 等值，如 "8px"
 * @returns {number}
 */
export function parsePaddingPx(val) {
  const n = parsePx(val);

  return Number.isFinite(n) ? n : 0;
}

/**
 * 建立矩形 clip 路径，裁剪后续绘制内容到 node 区域
 * 必须在 saveGraphicsState() 之后调用，配套使用 restoreGraphicsState() 释放
 *
 * rect(style=null) 只建路径不绘制，clip() 后必须 discardPath() 清除路径状态，
 * 否则 clip 区域不生效（参考 background.js 同样用法）。
 *
 * @param {object} doc  - jsPDF 实例
 * @param {object} node - 页内坐标节点（y 为页内 px）
 * @param {object} ctx  - 渲染上下文
 * @returns {void}
 */
export function applyNodeClip(doc, node, ctx) {
  const { toPdfX, toPdfYmm, toMM } = ctx;
  doc.rect(
    toPdfX(node.x),
    toPdfYmm(toMM(node.y)),
    toMM(node.width),
    toMM(node.height),
    null,
  );
  doc.clip();
  doc.discardPath();
}
