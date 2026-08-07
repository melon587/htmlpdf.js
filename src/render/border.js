import { parsePx, parseColor } from '../utils';
import { parseRadius, appendArcSegment } from './radius';

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

// ─── 梯形路径构建 ─────────────────────────────────────────────────────────────
//
// 浏览器渲染 border 的原理：
//   每条边是一个独立的填充区域，相邻边在角落处精确拼合，任何像素仅属于一条边。
//   opacity < 1 时角落颜色与边中段完全一致，无叠色。
//
// 角落分割（与 Chromium Blink 一致）：
//   直角：每个角落用斜切线分成两个三角形，各边各取一个三角形。
//   圆角：每个角落的圆弧按"径向分割线"分成两段弧形，各边各取一段。
//         分割角 = atan2(边A宽, 边B宽)，等宽时为45°。
//         每段弧形 = 外弧段 + 内弧段（同心，innerR=max(r-bw,0)）+ 两端径向线，
//         组成一个封闭弧形块（sector）。
//
// jsPDF 坐标系角度约定（本文件全局）：
//   0 = 3点方向（右），逆时针为正，y轴向下（视觉上逆时针↔角度减小）。
//   appendArcSegment 按角度增大方向走弧（视觉顺时针）。
//
//   各角外弧完整90°的角度范围：
//     TL：π（左边切点）→ 3π/2（顶边切点）
//     TR：3π/2（顶边切点）→ 2π=0（右边切点）  等价 -π/2 → 0
//     BR：0（右边切点）→ π/2（底边切点）
//     BL：π/2（底边切点）→ π（左边切点）

const PI = Math.PI;

/**
 * 画 top-border 的填充路径，并 fill。
 *
 * 路径结构（圆角）：
 *   外轮廓（CW）：TL外弧后半段 → 顶边 → TR外弧前半段
 *   内轮廓（从右往左）：径向线(到TR内弧端) → TR内弧前半反向 → 内顶边
 *                      → TL内弧后半反向 → 径向线(回TL外弧起点)
 *   close
 *
 * 角落归属：
 *   TL: top 管后半段(sTL→3π/2)，left 管前半段(π→sTL)
 *       sTL = π + atan2(bl, bt)
 *   TR: top 管前半段(3π/2→sTR)，right 管后半段(sTR→2π)
 *       sTR = 3π/2 + atan2(bt, br)
 */
function fillTopBorder({ doc, x, y, w, bt, bl, br, r, color }) {
  if (bt <= 0) return;

  const { tl, tr } = r;

  doc.setFillColor(color[0], color[1], color[2]);

  // ── 外轮廓（顺时针）────────────────────────────────────
  if (tl > 0) {
    const cxTL = x + tl;
    const cyTL = y + tl;
    const sTL = PI + Math.atan2(bl, bt); // 分割角
    // 外弧后半段起点
    doc.moveTo(cxTL + tl * Math.cos(sTL), cyTL + tl * Math.sin(sTL));
    // 外弧后半段：sTL → 3π/2（顶边切点）
    appendArcSegment(doc, cxTL, cyTL, tl, sTL, (3 * PI) / 2);
    // 当前点 = (cxTL, cyTL-tl) = (x+tl, y)
  } else {
    doc.moveTo(x, y);
  }

  // 顶边
  doc.lineTo(x + w - tr, y);

  if (tr > 0) {
    const cxTR = x + w - tr;
    const cyTR = y + tr;
    const sTR = (3 * PI) / 2 + Math.atan2(bt, br); // 分割角
    // 外弧前半段：3π/2（顶边切点）→ sTR
    appendArcSegment(doc, cxTR, cyTR, tr, (3 * PI) / 2, sTR);
    // 当前点 = 外弧分割点 sTR
  }

  // ── 内轮廓（从右往左）────────────────────────────────────
  if (tr > 0) {
    const cxTR = x + w - tr;
    const cyTR = y + tr;
    const sTR = (3 * PI) / 2 + Math.atan2(bt, br);
    const innerTR = Math.max(tr - Math.max(bt, br), 0);

    if (innerTR > 0) {
      // 径向线：外弧分割点 → 内弧分割点
      doc.lineTo(
        cxTR + innerTR * Math.cos(sTR),
        cyTR + innerTR * Math.sin(sTR),
      );
      // 内弧前半段反向：sTR → 3π/2
      appendArcSegment(doc, cxTR, cyTR, innerTR, sTR, (3 * PI) / 2);
      // 当前点 = 内弧顶边端 = (cxTR, cyTR-innerTR) = (x+w-tr, y+tr-innerTR)
    } else {
      // innerTR=0：内弧退化，用斜切线到内角点（与直角情况一致）
      doc.lineTo(x + w - br, y + bt);
    }
  } else {
    // 直角TR：斜切线
    doc.lineTo(x + w - br, y + bt);
  }

  // 内顶边
  if (tl > 0) {
    const cxTL = x + tl;
    const cyTL = y + tl;
    const sTL = PI + Math.atan2(bl, bt);
    const innerTL = Math.max(tl - Math.max(bt, bl), 0);

    // 内顶边（到TL内弧顶边端）
    doc.lineTo(cxTL, cyTL - innerTL); // = (x+tl, y+tl-innerTL)
    if (innerTL > 0) {
      // 内弧后半段反向：3π/2 → sTL
      appendArcSegment(doc, cxTL, cyTL, innerTL, (3 * PI) / 2, sTL);
      // 当前点 = 内弧分割点 sTL
      // 径向线：内弧分割点 → 外弧分割点（close 自动完成）
    } else {
      // innerTL=0：内弧退化，lineTo 到外弧分割点（close 自动完成径向线）
      doc.lineTo(cxTL + tl * Math.cos(sTL), cyTL + tl * Math.sin(sTL));
    }
  } else {
    // 直角TL：内顶边左端
    doc.lineTo(x + bl, y + bt);
  }

  doc.close();
  doc.fill();
}

