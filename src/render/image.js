/**
 * 绘制图片（只在第一页渲染，图片不做跨页裁剪）
 */
function drawImage({ doc, node, ctx, pageOffsetY, clipTop }) {
  if (!node.src) return;

  const nodeTop = ctx.toMM(node.y);
  if (nodeTop < clipTop) return;

  const x = ctx.toPdfX(node.x);
  const y = ctx.toPdfY(node.y, pageOffsetY);
  const w = ctx.toMM(node.width);
  const h = ctx.toMM(node.height);

  try {
    doc.addImage(node.src, 'JPEG', x, y, w, h);
  } catch (e) {
    console.warn('[htmlpdf] addImage failed:', e);
  }
}

export { drawImage };
