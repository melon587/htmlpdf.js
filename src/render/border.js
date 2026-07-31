import { parsePx, parseColor } from '../utils';
import {
  ARC_K,
  parseRadius,
  hasRadius,
  addRoundedRectPath,
  addBorderFirstPagePath,
  addBorderLastPagePath,
} from './radius';

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
 * 当四边 border 完全一致时返回 { bw, color, borderStyle }，否则返回 null。
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
  const allSame = valid.every(({ bw, color, borderStyle }) => {
    const c = parseColor(color);

    return (
      bw === first.bw &&
      borderStyle === first.borderStyle &&
      c &&
      c[0] === firstC[0] &&
      c[1] === firstC[1] &&
      c[2] === firstC[2]
    );
  });

  return allSame
    ? { bw: first.bw, color: firstC, borderStyle: first.borderStyle }
    : null;
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
      doc.setDrawColor(uniform.color[0], uniform.color[1], uniform.color[2]);

      if (uniform.borderStyle === 'double') {
        strokeDouble({
          doc,
          x,
          y,
          w,
          h,
          r,
          lw,
          isFirstPage,
          isLastPage,
        });

        return;
      }

      const o = lw / 2;
      // 内缩后的圆角半径：每角减去 o（border 中线到外边缘距离），
      // 与背景 clip 圆角路径（基于 border-box）对齐，消除白缝
      const ri = {
        tl: Math.max(r.tl - o, 0),
        tr: Math.max(r.tr - o, 0),
        br: Math.max(r.br - o, 0),
        bl: Math.max(r.bl - o, 0),
      };

      doc.setLineWidth(lw);
      applyLineDash(doc, uniform.borderStyle, lw);
      addRoundedRectPath({
        doc,
        x: x + o,
        y: y + o,
        w: w - lw,
        h: h - lw,
        r: ri,
      });
      doc.stroke();
      doc.setLineDashPattern([], 0);

      return;
    }
  }

  // 逐边独立描边
  const geom = { doc, x, y, w, h, tl, tr, br, bl, isFirstPage, isLastPage };

  // double 边需要整体路径，按 bw+color 分组，每组只调用一次
  const doubleGroups = new Map();

  for (const s of sides) {
    if (s.borderStyle !== 'double' || s.bw <= 0) continue;

    const c = parseColor(s.color);
    if (!c) continue;

    const key = `${s.bw}|${c[0]},${c[1]},${c[2]}`;
    if (!doubleGroups.has(key)) doubleGroups.set(key, { bw: s.bw, c });
  }

  for (const { bw, c } of doubleGroups.values()) {
    const lw = toMM(bw);
    doc.setDrawColor(c[0], c[1], c[2]);
    strokeDouble({ doc, x, y, w, h, r, lw, isFirstPage, isLastPage });
  }

  for (const { bw, color, borderStyle, side } of sides) {
    if (borderStyle === 'double') continue;

    strokeOneSide({ geom, bw, color, borderStyle, side, toMM });
  }
}

/**
 * 根据 borderStyle 和 lineWidth（mm）设置 jsPDF 虚线模式。
 * solid / 其他 → 实线（清除 dash）
 * dashed → 长虚线
 * dotted → 点线
 * double → 实线（调用方需自行画两条线）
 */
function applyLineDash(doc, borderStyle, lw) {
  if (borderStyle === 'dashed') {
    doc.setLineDashPattern([lw * 3, lw * 3], 0);
  } else if (borderStyle === 'dotted') {
    doc.setLineDashPattern([lw, lw * 2], 0);
  } else {
    doc.setLineDashPattern([], 0);
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
  applyLineDash(doc, borderStyle, lw);

  if (side === 'top' && isFirstPage) {
    strokeTopSide({ doc, x, y, w, tl, tr, o });
  } else if (side === 'bottom' && isLastPage) {
    strokeBottomSide({ doc, x, y, w, h, br, bl, o });
  } else if (side === 'left') {
    strokeLeftSide({ doc, x, y, h, tl, bl, isFirstPage, isLastPage, o });
  } else if (side === 'right') {
    strokeRightSide({ doc, x, y, w, h, tr, br, isFirstPage, isLastPage, o });
  }

  doc.setLineDashPattern([], 0);
}

/**
 * double border 统一实现（圆角/直角，单页/跨页）：
 * 画外线路径 + 内线路径，每条线宽 lw/3。
 * 直角传 r={tl:0,tr:0,br:0,bl:0} 自然退化为矩形路径。
 *
 * CSS double 结构（总宽 lw）：外线中线=lw/6，内线中线=5lw/6
 */
function strokeDouble({ doc, x, y, w, h, r, lw, isFirstPage, isLastPage }) {
  const lw3 = lw / 3;
  const offsets = [lw / 6, (5 * lw) / 6];
  doc.setLineWidth(lw3);

  // 截断线坐标（不随 off 偏移，保证竖线延伸到页面边缘）
  const cutBottom = y + h;
  const cutTop = y;

  for (const off of offsets) {
    const px = x + off;
    const py = y + off;
    const pw = w - 2 * off;
    const ph = h - 2 * off;
    const rr = {
      tl: Math.max(r.tl - off, 0),
      tr: Math.max(r.tr - off, 0),
      br: Math.max(r.br - off, 0),
      bl: Math.max(r.bl - off, 0),
    };

    if (isFirstPage && isLastPage) {
      addRoundedRectPath({ doc, x: px, y: py, w: pw, h: ph, r: rr });
    } else if (isFirstPage) {
      addBorderFirstPagePath({
        doc,
        x: px,
        y: py,
        w: pw,
        cutY: cutBottom,
        r: rr,
      });
    } else if (isLastPage) {
      addBorderLastPagePath({
        doc,
        x: px,
        y: py,
        w: pw,
        segH: ph,
        cutY: cutTop,
        r: rr,
      });
    } else {
      // 中间页：只画左右竖线，顶底均截断不画横线
      doc.moveTo(px + pw, cutTop);
      doc.lineTo(px + pw, cutBottom);
      doc.moveTo(px, cutTop);
      doc.lineTo(px, cutBottom);
    }

    doc.stroke();
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

  // 直角 fallback：逐边画线
  const lrBottom = isLastSpill ? yBottom : toPdfYmm(clipBottom);

  strokeStraightSides({
    doc,
    toMM,
    x,
    yTop,
    yBottom,
    w,
    lrBottom,
    sides,
    isFirstPage,
    isLastPage,
  });
}

/**
 * 直角（无 border-radius）逐边描边，支持 solid/dashed/dotted/double。
 */
function strokeStraightSides({
  doc,
  toMM,
  x,
  yTop,
  yBottom,
  w,
  lrBottom,
  sides,
  isFirstPage,
  isLastPage,
}) {
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
    applyLineDash(doc, borderStyle, lw);

    if (borderStyle === 'double') {
      strokeDouble({
        doc,
        x,
        y: yTop,
        w,
        h: yBottom - yTop,
        r: { tl: 0, tr: 0, br: 0, bl: 0 },
        lw,
        isFirstPage,
        isLastPage,
      });
      doc.setLineDashPattern([], 0);
      continue;
    }

    if (side === 'top') {
      if (isFirstPage) doc.line(x, yTop + o, x + w, yTop + o);
    } else if (side === 'bottom') {
      if (isLastPage) doc.line(x, yBottom - o, x + w, yBottom - o);
    } else if (side === 'left') {
      doc.line(x + o, yTop, x + o, lrBottom);
    } else {
      doc.line(x + w - o, yTop, x + w - o, lrBottom);
    }

    doc.setLineDashPattern([], 0);
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
