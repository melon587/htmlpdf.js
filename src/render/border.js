import { parsePx, parseColor } from '../utils';
import { parseRadius, hasRadius, addRoundedRectPath } from './radius';

/**
 * 解析 CSS border 简写字符串，例如 '1px solid #d9d9d9' 或 '1px solid rgb(200,200,200)'
 * 返回 { bw, color } 或 null
 */
function parseBorderString(borderStr) {
  if (!borderStr) return null;

  const widthMatch = borderStr.match(/(\d+(?:\.\d+)?)\s*px/);
  if (!widthMatch) return null;

  const bw = parseFloat(widthMatch[1]);
  if (bw <= 0) return null;

  const rgbMatch = borderStr.match(/rgba?\([^)]+\)/);
  const colorStr = rgbMatch
    ? rgbMatch[0]
    : (borderStr.match(/#[0-9a-fA-F]{3,8}\b/) || [])[0];
  const color = parseColor(colorStr);
  if (!color) return null;

  return { bw, color };
}

// ARC_K 贝塞尔圆弧近似系数，与 radius.js 一致
const ARC_K = (4 / 3) * (Math.SQRT2 - 1);

/**
 * 描边 top 边：仅画顶部直线段，路径向内偏移 o（= lineWidth/2）
 * 首页才调用
 */
function strokeTopSide({ doc, x, y, w, tl, tr, o }) {
  doc.line(x + tl, y + o, x + w - tr, y + o);
}

/**
 * 描边 bottom 边：仅画底部直线段，路径向内偏移 o
 * 末页才调用
 */
function strokeBottomSide({ doc, x, y, w, h, br, bl, o }) {
  doc.line(x + bl, y + h - o, x + w - br, y + h - o);
}

/**
 * 描边 left 边（含 tl/bl arc），路径向内偏移 o
 * arc 颜色跟随 left 边——与浏览器行为一致
 */
function strokeLeftSide({ doc, x, y, h, tl, bl, isFirstPage, isLastPage, o }) {
  const xi = x + o;

  if (isFirstPage && tl > 0) {
    doc.moveTo(xi, y + tl);
    doc.curveTo(
      xi,
      y + tl - tl * ARC_K,
      x + tl - tl * ARC_K,
      y + o,
      x + tl,
      y + o,
    );
    doc.stroke();
  }

  const lineTop = isFirstPage ? y + tl : y;
  const lineBot = isLastPage ? y + h - bl : y + h;

  if (lineBot > lineTop) doc.line(xi, lineTop, xi, lineBot);

  if (isLastPage && bl > 0) {
    doc.moveTo(xi, y + h - bl);
    doc.curveTo(
      xi,
      y + h - bl + bl * ARC_K,
      x + bl - bl * ARC_K,
      y + h - o,
      x + bl,
      y + h - o,
    );
    doc.stroke();
  }
}

/**
 * 描边 right 边（含 tr/br arc），路径向内偏移 o
 * arc 颜色跟随 right 边——与浏览器行为一致
 */
function strokeRightSide({
  doc,
  x,
  y,
  w,
  h,
  tr,
  br,
  isFirstPage,
  isLastPage,
  o,
}) {
  const xr = x + w - o;

  if (isFirstPage && tr > 0) {
    doc.moveTo(x + w - tr, y + o);
    doc.curveTo(
      x + w - tr + tr * ARC_K,
      y + o,
      xr,
      y + tr - tr * ARC_K,
      xr,
      y + tr,
    );
    doc.stroke();
  }

  const lineTop = isFirstPage ? y + tr : y;
  const lineBot = isLastPage ? y + h - br : y + h;

  if (lineBot > lineTop) doc.line(xr, lineTop, xr, lineBot);

  if (isLastPage && br > 0) {
    doc.moveTo(xr, y + h - br);
    doc.curveTo(
      xr,
      y + h - br + br * ARC_K,
      x + w - br + br * ARC_K,
      y + h - o,
      x + w - br,
      y + h - o,
    );
    doc.stroke();
  }
}

/**
 * 当四边 border 完全一致时返回 { bw, color }，否则返回 null。
 * 用于单页快速路径。
 */
function getUniformBorder(sides) {
  const valid = sides.filter(({ bw, borderStyle, color }) => {
    const isNone =
      !borderStyle || borderStyle === 'none' || borderStyle === 'hidden';

    return !isNone && bw > 0 && parseColor(color);
  });

  if (valid.length !== 4) return null;

  const first = valid[0];
  const firstC = parseColor(first.color);
  const allSame = valid.every(({ bw, color }) => {
    const c = parseColor(color);

    return (
      bw === first.bw &&
      c &&
      c[0] === firstC[0] &&
      c[1] === firstC[1] &&
      c[2] === firstC[2]
    );
  });

  return allSame ? { bw: first.bw, color: firstC } : null;
}

/**
 * 分段圆角描边：每条有效的边独立描边，截断处不画线。
 *
 * 单页且四边一致 → 整体圆角路径一次 stroke；
 * 其余情况逐边独立处理，支持跨页和任意边组合（含只有 border-left 的情况）。
 */
function strokeRoundedSides({
  doc,
  toMM,
  x,
  y,
  w,
  h,
  r,
  sides,
  isFirstPage,
  isLastPage,
}) {
  const { tl, tr, br, bl } = r;

  // 单页且四边一致 → 整体圆角路径一次 stroke
  if (isFirstPage && isLastPage) {
    const uniform = getUniformBorder(sides);

    if (uniform) {
      const lw = toMM(uniform.bw);
      const o = lw / 2;

      doc.setDrawColor(uniform.color[0], uniform.color[1], uniform.color[2]);
      doc.setLineWidth(lw);
      addRoundedRectPath({
        doc,
        x: x + o,
        y: y + o,
        w: w - lw,
        h: h - lw,
        r,
      });
      doc.stroke();

      return;
    }
  }

  // 逐边独立描边
  const geom = { doc, x, y, w, h, tl, tr, br, bl, isFirstPage, isLastPage };

  for (const { bw, color, borderStyle, side } of sides) {
    strokeOneSide({ geom, bw, color, borderStyle, side, toMM });
  }
}

/** 描边单条边（含 style/bw/color 校验），无效则跳过 */
function strokeOneSide({ geom, bw, color, borderStyle, side, toMM }) {
  const isNone =
    !borderStyle || borderStyle === 'none' || borderStyle === 'hidden';

  if (isNone || bw <= 0) return;

  const c = parseColor(color);
  if (!c) return;

  const { doc, x, y, w, h, tl, tr, br, bl, isFirstPage, isLastPage } = geom;
  const lw = toMM(bw);
  const o = lw / 2;

  doc.setDrawColor(c[0], c[1], c[2]);
  doc.setLineWidth(lw);

  if (side === 'top' && isFirstPage) {
    strokeTopSide({ doc, x, y, w, tl, tr, o });
  } else if (side === 'bottom' && isLastPage) {
    strokeBottomSide({ doc, x, y, w, h, br, bl, o });
  } else if (side === 'left') {
    strokeLeftSide({ doc, x, y, h, tl, bl, isFirstPage, isLastPage, o });
  } else if (side === 'right') {
    strokeRightSide({ doc, x, y, w, h, tr, br, isFirstPage, isLastPage, o });
  }
}

/**
 * 绘制边框（跨页裁剪，支持 border-radius）
 *
 * - 有 border-radius → strokeRoundedSides（逐边圆角，支持跨页、任意边组合）
 * - 无 border-radius → 直角线段逻辑
 *
 * @param {number}  clipTop     - 当前页内容起点（mm）。默认 0。
 * @param {boolean} isLastSpill - false 表示中间 spill 页
 */
function drawBorder({
  node,
  ctx,
  clipTop = 0,
  clipBottom,
  isLastSpill = true,
}) {
  const { doc, toMM, toPdfX, toPdfYmm } = ctx;
  const { style } = node;
  const nodeTop = toMM(node.y);
  const nodeBottom = toMM(node.y + node.height);

  const x = toPdfX(node.x);
  const w = toMM(node.width);

  const drawTop = Math.max(nodeTop, clipTop);
  const drawBottom = Math.min(nodeBottom, clipBottom);
  if (drawBottom <= drawTop) return;

  const yTop = toPdfYmm(drawTop);
  const yBottom = toPdfYmm(drawBottom);
  const isFirstPage = nodeTop >= clipTop;
  const isLastPage = isLastSpill && nodeBottom <= clipBottom;
  const leftRightBottom = isLastSpill ? yBottom : toPdfYmm(clipBottom);

  const sides = [
    {
      bw: parsePx(style.borderTopWidth),
      color: style.borderTopColor,
      borderStyle: style.borderTopStyle,
      side: 'top',
    },
    {
      bw: parsePx(style.borderRightWidth),
      color: style.borderRightColor,
      borderStyle: style.borderRightStyle,
      side: 'right',
    },
    {
      bw: parsePx(style.borderBottomWidth),
      color: style.borderBottomColor,
      borderStyle: style.borderBottomStyle,
      side: 'bottom',
    },
    {
      bw: parsePx(style.borderLeftWidth),
      color: style.borderLeftColor,
      borderStyle: style.borderLeftStyle,
      side: 'left',
    },
  ];

  const segH = yBottom - yTop;
  const fullH = toMM(node.height);
  const radius = parseRadius({ style, toMM, w, h: fullH });

  if (segH > 0 && hasRadius(radius)) {
    strokeRoundedSides({
      doc,
      toMM,
      x,
      y: yTop,
      w,
      h: segH,
      r: radius,
      sides,
      isFirstPage,
      isLastPage,
    });

    return;
  }

  for (const { bw, color, borderStyle, side } of sides) {
    if (!borderStyle || borderStyle === 'none' || borderStyle === 'hidden')
      continue;

    if (bw <= 0) continue;

    const c = parseColor(color);
    if (!c) continue;

    const lw = toMM(bw);
    const o = lw / 2;

    doc.setDrawColor(c[0], c[1], c[2]);
    doc.setLineWidth(lw);

    if (side === 'top') {
      if (isFirstPage) doc.line(x, yTop + o, x + w, yTop + o);
    } else if (side === 'bottom') {
      if (isLastPage) doc.line(x, yBottom - o, x + w, yBottom - o);
    } else if (side === 'left') {
      doc.line(x + o, yTop, x + o, leftRightBottom);
    } else {
      doc.line(x + w - o, yTop, x + w - o, leftRightBottom);
    }
  }
}

/**
 * 在表格跨页截断处画出口闭合线（贴着当前页最后一行 TR 底部），所有节点渲染完后调用。
 * @param {string} pageBreakBorder - CSS border 简写，如 '1px solid #d9d9d9'
 * @param {number} clipBottom      - 出口线位置（mm，相对页面内容区顶部）
 */
function drawSpillClosingLines({ node, ctx, clipBottom, pageBreakBorder }) {
  const { doc, toMM, toPdfX, toPdfYmm } = ctx;
  const fb = parseBorderString(pageBreakBorder);
  if (!fb) return;

  const x = toPdfX(node.x);
  const w = toMM(node.width);

  doc.setDrawColor(fb.color[0], fb.color[1], fb.color[2]);
  doc.setLineWidth(toMM(fb.bw));
  doc.line(x, toPdfYmm(clipBottom), x + w, toPdfYmm(clipBottom));
}

export { drawBorder, drawSpillClosingLines };
