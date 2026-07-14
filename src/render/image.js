/**
 * 渲染图片节点到 PDF，支持跨页裁切
 * node._srcCanvas 为 preloadImages 阶段预绘的全图 canvas；
 * 内部通过加回 offsetYpx 还原全局坐标，裁出当前页可见片段写入 PDF。
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

  // 还原全局坐标
  const globalNodeTopPx = node.y + offsetYpx;
  const globalNodeBottomPx = globalNodeTopPx + node.height;

  const pageBottomGlobalPx = offsetYpx + contentHeightPx;

  // 当前页内可见的全局 px 范围
  const visibleTopPx = Math.max(globalNodeTopPx, offsetYpx);
  const visibleBottomPx = Math.min(globalNodeBottomPx, pageBottomGlobalPx);

  if (visibleBottomPx <= visibleTopPx) return;

  // 可见区域对应原始图片的像素范围
  const ratioTop = (visibleTopPx - globalNodeTopPx) / node.height;
  const ratioBottom = (visibleBottomPx - globalNodeTopPx) / node.height;

  const srcY = Math.round(ratioTop * natH);
  const srcH = Math.round((ratioBottom - ratioTop) * natH);

  if (srcH <= 0) return;

  // PDF 目标坐标（可见区域在页面上的位置）
  const pdfX = toPdfX(node.x);
  const pdfY = toPdfY(visibleTopPx - offsetYpx);
  const pdfW = toMM(node.width);
  const pdfH = toMM(visibleBottomPx - visibleTopPx);

  // 从全图 canvas 裁出当前页可见片段（IMG→JPEG，CANVAS→PNG 保留透明通道）
  const format = node._srcFormat || 'JPEG';
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = natW;
  cropCanvas.height = srcH;
  cropCanvas
    .getContext('2d')
    .drawImage(srcCanvas, 0, srcY, natW, srcH, 0, 0, natW, srcH);

  const dataUrl =
    format === 'PNG'
      ? cropCanvas.toDataURL('image/png')
      : cropCanvas.toDataURL('image/jpeg', 0.92);

  try {
    doc.addImage(dataUrl, format, pdfX, pdfY, pdfW, pdfH);
  } catch (e) {
    console.warn('[htmlpdf] addImage failed:', e);
  }
}

export { drawImage };
