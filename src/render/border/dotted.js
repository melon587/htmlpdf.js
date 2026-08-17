/**
 * dotted.js — dotted border 绘制
 *
 * 直角（r 全为 0）：clip 梯形 + 沿边铺放圆点序列（原有逻辑）。
 * 圆角（任一角 > 0）：整圈路径段相位计算 + 无 clip，逐点放圆（新逻辑）。
 *   dotted 不用 clip：圆心精确落在各 side 的弧/线上，clip 反而会把角落圆点切成半圆。
 *
 * 算法（直角）：dot:gap = 1:1，两端固定 + 中间均分。
 *   nMid = round(outerLen/(2*bw)) - 2
 *   gapLen = (outerLen - (nMid+2)*bw) / (nMid+1)
 *
 * 算法（圆角）：Blink selectBestDashGap，整圈相位连续，每 side 独立 fitting。
 */

import { appendArcSegment } from '../radius';
import { buildSidePath } from './solid';

const PI = Math.PI;

// ─── 辅助：圆点序列（直角用）─────────────────────────────────────────────────

function dotLine({ doc, x0, x1, yMid, r, gapLen }) {
  const step = 2 * r + gapLen;
  let cx = x0 + r;

  while (cx + r <= x1 + 1e-6) {
    doc.ellipse(cx, yMid, r, r, 'F');
    cx += step;
  }
}

function dotLineV({ doc, xMid, y0, y1, r, gapLen }) {
  const step = 2 * r + gapLen;
  let cy = y0 + r;

  while (cy + r <= y1 + 1e-6) {
    doc.ellipse(xMid, cy, r, r, 'F');
    cy += step;
  }
}

// ─── 辅助：圆角用 ─────────────────────────────────────────────────────────────

// Blink selectBestDashGap
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

// 用贝塞尔画单个圆点（fill）
function fillDot(doc, cx, cy, r) {
  if (r <= 0) return;

  doc.moveTo(cx + r, cy);
  appendArcSegment(doc, cx, cy, r, 0, PI / 2);
  appendArcSegment(doc, cx, cy, r, PI / 2, PI);
  appendArcSegment(doc, cx, cy, r, PI, (3 * PI) / 2);
  appendArcSegment(doc, cx, cy, r, (3 * PI) / 2, 2 * PI);
  doc.close();
  doc.fill();
}

// ─── 圆角绘制（单 side）───────────────────────────────────────────────────────

