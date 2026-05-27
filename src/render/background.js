import { parseColor } from '../utils';

/**
 * 绘制背景色
 * clipTop/clipBottom（mm）：当前页的可见范围，用于跨页裁剪
 * 只绘制节点与当前页交叉的那一段高度
 */
function drawBackground({ doc, node, ctx, pageOffsetY, clipTop, clipBottom }) {
  const color = parseColor(node.style.backgroundColor);
  if (!color) return;

  const nodeTop = ctx.toMM(node.y);
  const nodeBottom = ctx.toMM(node.y + node.height);

  const drawTop = Math.max(nodeTop, clipTop);
  const drawBottom = Math.min(nodeBottom, clipBottom);
  if (drawBottom <= drawTop) return;

  const x = ctx.toPdfX(node.x);
  const y = ctx.toPdfYmm(drawTop, pageOffsetY);
  const w = ctx.toMM(node.width);
  const h = drawBottom - drawTop;

  doc.setFillColor(color[0], color[1], color[2]);
  doc.rect(x, y, w, h, 'F');
}

export { drawBackground };
