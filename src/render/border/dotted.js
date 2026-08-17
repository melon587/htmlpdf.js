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
import { buildRoundedGeom, selectBestDashGap } from './rounded-geom';

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
  cr,
  cb,
  cl,
}) {
  const { segs, corners, lineGeom, lineSegIdx, colors } = buildRoundedGeom({
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

  const color = colors[si];
  const dotR = bw / 2;

  // gOff：弧段直接用 seg.R - bw/2（与 dashed 一致）
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

  const gap = selectBestDashGap(totalPerimeter, bw, bw, true);
  const period = bw + gap;

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
      for (let di = firstDi; di * period + dotR < lineEnd + bw; di++) {
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
    const rc = Math.max(seg.R - bw / 2, 0);
    const arcSpan = Math.abs(seg.t1 - seg.t0);
    const arcLen = rc > 0 ? rc * arcSpan : 0;
    if (arcLen <= 0) continue;

    const arcStart = gOff[ai];
    const arcEnd = arcStart + arcLen;

    const firstDi = Math.floor(arcStart / period);
    for (let di = firstDi; di * period + dotR < arcEnd + bw; di++) {
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
  cr,
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
