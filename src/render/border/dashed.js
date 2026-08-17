/**
 * dashed.js — dashed border 绘制
 *
 * 直角（radius 全为 0）：clip 梯形 + 矩形 dash 序列。
 * 圆角（任一 radius > 0）：12 段整圈路径，逐 side 做梯形 clip，
 *   直线段用 setLineDashPattern + stroke，弧段逐块 fillArcDash。
 */

import { appendArcSegment } from '../radius';
import { buildSidePath } from './solid';

const PI = Math.PI;

// ─── 直角辅助：矩形 dash 序列 ────────────────────────────────────────────────

function dashLine({ doc, x0, x1, yMid, bw, dashLen, gapLen }) {
  const step = dashLen + gapLen;
  let cx = x0;

  while (cx + dashLen <= x1 + 1e-6) {
    doc.rect(cx, yMid - bw / 2, dashLen, bw, 'F');
    cx += step;
  }
}

function dashLineV({ doc, xMid, y0, y1, bw, dashLen, gapLen }) {
  const step = dashLen + gapLen;
  let cy = y0;

  while (cy + dashLen <= y1 + 1e-6) {
    doc.rect(xMid - bw / 2, cy, bw, dashLen, 'F');
    cy += step;
  }
}

// ─── 圆角辅助 ────────────────────────────────────────────────────────────────

// Blink selectBestDashGap：整圈 fitting，closed=true
function selectBestDashGap(strokeLen, dashLen, gapLen, closed) {
  const available = closed ? strokeLen : strokeLen + gapLen;
  const minN = Math.floor(available / (dashLen + gapLen));
  const maxN = minN + 1;
  const minG = closed ? minN : minN - 1;
  const maxG = closed ? maxN : maxN - 1;
  const gMin =
    minG > 0 ? (strokeLen - minN * dashLen) / minG : strokeLen - minN * dashLen;
  const gMax =
    maxG > 0 ? (strokeLen - maxN * dashLen) / maxG : strokeLen - maxN * dashLen;
  if (gMax <= 0) return gMin;

  return Math.abs(gMin - gapLen) < Math.abs(gMax - gapLen) ? gMin : gMax;
}

/**
 * 填充一个弧段 dash 块。
 * 外弧：appendArcSegment（贝塞尔），内边：二次贝塞尔过两端精确点。
 */
function fillArcDash(doc, { cx, cy, R, innerR0, innerR1, t0, t1 }) {
  if (t1 <= t0) return;

  const p0x = cx + innerR0 * Math.cos(t0);
  const p0y = cy + innerR0 * Math.sin(t0);
  const p1x = cx + innerR1 * Math.cos(t1);
  const p1y = cy + innerR1 * Math.sin(t1);
  // 切线方向（垂直于径向，顺时针）
  const d0x = -Math.sin(t0),
    d0y = Math.cos(t0);
  const d1x = -Math.sin(t1),
    d1y = Math.cos(t1);
  // 两切线交点
  const det = d0x * -d1y - d0y * -d1x;
  let cpx, cpy;
  if (Math.abs(det) > 1e-10) {
    const dx = p1x - p0x,
      dy = p1y - p0y;
    const s = (dx * -d1y - dy * -d1x) / det;
    cpx = p0x + s * d0x;
    cpy = p0y + s * d0y;
  } else {
    cpx = (p0x + p1x) / 2;
    cpy = (p0y + p1y) / 2;
  }

  doc.moveTo(cx + R * Math.cos(t0), cy + R * Math.sin(t0));
  appendArcSegment(doc, cx, cy, R, t0, t1);
  if (innerR0 > 0 || innerR1 > 0) {
    doc.lineTo(p1x, p1y);
    const c1x = p1x + (2 / 3) * (cpx - p1x);
    const c1y = p1y + (2 / 3) * (cpy - p1y);
    const c2x = p0x + (2 / 3) * (cpx - p0x);
    const c2y = p0y + (2 / 3) * (cpy - p0y);
    doc.curveTo(c1x, c1y, c2x, c2y, p0x, p0y);
  } else {
    doc.lineTo(cx, cy);
  }

  doc.close();
  doc.fill();
}

/**
 * 圆角 dashed 绘制（单边调用，内部构建全圈路径段做相位计算）。
 * 由 drawDashedBorder 在 r 任一角 > 0 时调用。
 *
 * @param {number} si  side 索引：0=top 1=right 2=bottom 3=left
 */