/**
 * 画 bottom-border 的填充路径，并 fill。
 *
 * 角落归属：
 *   BR: bottom 管后半段(sTR_br→π/2)，right 管前半段(0→sTR_br)
 *       sTR_br = atan2(br, bb)  （right先，bottom后）
 *       实际：BR外弧范围 0→π/2，right 管 0→sBR，bottom 管 sBR→π/2
 *       sBR = atan2(bb, br)  （bottom先=bb，right后=br？ 需要重新想）
 *
 * BR角：right 边从右边切点(0°)走过来，bottom 边到底边切点(π/2)走出去
 *   right 管前半(0→sBR)，bottom 管后半(sBR→π/2)
 *   sBR = 0 + atan2(br, bb)  [right 的边宽 br 在前，bottom 的边宽 bb 在后]
 *   等宽时 sBR = π/4 ✓
 *
 * BL角：bottom 边从底边切点(π/2)走过来，left 边到左边切点(π)走出去
 *   bottom 管前半(π/2→sBL)，left 管后半(sBL→π)
 *   sBL = π/2 + atan2(bb, bl)
 *   等宽时 sBL = π/2+π/4 = 3π/4 ✓
 *
 * 路径结构（CW，内→外）：
 *   内底边 → BR内弧后半 → 径向线 → BR外弧后半 → 底边 → BL外弧前半 → 径向线 → BL内弧前半 → close
 */
