import { parsePx, parseColor } from '../utils';

/**
 * 绘制边框（跨页裁剪：左右边全画，上边只在第一页画，下边只在最后一页画）
 * clipTop/clipBottom（mm）：当前页可见范围
 */
function drawBorder({ doc, node, ctx, clipTop, clipBottom }) {
  const { style } = node;
  const nodeTop = ctx.toMM(node.y);
  const nodeBottom = ctx.toMM(node.y + node.height);

  const x = ctx.toPdfX(node.x);
  const w = ctx.toMM(node.width);

  const drawTop = Math.max(nodeTop, clipTop);
  const drawBottom = Math.min(nodeBottom, clipBottom);
  if (drawBottom <= drawTop) return;

  const yTop = ctx.toPdfYmm(drawTop);
  const yBottom = ctx.toPdfYmm(drawBottom);
  const isFirstPage = nodeTop >= clipTop;
  const isLastPage = nodeBottom <= clipBottom;

  const sides = [
    {
      bw: parsePx(style.borderTopWidth),
      color: style.borderTopColor,
      side: 'top',
    },
    {
      bw: parsePx(style.borderRightWidth),
      color: style.borderRightColor,
      side: 'right',
    },
    {
      bw: parsePx(style.borderBottomWidth),
      color: style.borderBottomColor,
      side: 'bottom',
    },
    {
      bw: parsePx(style.borderLeftWidth),
      color: style.borderLeftColor,
      side: 'left',
    },
  ];

  for (const { bw, color, side } of sides) {
    if (bw <= 0) continue;

    const c = parseColor(color);
    if (!c) continue;

    doc.setDrawColor(c[0], c[1], c[2]);
    doc.setLineWidth(ctx.toMM(bw));

    if (side === 'top' && isFirstPage) doc.line(x, yTop, x + w, yTop);

    if (side === 'bottom' && isLastPage) doc.line(x, yBottom, x + w, yBottom);

    if (side === 'left') doc.line(x, yTop, x, yBottom);

    if (side === 'right') doc.line(x + w, yTop, x + w, yBottom);
  }
}

export { drawBorder };
