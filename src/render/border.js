import { parsePx, parseColor } from '../utils';

/**
 * 解析 CSS border 简写字符串，例如 '1px solid #d9d9d9' 或 '1px solid rgb(200,200,200)'
 * 返回 { bw, color } 或 null
 */
function parseBorderString(borderStr) {
  if (!borderStr) return null;

  // 提取宽度（第一个数字+px）
  const widthMatch = borderStr.match(/(\d+(?:\.\d+)?)\s*px/);
  if (!widthMatch) return null;

  const bw = parseFloat(widthMatch[1]);
  if (bw <= 0) return null;

  // 提取颜色：支持 #hex, rgb(...), rgba(...), 命名色
  // 先尝试 rgb/rgba
  const rgbMatch = borderStr.match(/rgba?\([^)]+\)/);
  if (rgbMatch) {
    const c = parseColor(rgbMatch[0]);
    if (c) return { bw, color: c };
  }

  // 尝试 #hex
  const hexMatch = borderStr.match(/#([0-9a-fA-F]{3,8})\b/);
  if (hexMatch) {
    const hex = hexMatch[1];
    let r, g, b;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }

    return { bw, color: [r, g, b] };
  }

  return null;
}

/**
 * 绘制边框（跨页裁剪）
 *
 * isFirstPage → 画 top；isLastPage → 画 bottom；左右每页全画
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
    if (side === 'top') {
      if (isFirstPage && bw > 0) {
        const c = parseColor(color);
        if (c) {
          doc.setDrawColor(c[0], c[1], c[2]);
          doc.setLineWidth(ctx.toMM(bw));
          doc.line(x, yTop, x + w, yTop);
        }
      }
    } else if (side === 'bottom') {
      if (isLastPage && bw > 0) {
        const c = parseColor(color);
        if (c) {
          doc.setDrawColor(c[0], c[1], c[2]);
          doc.setLineWidth(ctx.toMM(bw));
          doc.line(x, yBottom, x + w, yBottom);
        }
      }
    } else {
      // left / right：每页全画
      if (bw <= 0) continue;

      const c = parseColor(color);
      if (!c) continue;

      doc.setDrawColor(c[0], c[1], c[2]);
      doc.setLineWidth(ctx.toMM(bw));
      if (side === 'left') doc.line(x, yTop, x, yBottom);
      else doc.line(x + w, yTop, x + w, yBottom);
    }
  }
}

/**
 * 在表格跨页截断处画出口闭合线（贴着当前页最后一行 TR 底部）。
 * 在所有节点渲染完后调用，确保不被覆盖。
 *
 * @param {string} pageBreakBorder - CSS border 简写，如 '1px solid #d9d9d9'
 * @param {number} clipBottom      - 出口线位置（mm，相对页面内容区顶部）
 */
function drawSpillClosingLines({
  doc,
  node,
  ctx,
  clipBottom,
  pageBreakBorder,
}) {
  const fb = parseBorderString(pageBreakBorder);
  if (!fb) return;

  const x = ctx.toPdfX(node.x);
  const w = ctx.toMM(node.width);

  doc.setDrawColor(fb.color[0], fb.color[1], fb.color[2]);
  doc.setLineWidth(ctx.toMM(fb.bw));
  doc.line(x, ctx.toPdfYmm(clipBottom), x + w, ctx.toPdfYmm(clipBottom));
}

export { drawBorder, drawSpillClosingLines };