function fillBottomBorder({ doc, x, y, w, h, bb, bl, br, r, color }) {
  if (bb <= 0) return;

  const { br: rbr, bl: rbl } = r;

  doc.setFillColor(color[0], color[1], color[2]);

  // ── 内轮廓起点（从左往右）────────────────────────────────
  if (rbl > 0) {
    const cxBL = x + rbl;
    const cyBL = y + h - rbl;
    const sBL = PI / 2 + Math.atan2(bb, bl);
    const innerBL = Math.max(rbl - Math.max(bb, bl), 0);

    if (innerBL > 0) {
      // 内弧前半段终点（sBL处）= 内轮廓左起点
      doc.moveTo(
        cxBL + innerBL * Math.cos(sBL),
        cyBL + innerBL * Math.sin(sBL),
      );
      // 内弧前半反向：sBL → π/2（底边内端）
      appendArcSegment(doc, cxBL, cyBL, innerBL, sBL, PI / 2);
      // 当前点 = 内弧底边端 = (cxBL, cyBL+innerBL) = (x+rbl, y+h-rbl+innerBL)
    } else {
      // innerBL=0：斜切线起点（与直角一致）
      doc.moveTo(x + bl, y + h - bb);
    }
  } else {
    doc.moveTo(x + bl, y + h - bb);
  }

  // 内底边
  if (rbr > 0) {
    const cxBR = x + w - rbr;
    const cyBR = y + h - rbr;
    const sBR = Math.atan2(br, bb);
    const innerBR = Math.max(rbr - Math.max(bb, br), 0);

    if (innerBR > 0) {
      // 内底边（到BR内弧底边端）
      doc.lineTo(cxBR, cyBR + innerBR); // = (x+w-rbr, y+h-rbr+innerBR)
      // 内弧后半反向：π/2 → sBR
      appendArcSegment(doc, cxBR, cyBR, innerBR, PI / 2, sBR);
      // 径向线：内弧分割点 → 外弧分割点
      doc.lineTo(cxBR + rbr * Math.cos(sBR), cyBR + rbr * Math.sin(sBR));
    } else {
      // innerBR=0：斜切线到外弧分割点（与直角一致）
      doc.lineTo(x + w - br, y + h - bb);
      doc.lineTo(cxBR + rbr * Math.cos(sBR), cyBR + rbr * Math.sin(sBR));
    }

    // 外弧后半段：sBR → π/2（底边切点）
    appendArcSegment(doc, cxBR, cyBR, rbr, sBR, PI / 2);
    // 当前点 = (cxBR, cyBR+rbr) = (x+w-rbr, y+h)
  } else {
    doc.lineTo(x + w - br, y + h - bb); // 内底边
    doc.lineTo(x + w, y + h); // 直角
  }

  // 底边（从右到左）
  doc.lineTo(x + rbl, y + h);

  // BL 角外弧
  if (rbl > 0) {
    const cxBL = x + rbl;
    const cyBL = y + h - rbl;
    const sBL = PI / 2 + Math.atan2(bb, bl);
    // 外弧前半段反向（从π/2到sBL）→ 再径向线回到内弧起点
    // 实际上外弧从底边切点(π/2)向左走到sBL
    // 但底边走完后当前点在底边切点(π/2)处
    // 等等，外弧的"前半"是 π/2→sBL 的那半段（bottom 管的），
    // 我们要从底边切点(π/2，也就是(x+rbl,y+h))走到sBL处
    appendArcSegment(doc, cxBL, cyBL, rbl, PI / 2, sBL);
    // 当前点 = 外弧分割点 sBL
    // 径向线：外弧分割点 → 内弧分割点（也是 moveTo 起点）
    // close 会自动完成这段
  }

  doc.close();
  doc.fill();
}

/**
 * 画 left-border 的填充路径，并 fill。
 *
 * 角落归属：
 *   TL: left 管前半段(π→sTL)，top 管后半段(sTL→3π/2)
 *       sTL = π + atan2(bl, bt)
 *   BL: bottom 管前半段(π/2→sBL)，left 管后半段(sBL→π)
 *       sBL = π/2 + atan2(bb, bl)
 *
 * 路径结构：
 *   TL外弧前半 → 径向线 → TL内弧前半反向 → 内竖线 → BL内弧后半反向 → 径向线 → BL外弧后半 → close
 */
