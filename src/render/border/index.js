/**
 * index.js — border 主入口
 *
 * 职责：
 *   1. drawBorder  — 解析节点样式，按四条边逐一调用 drawOneSide 分发
 *   2. drawOneSide — 按 borderStyle 路由到 solid/double/dashed/dotted
 *   3. drawSpillClosingLines — 跨页截断处闭合线
 */

import { parsePx, parseColor } from '../../utils';
import { parseRadius } from '../radius';
import { drawSolidBorder } from './solid';
import { drawDoubleBorder } from './double';
import { drawDashedBorder } from './dashed';
import { drawDottedBorder } from './dotted';

// ─── 跨页 clip ────────────────────────────────────────────────────────────────

function applyPageClip({ doc, x, w, clipTopMm, clipBottomMm }) {
  doc.saveGraphicsState();
  const clipH = clipBottomMm - clipTopMm;

  if (clipH > 0) {
    const x0 = x - 1;
    const x1 = x + w + 1;

    doc.moveTo(x0, clipTopMm);
    doc.lineTo(x1, clipTopMm);
    doc.lineTo(x1, clipBottomMm);
    doc.lineTo(x0, clipBottomMm);
    doc.close();
    doc.clip();
    doc.discardPath();
  }

  return () => doc.restoreGraphicsState();
}

// ─── 单边分发 ─────────────────────────────────────────────────────────────────

/**
 * 绘制单条 border 边，按 bStyle 路由到对应的 draw*Border。
 *
 * @param {string} dir   - 'top' | 'right' | 'bottom' | 'left'
 * @param {number} bwPx  - border-width (px)
 * @param {string} colorStr - CSS color
 * @param {string} bStyle   - border-style
 * @param {Object} sides    - 四边信息，每项含 bwPx（用于角落斜切计算）
 */
function drawOneSide({
  doc,
  x,
  y,
  w,
  h,
  r,
  toMM,
  dir,
  bwPx,
  colorStr,
  bStyle,
  sides,
}) {
  const isNone = !bStyle || bStyle === 'none' || bStyle === 'hidden';
  if (isNone || bwPx <= 0) return;

  const c = parseColor(colorStr);
  if (!c) return;

  const bw = toMM(bwPx);
  const bt = toMM(sides.top.bwPx);
  const bb = toMM(sides.bottom.bwPx);
  const bl = toMM(sides.left.bwPx);
  const br = toMM(sides.right.bwPx);

  const args = { doc, x, y, w, h, r, dir, bw, bt, bb, bl, br, c };

  if (bStyle === 'double') {
    drawDoubleBorder(args);
  } else if (bStyle === 'dashed') {
    drawDashedBorder(args);
  } else if (bStyle === 'dotted') {
    drawDottedBorder(args);
  } else {
    // solid 及其他未识别 style 降级为 solid
    drawSolidBorder(args);
  }
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 绘制边框（fill 梯形模型，跨页裁剪，支持 border-radius）
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

  const yNode = toPdfYmm(nodeTop);
  const fullH = toMM(node.height);

  const clipTopMm = toPdfYmm(drawTop);
  const clipBottomMm = toPdfYmm(drawBottom);

  const isFirstPage = nodeTop >= clipTop;
  const isLastPage = isLastSpill && nodeBottom <= clipBottom;
  const isSinglePage = isFirstPage && isLastPage;

  const sides = {
    top: {
      bwPx: parsePx(style.borderTopWidth),
      colorStr: style.borderTopColor,
      bStyle: style.borderTopStyle,
    },
    right: {
      bwPx: parsePx(style.borderRightWidth),
      colorStr: style.borderRightColor,
      bStyle: style.borderRightStyle,
    },
    bottom: {
      bwPx: parsePx(style.borderBottomWidth),
      colorStr: style.borderBottomColor,
      bStyle: style.borderBottomStyle,
    },
    left: {
      bwPx: parsePx(style.borderLeftWidth),
      colorStr: style.borderLeftColor,
      bStyle: style.borderLeftStyle,
    },
  };

  const radius = node.collapseCell
    ? { tl: 0, tr: 0, br: 0, bl: 0 }
    : parseRadius({ style, toMM, w, h: fullH });

  let restoreClip = null;

  if (!isSinglePage) {
    restoreClip = applyPageClip({ doc, x, w, clipTopMm, clipBottomMm });
  }

  for (const dir of ['top', 'right', 'bottom', 'left']) {
    const { bwPx, colorStr, bStyle } = sides[dir];

    if (dir === 'top' && !isFirstPage) continue;

    if (dir === 'bottom' && !isLastPage) continue;

    drawOneSide({
      doc,
      x,
      y: yNode,
      w,
      h: fullH,
      r: radius,
      toMM,
      dir,
      bwPx,
      colorStr,
      bStyle,
      sides,
    });
  }

  if (restoreClip) restoreClip();
}

// ─── 跨页闭合线 ───────────────────────────────────────────────────────────────

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
 * 在表格跨页截断处画出口闭合线。
 */
function drawSpillClosingLines({ node, ctx, clipBottom, pageBreakBorder }) {
  const { doc, toMM, toPdfX, toPdfYmm } = ctx;
  const fb = parseBorderString(pageBreakBorder);
  if (!fb) return;

  const x = toPdfX(node.x);
  const w = toMM(node.width);
  const bw = toMM(fb.bw);

  doc.setFillColor(fb.color[0], fb.color[1], fb.color[2]);
  doc.rect(x, toPdfYmm(clipBottom) - bw / 2, w, bw, 'F');
}

export { drawBorder, drawSpillClosingLines };
