/**
 * 渲染图片节点到 PDF
 *
 * @param {Object} doc     - jsPDF 实例
 * @param {Object} node    - 图片节点
 * @param {Object} ctx     - 渲染上下文
 * @param {number} clipTop - 裁剪顶部（mm），节点 y 坐标小于此值时跳过
 */
function drawImage({ doc, node, ctx, clipTop }) {
  if (!node.src) return;

  const nodeTop = ctx.toMM(node.y);
  if (nodeTop < clipTop) return;

  const x = ctx.toPdfX(node.x);
  const y = ctx.toPdfY(node.y);
  const w = ctx.toMM(node.width);
  const h = ctx.toMM(node.height);

  try {
    doc.addImage(node.src, 'JPEG', x, y, w, h);
  } catch (e) {
    console.warn('[htmlpdf] addImage failed:', e);
  }
}

export { drawImage };
