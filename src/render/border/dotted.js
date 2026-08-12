/**
 * dotted.js — dotted border 绘制
 *
 * 方案：先用该边的梯形路径做 clip，再沿全边铺放圆点序列。
 * clip 精确限制圆点到该边所属梯形区域（角落精确裁剪）。
 *
 * 算法：dot:gap = 1:1，两端固定 + 中间均分。
 * nMid = round(outerLen/(2*bw)) - 2
 * gapLen = (outerLen - (nMid+2)*bw) / (nMid+1)
 */

import { buildSidePath } from './solid';

// ─── 辅助：圆点序列 ───────────────────────────────────────────────────────────

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

// ─── 导出 ────────────────────────────────────────────────────────────────────

/**
 * 绘制 dotted 单边。
 */
function drawDottedBorder({ doc, x, y, w, h, r, dir, bw, bt, bb, bl, br, c }) {
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
