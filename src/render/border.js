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
 * 解析 CSS border 简写字符串，例如 '1px solid #d9d9d9'
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
 * 根据 borderStyle 设置 jsPDF 虚线模式。
 * solid / double / 其他 → 实线；dashed → 长虚线；dotted → 点线
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

/**
 * 在 doc 上构建一条 border 路径并 stroke（不含 setDrawColor）。
 *
 * 单页        → addRoundedRectPath（完整圆角矩形）
 * 首页跨页    → addBorderFirstPagePath（顶部圆角 + 左右竖线，底部截断）
 * 末页跨页    → addBorderLastPagePath（左右竖线 + 底部圆角，顶部截断）
 * 中间页      → 仅左右竖线
 *
 * @param {number} lw     - lineWidth（mm），即 border-width
 * @param {number} off    - 路径中线偏移（mm）。solid/dashed/dotted 传 lw/2；
 *                          double 外线传 lw/6，内线传 5*lw/6
 * @param {number} strokeW - 实际描边宽度（mm）。solid 传 lw；double 传 lw/3
 */
function strokeBorderShape({
  doc,
  x,
  y,
  w,
  h,
  r,
  off,
  strokeW,
  borderStyle,
  isFirstPage,
  isLastPage,
}) {
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

  doc.setLineWidth(strokeW);
  applyLineDash(doc, borderStyle, strokeW);

  if (isFirstPage && isLastPage) {
    addRoundedRectPath({ doc, x: px, y: py, w: pw, h: ph, r: rr });
  } else if (isFirstPage) {
    addBorderFirstPagePath({
      doc,
      x: px,
      y: py,
      w: pw,
      cutY: y + h,
      r: rr,
    });
  } else if (isLastPage) {
    addBorderLastPagePath({
      doc,
      x: px,
      y: py,
      w: pw,
      segH: ph,
      cutY: y,
      r: rr,
    });
  } else {
    // 中间页：仅左右竖线，延伸到原始截断线（不加 off）
    doc.moveTo(px + pw, y);
    doc.lineTo(px + pw, y + h);
    doc.moveTo(px, y);
    doc.lineTo(px, y + h);
  }

  doc.stroke();
  doc.setLineDashPattern([], 0);
}

/**
 * 对一组 border 参数（bw/color/borderStyle 相同）执行描边。
 * double → 调两次 strokeBorderShape（外线 + 内线）
 * 其余  → 调一次
 */
function strokeBorderGroup({
  doc,
  x,
  y,
  w,
  h,
  r,
  lw,
  color,
  borderStyle,
  isFirstPage,
  isLastPage,
}) {
  doc.setDrawColor(color[0], color[1], color[2]);

  if (borderStyle === 'double') {
    strokeBorderShape({
      doc,
      x,
      y,
      w,
      h,
      r,
      off: lw / 6,
      strokeW: lw / 3,
      borderStyle,
      isFirstPage,
      isLastPage,
    });
    strokeBorderShape({
      doc,
      x,
      y,
      w,
      h,
      r,
      off: (5 * lw) / 6,
      strokeW: lw / 3,
      borderStyle,
      isFirstPage,
      isLastPage,
    });
  } else {
    strokeBorderShape({
      doc,
      x,
      y,
      w,
      h,
      r,
      off: lw / 2,
      strokeW: lw,
      borderStyle,
      isFirstPage,
      isLastPage,
    });
  }
}

/**
 * 当四边 border 完全一致时返回 { bw, color, borderStyle }，否则返回 null。
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
 * 有效边不足 4 条时，逐边画线。
 * 每条边独立设置颜色/宽度/style，只画该方向的线段（含圆角弧）。
 */
