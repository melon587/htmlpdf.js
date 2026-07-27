import { canvasToDataUrl, parsePx } from '../utils';

/**
 * 渲染图片节点到 PDF，支持跨页裁切
 * node._srcCanvas 为 preloadImages 阶段预绘的全图 canvas；
 * 内部通过加回 offsetYpx 还原全局坐标，裁出当前页可见片段写入 PDF。
 *
 * 图片只渲染在 padding-box（border-box 减去四边 border 宽度）内，
 * 使 border 不被图片覆盖，与浏览器行为一致。
 *
 * @param {Object} node      - 图片节点（y 为页内相对坐标）
 * @param {Object} ctx       - 渲染上下文
 * @param {number} offsetYpx - 当前页内容区起始全局 y（px）
 */
function drawImage({ node, ctx, offsetYpx = 0 }) {
  const { doc, contentHeightPx, toPdfX, toPdfY, toMM } = ctx;
  const srcCanvas = node._srcCanvas;
  if (!srcCanvas) return;

  const natW = node.naturalWidth;
  const natH = node.naturalHeight;
  if (!natW || !natH) return;

  // border 宽度（px），图片渲染区域向内缩进
  const { style } = node;
  const bTop = parsePx(style.borderTopWidth);
  const bRight = parsePx(style.borderRightWidth);
  const bBottom = parsePx(style.borderBottomWidth);
  const bLeft = parsePx(style.borderLeftWidth);

  // 图片内容区（padding-box）在全局坐标中的位置
  const globalNodeTopPx = node.y + offsetYpx + bTop;
  const globalNodeBottomPx = node.y + offsetYpx + node.height - bBottom;
  const imgHeightPx = node.height - bTop - bBottom;

  const pageBottomGlobalPx = offsetYpx + contentHeightPx;

  // 当前页内可见的全局 px 范围（限定在 padding-box 内）
  const visibleTopPx = Math.max(globalNodeTopPx, offsetYpx);
  const visibleBottomPx = Math.min(globalNodeBottomPx, pageBottomGlobalPx);

  if (visibleBottomPx <= visibleTopPx) return;

  // 可见区域对应原始图片的像素范围
  const ratioTop =
    imgHeightPx > 0 ? (visibleTopPx - globalNodeTopPx) / imgHeightPx : 0;
  const ratioBottom =
    imgHeightPx > 0 ? (visibleBottomPx - globalNodeTopPx) / imgHeightPx : 1;

  const srcY = Math.round(ratioTop * natH);
  const srcH = Math.round((ratioBottom - ratioTop) * natH);

  if (srcH <= 0) return;

  // PDF 目标坐标（padding-box 可见区域，向内缩进 border）
  const pdfX = toPdfX(node.x + bLeft);
  const pdfY = toPdfY(visibleTopPx - offsetYpx);
  const pdfW = toMM(node.width - bLeft - bRight);
  const pdfH = toMM(visibleBottomPx - visibleTopPx);

  // 从全图 canvas 裁出当前页可见片段（IMG→JPEG，CANVAS→PNG 保留透明通道）
  const format = node._srcFormat || 'JPEG';
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = natW;
  cropCanvas.height = srcH;
  cropCanvas
    .getContext('2d')
    .drawImage(srcCanvas, 0, srcY, natW, srcH, 0, 0, natW, srcH);

  const dataUrl = canvasToDataUrl(cropCanvas, format === 'PNG');

  try {
    doc.addImage(dataUrl, format, pdfX, pdfY, pdfW, pdfH);
  } catch (e) {
    console.warn('[htmlpdf] addImage failed:', e);
  }
}

export { drawImage };