function fillLeftBorder({ doc, x, y, h, bt, bb, bl, r, color }) {
  if (bl <= 0) return;

  const { tl, bl: rbl } = r;

  doc.setFillColor(color[0], color[1], color[2]);

  if (tl > 0) {
    const cxTL = x + tl;
    const cyTL = y + tl;
    const sTL = PI + Math.atan2(bl, bt);
    const innerTL = Math.max(tl - Math.max(bt, bl), 0);

    // 外弧前半段起点（π处，左边切点）
    doc.moveTo(x, y + tl); // = (cxTL - tl, cyTL) = (x, y+tl)
    // 外弧前半段：π → sTL
    appendArcSegment(doc, cxTL, cyTL, tl, PI, sTL);
    if (innerTL > 0) {
      // 径向线：外弧分割点 → 内弧分割点
      doc.lineTo(
        cxTL + innerTL * Math.cos(sTL),
        cyTL + innerTL * Math.sin(sTL),
      );
      // 内弧前半反向：sTL → π
      appendArcSegment(doc, cxTL, cyTL, innerTL, sTL, PI);
      // 当前点 = 内弧左边端 = (cxTL-innerTL, cyTL) = (x+tl-innerTL, y+tl)
    } else {
      // innerTL=0：斜切线到内角点（与直角一致）
      doc.lineTo(x + bl, y + bt);
    }
  } else {
    doc.moveTo(x, y);
    doc.lineTo(x + bl, y + bt);
  }

  // 内竖线（从TL内弧端到BL内弧端）
  if (rbl > 0) {
    const cxBL = x + rbl;
    const cyBL = y + h - rbl;
    const sBL = PI / 2 + Math.atan2(bb, bl);
    const innerBL = Math.max(rbl - Math.max(bb, bl), 0);

    if (innerBL > 0) {
      // 内竖线：从TL内弧左边端 → BL内弧左边端（π处端点）
      doc.lineTo(cxBL - innerBL, cyBL); // = (x+rbl-innerBL, y+h-rbl)
      // 内弧后半反向：π → sBL
      appendArcSegment(doc, cxBL, cyBL, innerBL, PI, sBL);
      // 径向线：内弧分割点 → 外弧分割点
      doc.lineTo(cxBL + rbl * Math.cos(sBL), cyBL + rbl * Math.sin(sBL));
    } else {
      // innerBL=0：斜切线到外弧分割点（与直角一致）
      doc.lineTo(x + bl, y + h - bb);
      doc.lineTo(cxBL + rbl * Math.cos(sBL), cyBL + rbl * Math.sin(sBL));
    }

    // 外弧后半段：sBL → π
    appendArcSegment(doc, cxBL, cyBL, rbl, sBL, PI);
    // 当前点 = 外弧左边端 = (x, y+h-rbl)
  } else {
    doc.lineTo(x + bl, y + h - bb);
    doc.lineTo(x, y + h);
  }

  doc.close();
  doc.fill();
}

/**
 * 画 right-border 的填充路径，并 fill。
 *
 * 角落归属：
 *   TR: top 管前半(3π/2→sTR)，right 管后半(sTR→2π)
 *       sTR = 3π/2 + atan2(bt, br)
 *   BR: right 管前半(0→sBR)，bottom 管后半(sBR→π/2)
 *       sBR = atan2(br, bb)
 *
 * 路径结构：
 *   TR外弧后半 → 径向线 → TR内弧后半反向 → 内竖线 → BR内弧前半反向 → 径向线 → BR外弧前半 → close
 */
