/**
 * rounded-geom.js — 圆角 border 公共几何
 *
 * 被 dashed.js 和 dotted.js 的圆角分支共用。
 * 提供：
 *   buildRoundedGeom  — 构建 12 段整圈路径、corners、lineGeom
 *   selectBestDashGap — Blink 整圈 fitting 算法
 */

const PI = Math.PI;

/**
 * Blink selectBestDashGap：使 dash/dot 两端对齐，closed=true 用于整圈。
 */
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
 * 构建圆角 border 的整圈几何数据。
 *
 * @returns {{
 *   segs:       Array<{kind,len?,cx?,cy?,R?,t0?,t1?,color}>,
 *   corners:    Array<{segs,cx,cy,R,t0,t1,bwA,bwB}>,
 *   lineGeom:   Array<{x1,y1,x2,y2}>,
 *   lineSegIdx: number[],
 *   colors:     Array,
 * }}
 */
function buildRoundedGeom({
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
}) {
  const rTL = Math.min(r.tl, w / 2, h / 2);
  const rTR = Math.min(r.tr, w / 2, h / 2);
  const rBR = Math.min(r.br, w / 2, h / 2);
  const rBL = Math.min(r.bl, w / 2, h / 2);

  const cxTL = x + rTL,
    cyTL = y + rTL;
  const cxTR = x + w - rTR,
    cyTR = y + rTR;
  const cxBR = x + w - rBR,
    cyBR = y + h - rBR;
  const cxBL = x + rBL,
    cyBL = y + h - rBL;

  const sTL = PI + Math.atan2(bwL, bwT);
  const sTR = (3 * PI) / 2 + Math.atan2(bwT, bwR);
  const sBR = Math.atan2(bwR, bwB);
  const sBL = PI / 2 + Math.atan2(bwB, bwL);

  const colors = [ct, cr, cb, cl];

  // 12 段整圈路径（顺时针）
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

  // 每条 side 的 line 段索引
  const lineSegIdx = [0, 3, 6, 9];

  // 直线段几何（中心线坐标，供 stroke/dot 使用）
  const lineGeom = [
    { x1: x + rTL, y1: y + bwT / 2, x2: x + w - rTR, y2: y + bwT / 2 },
    { x1: x + w - bwR / 2, y1: y + rTR, x2: x + w - bwR / 2, y2: y + h - rBR },
    { x1: x + w - rBR, y1: y + h - bwB / 2, x2: x + rBL, y2: y + h - bwB / 2 },
    { x1: x + bwL / 2, y1: y + h - rBL, x2: x + bwL / 2, y2: y + rTL },
  ];

  // 角落信息（innerR 插值 + 弧段归属）
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

  // clip 梯形辅助（dashed 用，dotted 不用但数据顺便带上）
  const BIG = Math.max(w, h) * 3;
  const splitLen = Math.max(w, h) * 2;
  const splitAngles = { sTL, sTR, sBR, sBL };
  const cornerCenters = { cxTL, cyTL, cxTR, cyTR, cxBR, cyBR, cxBL, cyBL };

  return {
    x,
    y,
    w,
    h,
    segs,
    corners,
    lineGeom,
    lineSegIdx,
    colors,
    BIG,
    splitLen,
    splitAngles,
    cornerCenters,
  };
}

/**
 * 为指定 side 建立梯形 clip（分割角射线围成的区域）。
 * 调用后需配合 saveGraphicsState / restoreGraphicsState 使用。
 *
 * @param {Object} doc  - jsPDF 实例
 * @param {Object} geom - buildRoundedGeom 的返回值
 * @param {number} sIdx - side 索引：0=top 1=right 2=bottom 3=left
 */
function clipForSide(doc, geom, sIdx) {
  const { x, y, w, h, BIG, splitLen, splitAngles, cornerCenters } = geom;
  const { sTL, sTR, sBR, sBL } = splitAngles;
  const { cxTL, cyTL, cxTR, cyTR, cxBR, cyBR, cxBL, cyBL } = cornerCenters;

  function splitPt(cxC, cyC, angle) {
    return {
      x: cxC + splitLen * Math.cos(angle),
      y: cyC + splitLen * Math.sin(angle),
    };
  }

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

export { buildRoundedGeom, selectBestDashGap, clipForSide };