function drawDottedBorderRounded({
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

  // 各角分割角
  const sTL = PI + Math.atan2(bwL, bwT);
  const sTR = (3 * PI) / 2 + Math.atan2(bwT, bwR);
  const sBR = Math.atan2(bwR, bwB);
  const sBL = PI / 2 + Math.atan2(bwB, bwL);

  const colors = [ct, cRight, cb, cl];

  // 12 段整圈路径
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

  const lineSegIdx = [0, 3, 6, 9];

  // 直线段几何（dot 圆心所在中心线）
  const lineGeom = [
    { x1: x + rTL, y1: y + bwT / 2, x2: x + w - rTR, y2: y + bwT / 2 },
    {
      x1: x + w - bwR / 2,
      y1: y + rTR,
      x2: x + w - bwR / 2,
      y2: y + h - rBR,
    },
    {
      x1: x + w - rBR,
      y1: y + h - bwB / 2,
      x2: x + rBL,
      y2: y + h - bwB / 2,
    },
    { x1: x + bwL / 2, y1: y + h - rBL, x2: x + bwL / 2, y2: y + rTL },
  ];

  // 角落信息（用于弧段圆心半径 rc）
  const corners = [
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

  const color = colors[si];
  const dotR = bw / 2;
  const dotLen = bw;
  const gapLen = bw;

  // 该 side 的 rc（弧段圆心所在弧半径）
  // 注意：各角半径不同，rc 需要按 corner.R 算；这里 si 对应的两个弧段各有自己的 corner
  // 全圈 perimeter 计算时，弧段用对应角落的 R - bw/2 算弧长
  let off = 0;
  const gOff = segs.map((seg, idx) => {
    const o = off;
    if (seg.kind === 'line') {
      off += seg.len;
    } else {
      const corner = corners.find((c) => c.segs.includes(idx));
      const segR = corner ? corner.R : 0;
      const rc = segR > 0 ? segR - bw / 2 : 0;
      off += rc > 0 ? rc * Math.abs(seg.t1 - seg.t0) : 0;
    }

    return o;
  });
  const totalPerimeter = off;

  const gap = selectBestDashGap(totalPerimeter, dotLen, gapLen, true);
  const period = dotLen + gap;

  doc.setFillColor(color[0], color[1], color[2]);

  const liIdx = lineSegIdx[si];

  // ── 1. 直线段
  {
    const seg = segs[liIdx];
    if (seg.len > 0) {
      const lg = lineGeom[si];
      const lineLen = seg.len;
      const lineStart = gOff[liIdx];
      const lineEnd = lineStart + lineLen;
      const firstDi = Math.floor(lineStart / period);
      for (let di = firstDi; di * period + dotR < lineEnd + dotLen; di++) {
        const dotCenter = di * period + dotR;
        if (dotCenter < lineStart || dotCenter > lineEnd) continue;

        const t = (dotCenter - lineStart) / lineLen;
        const cx = lg.x1 + (lg.x2 - lg.x1) * t;
        const cy = lg.y1 + (lg.y2 - lg.y1) * t;
        fillDot(doc, cx, cy, dotR);
      }
    }
  }

  // ── 2. 角落弧段
  const n = segs.length;
  const arcIdxs = [(liIdx - 1 + n) % n, (liIdx + 1) % n];

  for (const ai of arcIdxs) {
    const seg = segs[ai];
    if (seg.kind !== 'arc') continue;

    const corner = corners.find((c) => c.segs.includes(ai));
    const rc = corner.R > 0 ? corner.R - bw / 2 : 0;
    const arcSpan = Math.abs(seg.t1 - seg.t0);
    const arcLen = rc > 0 ? rc * arcSpan : 0;
    if (arcLen <= 0) continue;

    const arcStart = gOff[ai];
    const arcEnd = arcStart + arcLen;

    const firstDi = Math.floor(arcStart / period);
    for (let di = firstDi; di * period + dotR < arcEnd + dotLen; di++) {
      const dotCenter = di * period + dotR;
      if (dotCenter < arcStart || dotCenter > arcEnd) continue;

      const relCenter = dotCenter - arcStart;
      const tC = rc > 0 ? seg.t0 + relCenter / rc : (seg.t0 + seg.t1) / 2;

      const cx = corner.cx + rc * Math.cos(tC);
      const cy = corner.cy + rc * Math.sin(tC);
      fillDot(doc, cx, cy, dotR);
    }
  }
}

// ─── 导出 ────────────────────────────────────────────────────────────────────

/**
 * 绘制 dotted 单边。
 * 直角（r 全为 0）：clip 梯形 + 圆点序列（原有逻辑）。
 * 圆角（任一角 > 0）：整圈相位计算 + 无 clip 放圆点（新逻辑）。
 */
function drawDottedBorder({
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
    drawDottedBorderRounded({
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

  const dotR = bw / 2;
  const isH = dir === 'top' || dir === 'bottom';
  const outerLen = isH ? w : h;
  const nMid = Math.max(0, Math.round(outerLen / (2.0 * bw)) - 2);
  const gapLen = (outerLen - (nMid + 2) * bw) / (nMid + 1);

  const dotDirs = {
    top: () =>
      dotLine({
        doc,
        x0: x,
        x1: x + w + bw,
        yMid: y + dotR,
        r: dotR,
        gapLen,
      }),
    bottom: () =>
      dotLine({
        doc,
        x0: x,
        x1: x + w + bw,
        yMid: y + h - dotR,
        r: dotR,
        gapLen,
      }),
    left: () =>
      dotLineV({
        doc,
        xMid: x + dotR,
        y0: y,
        y1: y + h + bw,
        r: dotR,
        gapLen,
      }),
    right: () =>
      dotLineV({
        doc,
        xMid: x + w - dotR,
        y0: y,
        y1: y + h + bw,
        r: dotR,
        gapLen,
      }),
  };
  dotDirs[dir]();

  doc.restoreGraphicsState();
}

export { drawDottedBorder };