function fillRightBorder({ doc, x, y, w, h, bt, bb, brW, r, color }) {
  if (brW <= 0) return;

  const { tr, br: rbr } = r;

  doc.setFillColor(color[0], color[1], color[2]);

  // ── 外轮廓（顺时针：sTR → 右切点 → 右边 → BR切点 → sBR）────────────────
  if (tr > 0) {
    const cxTR = x + w - tr;
    const cyTR = y + tr;
    const sTR = (3 * PI) / 2 + Math.atan2(bt, brW);

    // 外弧后半起点
    doc.moveTo(cxTR + tr * Math.cos(sTR), cyTR + tr * Math.sin(sTR));
    // 外弧后半：sTR → 2π → 当前点 = (x+w, y+tr)
    appendArcSegment(doc, cxTR, cyTR, tr, sTR, 2 * PI);
  } else {
    doc.moveTo(x + w, y);
  }

  // 外右边：(x+w, y+tr) → (x+w, y+h-rbr)
  if (rbr > 0) {
    doc.lineTo(x + w, y + h - rbr);
  } else {
    doc.lineTo(x + w, y + h);
  }

  if (rbr > 0) {
    const cxBR = x + w - rbr;
    const cyBR = y + h - rbr;
    const sBR = Math.atan2(brW, bb);
    const innerBR = Math.max(rbr - Math.max(bb, brW), 0);

    // 外弧前半：0 → sBR
    appendArcSegment(doc, cxBR, cyBR, rbr, 0, sBR);
    // 当前点 = 外弧分割点 sBR

    // ── 内轮廓（逆时针：sBR内 → 内右边 → TR内弧端 → sTR）──────────────────
    if (innerBR > 0) {
      // 径向线：外弧分割点 → 内弧分割点
      doc.lineTo(
        cxBR + innerBR * Math.cos(sBR),
        cyBR + innerBR * Math.sin(sBR),
      );
      // 内弧前半反向：sBR → 0
      appendArcSegment(doc, cxBR, cyBR, innerBR, sBR, 0);
      // 当前点 = 内弧右边端 = (cxBR+innerBR, cyBR)
    } else {
      // innerBR=0：斜切线到内角点
      doc.lineTo(x + w - brW, y + h - bb);
    }
  } else {
    // 直角BR
    doc.lineTo(x + w - brW, y + h - bb);
  }

  // 内右边：BR内弧端 → TR内弧端（从下往上）
  if (tr > 0) {
    const cxTR = x + w - tr;
    const cyTR = y + tr;
    const sTR = (3 * PI) / 2 + Math.atan2(bt, brW);
    const innerTR = Math.max(tr - Math.max(bt, brW), 0);

    if (innerTR > 0) {
      // 内右边到TR内弧右切点
      doc.lineTo(cxTR + innerTR, cyTR);
      // 内弧后半反向：2π → sTR
      appendArcSegment(doc, cxTR, cyTR, innerTR, 2 * PI, sTR);
      // 当前点 = 内弧分割点 sTR
    } else {
      // innerTR=0：斜切线到内角点
      doc.lineTo(x + w - brW, y + bt);
    }
  } else {
    // 直角TR
    doc.lineTo(x + w - brW, y + bt);
  }

  // close() 自动画径向线回到 moveTo（外弧 sTR 或直角顶点）
  doc.close();
  doc.fill();
}

// ─── dashed/dotted fill 实现 ──────────────────────────────────────────────────
//
// 浏览器的 dashed/dotted 也是 fill 模型：
//   dotted：沿边的中线按间距 2*bw 放置实心圆（半径 bw/2）
//   dashed：沿边的中线按间距 3*bw + 3*bw 放置矩形（长 3*bw，宽 bw）
//
// 下面的实现沿直边段填充，圆角弧上的点/段暂时省略（角落处跳过）。
// TODO: 如需在圆角弧上也绘制 dotted/dashed，需按弧长参数化，
//       计算圆心/矩形中心位置后逐个绘制。

/**
 * 沿水平线段绘制 dotted 圆点序列。
 * 从 x0 开始到 x1，沿 y=yMid 按步长 2*r 放置圆（半径 r = bw/2）。
 */
function dotLine({ doc, x0, x1, yMid, r }) {
  const step = r * 2;
  let cx = x0 + r;

  while (cx + r <= x1 + 1e-6) {
    doc.ellipse(cx, yMid, r, r, 'F');
    cx += step;
  }
}

/**
 * 沿竖直线段绘制 dotted 圆点序列。
 */
function dotLineV({ doc, xMid, y0, y1, r }) {
  const step = r * 2;
  let cy = y0 + r;

  while (cy + r <= y1 + 1e-6) {
    doc.ellipse(xMid, cy, r, r, 'F');
    cy += step;
  }
}

/**
 * 沿水平线段绘制 dashed 矩形序列。
 * dash 长 dashLen = 3*bw，间距 gapLen = 3*bw（CSS 规范默认）。
 */
function dashLine({ doc, x0, x1, yMid, bw }) {
  const dashLen = bw * 3;
  const gapLen = bw * 3;
  const step = dashLen + gapLen;
  let cx = x0;

  while (cx + dashLen <= x1 + 1e-6) {
    doc.rect(cx, yMid - bw / 2, dashLen, bw, 'F');
    cx += step;
  }
}

/**
 * 沿竖直线段绘制 dashed 矩形序列。
 */
function dashLineV({ doc, xMid, y0, y1, bw }) {
  const dashLen = bw * 3;
  const gapLen = bw * 3;
  const step = dashLen + gapLen;
  let cy = y0;

  while (cy + dashLen <= y1 + 1e-6) {
    doc.rect(xMid - bw / 2, cy, bw, dashLen, 'F');
    cy += step;
  }
}

