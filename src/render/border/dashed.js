/**
 * dashed.js — dashed border 绘制
 *
 * 方案：先用该边的梯形路径做 clip，再沿全边铺放矩形 dash 序列。
 * clip 精确限制 dash 到该边所属梯形区域（角落精确裁剪）。
 *
 * 浏览器算法：dashLen:gapLen = 2:1，两端固定 + 中间均分。
 * gapLen*(3*nMid+5) = outerLen，nMid = round(outerLen/(3*bw)) - 2
 */

import { buildSidePath } from './solid';

// ─── 辅助：矩形 dash 序列 ─────────────────────────────────────────────────────

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

// ─── 导出 ────────────────────────────────────────────────────────────────────

/**
 * 绘制 dashed 单边。
 */
function drawDashedBorder({ doc, x, y, w, h, r, dir, bw, bt, bb, bl, br, c }) {
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