function strokePartialSides({
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

  for (const { bw, color, borderStyle, side: dir } of sides) {
    const isNone =
      !borderStyle || borderStyle === 'none' || borderStyle === 'hidden';
    if (isNone || bw <= 0) continue;

    const c = parseColor(color);
    if (!c) continue;

    const lw = toMM(bw);
    doc.setDrawColor(c[0], c[1], c[2]);
    applyLineDash(doc, borderStyle, lw);

    if (borderStyle === 'double') {
      doc.setLineWidth(lw / 3);
      for (const off of [lw / 6, (5 * lw) / 6]) {
        strokeOneSideAtOff({
          doc,
          x,
          y,
          w,
          h,
          tl,
          tr,
          br,
          bl,
          dir,
          off,
          isFirstPage,
          isLastPage,
        });
      }
    } else {
      doc.setLineWidth(lw);
      strokeOneSideAtOff({
        doc,
        x,
        y,
        w,
        h,
        tl,
        tr,
        br,
        bl,
        dir,
        off: lw / 2,
        isFirstPage,
        isLastPage,
      });
    }

    doc.setLineDashPattern([], 0);
  }
}

/** 画单条边在给定偏移处的线段（含圆角弧）。*/
function strokeOneSideAtOff({
  doc,
  x,
  y,
  w,
  h,
  tl,
  tr,
  br,
  bl,
  dir,
  off,
  isFirstPage,
  isLastPage,
}) {
  if (dir === 'top') {
    if (isFirstPage) doc.line(x + tl, y + off, x + w - tr, y + off);
  } else if (dir === 'bottom') {
    if (isLastPage) doc.line(x + bl, y + h - off, x + w - br, y + h - off);
  } else if (dir === 'left') {
    strokeLeftAtOff({ doc, x, y, h, tl, bl, off, isFirstPage, isLastPage });
  } else if (dir === 'right') {
    strokeRightAtOff({ doc, x, y, w, h, tr, br, off, isFirstPage, isLastPage });
  }
}

function strokeLeftAtOff({
  doc,
  x,
  y,
  h,
  tl,
  bl,
  off,
  isFirstPage,
  isLastPage,
}) {
  const xi = x + off;
  const lineTop = isFirstPage ? y + tl : y;
  const lineBot = isLastPage ? y + h - bl : y + h;

  // Build one continuous path: top arc → vertical line → bottom arc
  if (isFirstPage && tl > 0) {
    doc.moveTo(x + tl, y + off);
    doc.curveTo(
      x + tl - tl * ARC_K,
      y + off,
      xi,
      y + tl - tl * ARC_K,
      xi,
      y + tl,
    );
  } else {
    doc.moveTo(xi, lineTop);
  }

  if (lineBot > lineTop) {
    doc.lineTo(xi, lineBot);
  }

  if (isLastPage && bl > 0) {
    doc.curveTo(
      xi,
      y + h - bl + bl * ARC_K,
      x + bl - bl * ARC_K,
      y + h - off,
      x + bl,
      y + h - off,
    );
  }

  doc.stroke();
}

function strokeRightAtOff({
  doc,
  x,
  y,
  w,
  h,
  tr,
  br,
  off,
  isFirstPage,
  isLastPage,
}) {
  const xr = x + w - off;
  const lineTop = isFirstPage ? y + tr : y;
  const lineBot = isLastPage ? y + h - br : y + h;

  // Build one continuous path: top arc → vertical line → bottom arc
  if (isFirstPage && tr > 0) {
    doc.moveTo(x + w - tr, y + off);
    doc.curveTo(
      x + w - tr + tr * ARC_K,
      y + off,
      xr,
      y + tr - tr * ARC_K,
      xr,
      y + tr,
    );
  } else {
    doc.moveTo(xr, lineTop);
  }

  if (lineBot > lineTop) {
    doc.lineTo(xr, lineBot);
  }

  if (isLastPage && br > 0) {
    doc.curveTo(
      xr,
      y + h - br + br * ARC_K,
      x + w - br + br * ARC_K,
      y + h - off,
      x + w - br,
      y + h - off,
    );
  }

  doc.stroke();
}

/**
 * 非 uniform fallback：
 * - 有效边 = 4 条 → strokeBorderGroup（整体路径）
 * - 有效边 < 4 条 → strokePartialSides（逐边画线）
 */
function strokeGroupedSides({
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
  const valid = sides.filter(({ bw, borderStyle, color }) => {
    const isNone =
      !borderStyle || borderStyle === 'none' || borderStyle === 'hidden';

    return !isNone && bw > 0 && parseColor(color);
  });

  if (valid.length === 4) {
    const s = valid[0];
    strokeBorderGroup({
      doc,
      x,
      y,
      w,
      h,
      r,
      lw: toMM(s.bw),
      color: parseColor(s.color),
      borderStyle: s.borderStyle,
      isFirstPage,
      isLastPage,
    });

    return;
  }

  strokePartialSides({
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
  });
}

/**
 * 分段圆角描边（有 border-radius 时调用）。
 *
 * 单页且四边一致 → strokeBorderGroup（快速路径）
 * 其余           → strokeGroupedSides
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
  if (isFirstPage && isLastPage) {
    const uniform = getUniformBorder(sides);

    if (uniform) {
      strokeBorderGroup({
        doc,
        x,
        y,
        w,
        h,
        r,
        lw: toMM(uniform.bw),
        color: uniform.color,
        borderStyle: uniform.borderStyle,
        isFirstPage,
        isLastPage,
      });

      return;
    }
  }

  strokeGroupedSides({
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
  });
}

/**
 * 绘制边框（跨页裁剪，支持 border-radius）
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
  const radius = node.collapseCell
    ? { tl: 0, tr: 0, br: 0, bl: 0 }
    : parseRadius({ style, toMM, w, h: fullH });

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

  strokeGroupedSides({
    doc,
    toMM,
    x,
    y: yTop,
    w,
    h: yBottom - yTop,
    r: { tl: 0, tr: 0, br: 0, bl: 0 },
    sides,
    isFirstPage,
    isLastPage,
  });
}

/**
 * 在表格跨页截断处画出口闭合线。
 * @param {string} pageBreakBorder - CSS border 简写，如 '1px solid #d9d9d9'
 * @param {number} clipBottom      - 出口线位置（mm）
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