// ─── 单边入口（按 borderStyle 分发） ──────────────────────────────────────────

/**
 * 绘制单条 border 边（full fill 模型）。
 * solid/double → 梯形 fill
 * dotted       → 沿中线圆点 fill
 * dashed       → 沿中线矩形 fill
 *
 * @param {string} dir      - 'top' | 'right' | 'bottom' | 'left'
 * @param {number} bwPx     - border-width（px，原始值，由 parsePx 返回）
 * @param {string} colorStr - CSS color 字符串
 * @param {string} bStyle   - border-style
 * @param {Object} params   - { doc, x, y, w, h, r, toMM, sides }
 */
function fillOneSide({
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

  // 取相邻边宽度，用于角落斜切计算
  const btPx = sides.top.bwPx;
  const bbPx = sides.bottom.bwPx;
  const blPx = sides.left.bwPx;
  const brPx = sides.right.bwPx;
  const bt = toMM(btPx);
  const bb = toMM(bbPx);
  const bl = toMM(blPx);
  const br = toMM(brPx);

  if (bStyle === 'double') {
    // double = 外线（宽 bw/3，偏移 0）+ 内线（宽 bw/3，偏移 2*bw/3）
    // 每条线各自是独立的梯形 fill，中间留 bw/3 间隙
    fillOneSideLayer({
      doc,
      x,
      y,
      w,
      h,
      r,
      dir,
      bw: bw / 3,
      offset: 0,
      bt: bt / 3,
      bb: bb / 3,
      bl: bl / 3,
      br: br / 3,
      c,
    });
    fillOneSideLayer({
      doc,
      x,
      y,
      w,
      h,
      r,
      dir,
      bw: bw / 3,
      offset: (2 * bw) / 3,
      bt: bt / 3,
      bb: bb / 3,
      bl: bl / 3,
      br: br / 3,
      c,
    });

    return;
  }

  if (bStyle === 'dotted') {
    doc.setFillColor(c[0], c[1], c[2]);
    const dotR = bw / 2;

    if (dir === 'top') {
      // 沿顶边中线（y + dotR），从 tl 右端到 tr 左端
      dotLine({ doc, x0: x + r.tl, x1: x + w - r.tr, yMid: y + dotR, r: dotR });
    } else if (dir === 'bottom') {
      dotLine({
        doc,
        x0: x + r.bl,
        x1: x + w - r.br,
        yMid: y + h - dotR,
        r: dotR,
      });
    } else if (dir === 'left') {
      // 竖直段：从 tl 下端到 bl 上端
      const vTop = y + Math.max(r.tl, bt);
      const vBot = y + h - Math.max(r.bl, bb);

      dotLineV({ doc, xMid: x + dotR, y0: vTop, y1: vBot, r: dotR });
    } else {
      const vTop = y + Math.max(r.tr, bt);
      const vBot = y + h - Math.max(r.br, bb);

      dotLineV({ doc, xMid: x + w - dotR, y0: vTop, y1: vBot, r: dotR });
    }

    return;
  }

  if (bStyle === 'dashed') {
    doc.setFillColor(c[0], c[1], c[2]);

    if (dir === 'top') {
      dashLine({ doc, x0: x + r.tl, x1: x + w - r.tr, yMid: y + bw / 2, bw });
    } else if (dir === 'bottom') {
      dashLine({
        doc,
        x0: x + r.bl,
        x1: x + w - r.br,
        yMid: y + h - bw / 2,
        bw,
      });
    } else if (dir === 'left') {
      const vTop = y + Math.max(r.tl, bt);
      const vBot = y + h - Math.max(r.bl, bb);

      dashLineV({ doc, xMid: x + bw / 2, y0: vTop, y1: vBot, bw });
    } else {
      const vTop = y + Math.max(r.tr, bt);
      const vBot = y + h - Math.max(r.br, bb);

      dashLineV({ doc, xMid: x + w - bw / 2, y0: vTop, y1: vBot, bw });
    }

    return;
  }

  // solid（及其他未识别 style 降级为 solid）
  fillOneSideLayer({
    doc,
    x,
    y,
    w,
    h,
    r,
    dir,
    bw,
    offset: 0,
    bt,
    bb,
    bl,
    br,
    c,
  });
}

/**
 * 单层 solid fill（offset 用于 double 的外/内线偏移）。
 * offset: 该层梯形从节点边缘向内偏移的距离（mm）。
 *         solid 传 0；double 外线传 0，内线传 2*bw/3。
 */
function fillOneSideLayer({
  doc,
  x,
  y,
  w,
  h,
  r,
  dir,
  bw,
  offset,
  bt,
  bb,
  bl,
  br,
  c,
}) {
  // 将节点坐标 + 圆角半径按 offset 收缩
  const ox = x + offset;
  const oy = y + offset;
  const ow = w - 2 * offset;
  const oh = h - 2 * offset;
  const or = {
    tl: Math.max(r.tl - offset, 0),
    tr: Math.max(r.tr - offset, 0),
    br: Math.max(r.br - offset, 0),
    bl: Math.max(r.bl - offset, 0),
  };

  if (dir === 'top') {
    fillTopBorder({
      doc,
      x: ox,
      y: oy,
      w: ow,
      bt: bw,
      bl,
      br,
      r: or,
      color: c,
    });
  } else if (dir === 'bottom') {
    fillBottomBorder({
      doc,
      x: ox,
      y: oy,
      w: ow,
      h: oh,
      bb: bw,
      bl,
      br,
      r: or,
      color: c,
    });
  } else if (dir === 'left') {
    fillLeftBorder({
      doc,
      x: ox,
      y: oy,
      h: oh,
      bt,
      bb,
      bl: bw,
      r: or,
      color: c,
    });
  } else {
    fillRightBorder({
      doc,
      x: ox,
      y: oy,
      w: ow,
      h: oh,
      bt,
      bb,
      brW: bw,
      r: or,
      color: c,
    });
  }
}

// ─── 跨页 clip ───────────────────────────────────────────────────────────────

/**
 * 对跨页 border 施加 clip：将绘制区域限制在 [clipTopMm, clipBottomMm] 之间。
 * 调用方式：
 *   const restore = applyPageClip({ doc, x, w, clipTopMm, clipBottomMm });
 *   // ... 绘制 ...
 *   restore();
 *
 * 当节点完全在当前页内（单页）时不需要 clip，调用方跳过即可。
 */
function applyPageClip({ doc, x, w, clipTopMm, clipBottomMm }) {
  doc.saveGraphicsState();
  const clipH = clipBottomMm - clipTopMm;

  if (clipH > 0) {
    // 用 moveTo/lineTo 手动构建矩形路径再 clip，避免 doc.rect() 默认触发 stroke
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

// ─── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 绘制边框（fill 梯形模型，跨页裁剪，支持 border-radius）
 *
 * 与浏览器的对应关系：
 *   每条边 = 独立梯形 fill，角落精确拼合，无重叠 → opacity 正确。
 *   跨页 = 画完整节点的梯形路径 + clip 到当前页范围（不手动截路径）。
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

  // 节点在本页的完整坐标（用于 clip 计算）
  const yNode = toPdfYmm(nodeTop);
  const fullH = toMM(node.height);

  // clip 区域：本页可见范围
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

  // 跨页时施加 clip，单页不需要
  let restoreClip = null;

  if (!isSinglePage) {
    restoreClip = applyPageClip({ doc, x, w, clipTopMm, clipBottomMm });
  }

  // 按四条边逐一 fill（顺序：top → right → bottom → left，与浏览器 z-order 一致）
  for (const dir of ['top', 'right', 'bottom', 'left']) {
    const { bwPx, colorStr, bStyle } = sides[dir];

    // top/bottom 边：仅在 isFirstPage/isLastPage 时渲染（跨页时被 clip 截断）
    // left/right 边：每页都渲染（clip 控制可见范围）
    if (dir === 'top' && !isFirstPage) continue;

    if (dir === 'bottom' && !isLastPage) continue;

    fillOneSide({
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
  const bw = toMM(fb.bw);

  doc.setFillColor(fb.color[0], fb.color[1], fb.color[2]);
  // 闭合线：一个高度 = bw 的矩形，沿截断线居中
  doc.rect(x, toPdfYmm(clipBottom) - bw / 2, w, bw, 'F');
}

export { drawBorder, drawSpillClosingLines };