function drawDashedBorderRounded({
  doc,
  x,
  y,
  w,
  h,
  r,
  si,
  bw,
  bwT,
  bwR,
  bwB,
  bwL,
  ct,
  cr: cRight,
  cb,
  cl,
}) {
  // 各角 radius（已 clamp）
  const rTL = Math.min(r.tl, w / 2, h / 2);
  const rTR = Math.min(r.tr, w / 2, h / 2);
  const rBR = Math.min(r.br, w / 2, h / 2);
  const rBL = Math.min(r.bl, w / 2, h / 2);

  // 各角圆心
  const cxTL = x + rTL,
    cyTL = y + rTL;
  const cxTR = x + w - rTR,
    cyTR = y + rTR;
  const cxBR = x + w - rBR,
    cyBR = y + h - rBR;
  const cxBL = x + rBL,
    cyBL = y + h - rBL;

  // 各角分割角（同 solid.js 的斜切线方向）
  const sTL = PI + Math.atan2(bwL, bwT);
  const sTR = (3 * PI) / 2 + Math.atan2(bwT, bwR);
  const sBR = Math.atan2(bwR, bwB);
  const sBL = PI / 2 + Math.atan2(bwB, bwL);

  const colors = [ct, cRight, cb, cl];

  // ── 12 段整圈路径（顺时针）────────────────────────────────────────────────
  // [0]top线  [1]TR-A(top)  [2]TR-B(right)  [3]right线
  // [4]BR-A(right)  [5]BR-B(bottom)  [6]bottom线
  // [7]BL-A(bottom)  [8]BL-B(left)  [9]left线
  // [10]TL-A(left)  [11]TL-B(top)
  const segs = [
    { kind: 'line', len: w - rTL - rTR, color: colors[0] },
    {
      kind: 'arc',
      cx: cxTR,
      cy: cyTR,
      R: rTR,
      t0: (3 * PI) / 2,
      t1: sTR,
      color: colors[0],
    },
    {
      kind: 'arc',
      cx: cxTR,
      cy: cyTR,
      R: rTR,
      t0: sTR,
      t1: 2 * PI,
      color: colors[1],
    },
    { kind: 'line', len: h - rTR - rBR, color: colors[1] },
    {
      kind: 'arc',
      cx: cxBR,
      cy: cyBR,
      R: rBR,
      t0: 0,
      t1: sBR,
      color: colors[1],
    },
    {
      kind: 'arc',
      cx: cxBR,
      cy: cyBR,
      R: rBR,
      t0: sBR,
      t1: PI / 2,
      color: colors[2],
    },
    { kind: 'line', len: w - rBR - rBL, color: colors[2] },
    {
      kind: 'arc',
      cx: cxBL,
      cy: cyBL,
      R: rBL,
      t0: PI / 2,
      t1: sBL,
      color: colors[2],
    },
    {
      kind: 'arc',
      cx: cxBL,
      cy: cyBL,
      R: rBL,
      t0: sBL,
      t1: PI,
      color: colors[3],
    },
    { kind: 'line', len: h - rBL - rTL, color: colors[3] },
    {
      kind: 'arc',
      cx: cxTL,
      cy: cyTL,
      R: rTL,
      t0: PI,
      t1: sTL,
      color: colors[3],
    },
    {
      kind: 'arc',
      cx: cxTL,
      cy: cyTL,
      R: rTL,
      t0: sTL,
      t1: (3 * PI) / 2,
      color: colors[0],
    },
  ];

  // 每条 side 的 line 段在 segs[] 中的索引
  const lineSegIdx = [0, 3, 6, 9];

  // 直线段几何（用于 stroke）
  const lineGeom = [
    { x1: x + rTL, y1: y + bwT / 2, x2: x + w - rTR, y2: y + bwT / 2 },
    { x1: x + w - bwR / 2, y1: y + rTR, x2: x + w - bwR / 2, y2: y + h - rBR },
    { x1: x + w - rBR, y1: y + h - bwB / 2, x2: x + rBL, y2: y + h - bwB / 2 },
    { x1: x + bwL / 2, y1: y + h - rBL, x2: x + bwL / 2, y2: y + rTL },
  ];

  // 角落信息（用于 innerR 插值）：每个角的整体弧范围和两侧 bw
  const corners = [
    // TR: seg[1]=TR-A, seg[2]=TR-B
    {
      segs: [1, 2],
      cx: cxTR,
      cy: cyTR,
      R: rTR,
      t0: (3 * PI) / 2,
      t1: 2 * PI,
      bwA: bwT,
      bwB: bwR,
    },
    // BR: seg[4]=BR-A, seg[5]=BR-B
    {
      segs: [4, 5],
      cx: cxBR,
      cy: cyBR,
      R: rBR,
      t0: 0,
      t1: PI / 2,
      bwA: bwR,
      bwB: bwB,
    },
    // BL: seg[7]=BL-A, seg[8]=BL-B
    {
      segs: [7, 8],
      cx: cxBL,
      cy: cyBL,
      R: rBL,
      t0: PI / 2,
      t1: PI,
      bwA: bwB,
      bwB: bwL,
    },
    // TL: seg[10]=TL-A, seg[11]=TL-B
    {
      segs: [10, 11],
      cx: cxTL,
      cy: cyTL,
      R: rTL,
      t0: PI,
      t1: (3 * PI) / 2,
      bwA: bwL,
      bwB: bwT,
    },
  ];

  // clip 梯形（分割角射线）
  const BIG = Math.max(w, h) * 3;
  const splitLen = Math.max(w, h) * 2;
  function splitPt(cxC, cyC, angle) {
    return {
      x: cxC + splitLen * Math.cos(angle),
      y: cyC + splitLen * Math.sin(angle),
    };
  }

  function clipForSide(sIdx) {
    if (sIdx === 0) {
      const pL = splitPt(cxTL, cyTL, sTL),
        pR = splitPt(cxTR, cyTR, sTR);
      doc.moveTo(cxTL, cyTL);
      doc.lineTo(pL.x, pL.y);
      doc.lineTo(x - BIG, y - BIG);
      doc.lineTo(x + w + BIG, y - BIG);
      doc.lineTo(pR.x, pR.y);
      doc.lineTo(cxTR, cyTR);
    } else if (sIdx === 1) {
      const pT = splitPt(cxTR, cyTR, sTR),
        pB = splitPt(cxBR, cyBR, sBR);
      doc.moveTo(cxTR, cyTR);
      doc.lineTo(pT.x, pT.y);
      doc.lineTo(x + w + BIG, y - BIG);
      doc.lineTo(x + w + BIG, y + h + BIG);
      doc.lineTo(pB.x, pB.y);
      doc.lineTo(cxBR, cyBR);
    } else if (sIdx === 2) {
      const pR = splitPt(cxBR, cyBR, sBR),
        pL = splitPt(cxBL, cyBL, sBL);
      doc.moveTo(cxBR, cyBR);
      doc.lineTo(pR.x, pR.y);
      doc.lineTo(x + w + BIG, y + h + BIG);
      doc.lineTo(x - BIG, y + h + BIG);
      doc.lineTo(pL.x, pL.y);
      doc.lineTo(cxBL, cyBL);
    } else {
      const pB = splitPt(cxBL, cyBL, sBL),
        pT = splitPt(cxTL, cyTL, sTL);
      doc.moveTo(cxBL, cyBL);
      doc.lineTo(pB.x, pB.y);
      doc.lineTo(x - BIG, y + h + BIG);
      doc.lineTo(x - BIG, y - BIG);
      doc.lineTo(pT.x, pT.y);
      doc.lineTo(cxTL, cyTL);
    }

    doc.close();
    doc.clip();
    doc.discardPath();
  }

  // 当前 side 的 bw
  const color = colors[si];
  // rc：整圈弧段统一用当前 side 的 bw 算中线半径（各角独立 R，但同一 side 的 rc = cornerR - bw/2）
  // 注意：不同角有不同 R，所以 rc 需要按每段 arc 的角来算
  // gOff 中 arc 段弧长 = max(cornerR - bw/2, 0) * |dt|

  let off = 0;
  const gOff = segs.map((seg) => {
    const o = off;
    if (seg.kind === 'line') {
      off += Math.max(seg.len, 0);
    } else {
      const rc = Math.max(seg.R - bw / 2, 0);
      off += rc > 0 ? rc * Math.abs(seg.t1 - seg.t0) : 0;
    }

    return o;
  });
  const totalPerimeter = off;

  const dashLen = 2 * bw;
  const gap = selectBestDashGap(totalPerimeter, dashLen, bw, true);
  const period = dashLen + gap;

  // ── 1. 直线段：setLineDashPattern + stroke
  doc.saveGraphicsState();
  clipForSide(si);
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(bw);
  const liIdx = lineSegIdx[si];
  const lineOff = gOff[liIdx];
  const dashOffset = lineOff % period;
  doc.setLineDashPattern([dashLen, gap], dashOffset);
  const lg = lineGeom[si];
  doc.moveTo(lg.x1, lg.y1);
  doc.lineTo(lg.x2, lg.y2);
  doc.stroke();
  doc.restoreGraphicsState();

  // ── 2. 弧段：逐块 fillArcDash
  const n = segs.length;
  const arcIdxs = [
    (liIdx - 1 + n) % n, // preArc
    (liIdx + 1) % n, // postArc
  ];

  doc.saveGraphicsState();
  clipForSide(si);

  for (const ai of arcIdxs) {
    const seg = segs[ai];
    if (seg.kind !== 'arc') continue;

    const corner = corners.find((co) => co.segs.includes(ai));
    const cornerSpan = corner.t1 - corner.t0;
    const segColor = seg.color;
    const rc = Math.max(seg.R - bw / 2, 0);
    const arcSpan = Math.abs(seg.t1 - seg.t0);
    const arcLen = rc > 0 ? rc * arcSpan : 0;
    if (arcLen <= 0) continue;

    const arcStart = gOff[ai];
    const arcEnd = arcStart + arcLen;

    doc.setFillColor(segColor[0], segColor[1], segColor[2]);

    const firstDi = Math.floor(arcStart / period);
    for (let di = firstDi; di * period < arcEnd + dashLen; di++) {
      const dStart = di * period;
      const dEnd = dStart + dashLen;
      const cStart = Math.max(dStart, arcStart);
      const cEnd = Math.min(dEnd, arcEnd);
      if (cEnd <= cStart) continue;

      const relStart = cStart - arcStart;
      const relEnd = cEnd - arcStart;
      const tA = rc > 0 ? seg.t0 + relStart / rc : seg.t0;
      const tB = rc > 0 ? seg.t0 + relEnd / rc : seg.t1;
      if (tB <= tA) continue;

      // innerR 在整个角落弧上线性插值（从 R-bwA 到 R-bwB）
      const fracA = (tA - corner.t0) / cornerSpan;
      const fracB = (tB - corner.t0) / cornerSpan;
      const iR0 = Math.max(
        corner.R - corner.bwA + (corner.bwA - corner.bwB) * fracA,
        0,
      );
      const iR1 = Math.max(
        corner.R - corner.bwA + (corner.bwA - corner.bwB) * fracB,
        0,
      );
      fillArcDash(doc, {
        cx: seg.cx,
        cy: seg.cy,
        R: seg.R,
        innerR0: iR0,
        innerR1: iR1,
        t0: tA,
        t1: tB,
      });
    }
  }

  doc.restoreGraphicsState();
  doc.setLineDashPattern([], 0);
}

