/**
 * dashed.js — dashed border 绘制
 *
 * 直角（radius 全为 0）：clip 梯形 + 矩形 dash 序列。
 * 圆角（任一 radius > 0）：12 段整圈路径，逐 side 做梯形 clip，
 *   直线段用 setLineDashPattern + stroke，弧段逐块 fillArcDash。
 */

import { appendArcSegment } from '../radius';
import { buildSidePath } from './solid';
import {
  buildRoundedGeom,
  selectBestDashGap,
  clipForSide,
} from './rounded-geom';

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
  cr,
  cb,
  cl,
}) {
  const geom = buildRoundedGeom({
    x,
    y,
    w,
    h,
    r,
    bwT,
    bwR,
    bwB,
    bwL,
    ct,
    cr,
    cb,
    cl,
  });
  const { segs, corners, lineGeom, lineSegIdx, colors } = geom;

  // gOff：每段弧用 seg.R - bw/2 算弧长（与 dashed 行为一致）
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
  const color = colors[si];

  // ── 1. 直线段：setLineDashPattern + stroke
  doc.saveGraphicsState();
  clipForSide(doc, geom, si);
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
  clipForSide(doc, geom, si);

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
  cr,
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
      cr,
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
