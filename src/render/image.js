/**
 * 渲染图片节点到 PDF，支持跨页裁切
 *
 * ## 工作原理
 *
 * preloadImages 阶段（iframe 销毁前）已将图片同步绘制到 canvas 并保存到 node._srcCanvas，
 * 同时记录原始像素尺寸（node.naturalWidth / node.naturalHeight）。
 * 渲染时直接从 node._srcCanvas 裁出当前页可见区域的像素片段写入 PDF，
 * 无需重新创建 Image 对象或等待异步解码。
 *
 * ## 坐标约定（进入本函数时）
 *
 * node.y 已由 renderNode 转换为页内相对坐标（全局 y − offsetYpx）。
 * 本函数内部通过加回 offsetYpx 还原全局坐标，再与页面边界取交集，
 * 得到当前页内可见的像素范围。
 *
 * @param {Object} node          - 图片节点（node._srcCanvas 为全图 canvas，y 为页内相对坐标）
 * @param {Object} ctx           - 渲染上下文
 * @param {number} offsetYpx     - 当前页内容区起始全局 y（px）
 */
function drawImage({ node, ctx, offsetYpx = 0 }) {
  const { doc, contentHeightPx, toPdfX, toPdfY, toMM } = ctx;
  // node._srcCanvas 是 preloadImages 阶段预先绘制好的全图 canvas
  const srcCanvas = node._srcCanvas;
  if (!srcCanvas) return;

  const natW = node.naturalWidth;
  const natH = node.naturalHeight;
  if (!natW || !natH) return;

  // 还原全局坐标（node.y 是页内相对值，加回 offsetYpx 得到全局 px）
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

  // 从已预先绘制的全图 canvas 裁出当前页可见片段
  // IMG 用 JPEG（无透明，体积小）；CANVAS 用 PNG（保留透明通道，避免透明区域变黑）
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