// ─── 导出 ────────────────────────────────────────────────────────────────────

/**
 * 绘制 dashed 单边。
 * 直角（r 全为 0）：clip 梯形 + 矩形 dash 序列（原有逻辑）。
 * 圆角（任一角 > 0）：整圈路径段相位计算 + 梯形 clip（新逻辑）。
 */
function drawDashedBorder({
  doc,
  x,
  y,
  w,
  h,
  r,
  dir,
  bw,
  bt,
  bb,
  bl,
  br,
  c,
  ct,
  cb,
  cl,
  cr: cRight,
}) {
  const hasRadius = r.tl > 0 || r.tr > 0 || r.br > 0 || r.bl > 0;

  if (hasRadius) {
    const siMap = { top: 0, right: 1, bottom: 2, left: 3 };
    drawDashedBorderRounded({
      doc,
      x,
      y,
      w,
      h,
      r,
      si: siMap[dir],
      bw,
      bwT: bt,
      bwR: br,
      bwB: bb,
      bwL: bl,
      ct,
      cr: cRight,
      cb,
      cl,
    });

    return;
  }

  // ── 直角原有逻辑 ──────────────────────────────────────────────────────────
  doc.setFillColor(c[0], c[1], c[2]);

  doc.saveGraphicsState();
  buildSidePath({ doc, x, y, w, h, dir, bw, bt, bb, bl, br, r });
  doc.clip();
  doc.discardPath();

  const isH = dir === 'top' || dir === 'bottom';
  const outerLen = isH ? w : h;
  const nMid = Math.max(0, Math.round(outerLen / (3 * bw)) - 2);
  const gapLen = outerLen / (3 * nMid + 5);
  const dashLen = 2 * gapLen;

  const dashDirs = {
    top: () =>
      dashLine({
        doc,
        x0: x,
        x1: x + w + dashLen,
        yMid: y + bw / 2,
        bw,
        dashLen,
        gapLen,
      }),
    bottom: () =>
      dashLine({
        doc,
        x0: x,
        x1: x + w + dashLen,
        yMid: y + h - bw / 2,
        bw,
        dashLen,
        gapLen,
      }),
    left: () =>
      dashLineV({
        doc,
        xMid: x + bw / 2,
        y0: y,
        y1: y + h + dashLen,
        bw,
        dashLen,
        gapLen,
      }),
    right: () =>
      dashLineV({
        doc,
        xMid: x + w - bw / 2,
        y0: y,
        y1: y + h + dashLen,
        bw,
        dashLen,
        gapLen,
      }),
  };
  dashDirs[dir]();

  doc.restoreGraphicsState();
}

export { drawDashedBorder };
