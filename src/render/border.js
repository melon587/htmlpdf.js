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
/**
 * 仅构建 top-border 梯形路径（close），不 fill/clip。
 * 调用方自行决定后续操作（fill / clip+discard）。
 */
function buildTopBorderPath({ doc, x, y, w, bt, bl, br, r }) {
  const { tl, tr } = r;

  if (tl > 0) {
    const cxTL = x + tl;
    const cyTL = y + tl;
    const sTL = PI + Math.atan2(bl, bt);
    doc.moveTo(cxTL + tl * Math.cos(sTL), cyTL + tl * Math.sin(sTL));
    appendArcSegment(doc, cxTL, cyTL, tl, sTL, (3 * PI) / 2);
  } else {
    doc.moveTo(x, y);
  }

  doc.lineTo(x + w - tr, y);

  if (tr > 0) {
    const cxTR = x + w - tr;
    const cyTR = y + tr;
    const sTR = (3 * PI) / 2 + Math.atan2(bt, br);
    appendArcSegment(doc, cxTR, cyTR, tr, (3 * PI) / 2, sTR);
  }

  if (tr > 0) {
    const cxTR = x + w - tr;
    const cyTR = y + tr;
    const sTR = (3 * PI) / 2 + Math.atan2(bt, br);
    const innerTR = Math.max(tr - Math.max(bt, br), 0);

    if (innerTR > 0) {
      doc.lineTo(
        cxTR + innerTR * Math.cos(sTR),
        cyTR + innerTR * Math.sin(sTR),
      );
      appendArcSegment(doc, cxTR, cyTR, innerTR, sTR, (3 * PI) / 2);
    } else {
      doc.lineTo(x + w - br, y + bt);
    }
  } else {
    doc.lineTo(x + w - br, y + bt);
  }

  if (tl > 0) {
    const cxTL = x + tl;
    const cyTL = y + tl;
    const sTL = PI + Math.atan2(bl, bt);
    const innerTL = Math.max(tl - Math.max(bt, bl), 0);

    doc.lineTo(cxTL, cyTL - innerTL);
    if (innerTL > 0) {
      appendArcSegment(doc, cxTL, cyTL, innerTL, (3 * PI) / 2, sTL);
    } else {
      doc.lineTo(cxTL + tl * Math.cos(sTL), cyTL + tl * Math.sin(sTL));
    }
  } else {
    doc.lineTo(x + bl, y + bt);
  }

  doc.close();
}

function fillTopBorder({ doc, x, y, w, bt, bl, br, r, color }) {
  if (bt <= 0) return;

  doc.setFillColor(color[0], color[1], color[2]);
  buildTopBorderPath({ doc, x, y, w, bt, bl, br, r });
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

  doc.setFillColor(color[0], color[1], color[2]);
  buildBottomBorderPath({ doc, x, y, w, h, bb, bl, br, r });
  doc.fill();
}

function buildBottomBorderPath({ doc, x, y, w, h, bb, bl, br, r }) {
  const { br: rbr, bl: rbl } = r;

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
  }

  doc.close();
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

  doc.setFillColor(color[0], color[1], color[2]);
  buildLeftBorderPath({ doc, x, y, h, bt, bb, bl, r });
  doc.fill();
}

function buildLeftBorderPath({ doc, x, y, h, bt, bb, bl, r }) {
  const { tl, bl: rbl } = r;

  if (tl > 0) {
    const cxTL = x + tl;
    const cyTL = y + tl;
    const sTL = PI + Math.atan2(bl, bt);
    const innerTL = Math.max(tl - Math.max(bt, bl), 0);

    doc.moveTo(x, y + tl);
    appendArcSegment(doc, cxTL, cyTL, tl, PI, sTL);
    if (innerTL > 0) {
      doc.lineTo(
        cxTL + innerTL * Math.cos(sTL),
        cyTL + innerTL * Math.sin(sTL),
      );
      appendArcSegment(doc, cxTL, cyTL, innerTL, sTL, PI);
    } else {
      doc.lineTo(x + bl, y + bt);
    }
  } else {
    doc.moveTo(x, y);
    doc.lineTo(x + bl, y + bt);
  }

  if (rbl > 0) {
    const cxBL = x + rbl;
    const cyBL = y + h - rbl;
    const sBL = PI / 2 + Math.atan2(bb, bl);
    const innerBL = Math.max(rbl - Math.max(bb, bl), 0);

    if (innerBL > 0) {
      doc.lineTo(cxBL - innerBL, cyBL);
      appendArcSegment(doc, cxBL, cyBL, innerBL, PI, sBL);
      doc.lineTo(cxBL + rbl * Math.cos(sBL), cyBL + rbl * Math.sin(sBL));
    } else {
      doc.lineTo(x + bl, y + h - bb);
      doc.lineTo(cxBL + rbl * Math.cos(sBL), cyBL + rbl * Math.sin(sBL));
    }

    appendArcSegment(doc, cxBL, cyBL, rbl, sBL, PI);
  } else {
    doc.lineTo(x + bl, y + h - bb);
    doc.lineTo(x, y + h);
  }

  doc.close();
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

  doc.setFillColor(color[0], color[1], color[2]);
  buildRightBorderPath({ doc, x, y, w, h, bt, bb, brW, r });
  doc.fill();
}

function buildRightBorderPath({ doc, x, y, w, h, bt, bb, brW, r }) {
  const { tr, br: rbr } = r;

  if (tr > 0) {
    const cxTR = x + w - tr;
    const cyTR = y + tr;
    const sTR = (3 * PI) / 2 + Math.atan2(bt, brW);

    doc.moveTo(cxTR + tr * Math.cos(sTR), cyTR + tr * Math.sin(sTR));
    appendArcSegment(doc, cxTR, cyTR, tr, sTR, 2 * PI);
  } else {
    doc.moveTo(x + w, y);
  }

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

    appendArcSegment(doc, cxBR, cyBR, rbr, 0, sBR);

    if (innerBR > 0) {
      doc.lineTo(
        cxBR + innerBR * Math.cos(sBR),
        cyBR + innerBR * Math.sin(sBR),
      );
      appendArcSegment(doc, cxBR, cyBR, innerBR, sBR, 0);
    } else {
      doc.lineTo(x + w - brW, y + h - bb);
    }
  } else {
    doc.lineTo(x + w - brW, y + h - bb);
  }

  if (tr > 0) {
    const cxTR = x + w - tr;
    const cyTR = y + tr;
    const sTR = (3 * PI) / 2 + Math.atan2(bt, brW);
    const innerTR = Math.max(tr - Math.max(bt, brW), 0);

    if (innerTR > 0) {
      doc.lineTo(cxTR + innerTR, cyTR);
      appendArcSegment(doc, cxTR, cyTR, innerTR, 2 * PI, sTR);
    } else {
      doc.lineTo(x + w - brW, y + bt);
    }
  } else {
    doc.lineTo(x + w - brW, y + bt);
  }

  doc.close();
}

// ─── 辅助：按 dir 路由到对应 build*BorderPath ────────────────────────────────

/**
 * 构建指定方向的梯形路径（close，不 fill）。
 * 用于 dashed/dotted 的 clip 区域。
 */
function buildSidePath({ doc, x, y, w, h, dir, bw, bt, bb, bl, br, r }) {
  if (dir === 'top') {
    buildTopBorderPath({ doc, x, y, w, bt: bw, bl, br, r });
  } else if (dir === 'bottom') {
    buildBottomBorderPath({ doc, x, y, w, h, bb: bw, bl, br, r });
  } else if (dir === 'left') {
    buildLeftBorderPath({ doc, x, y, h, bt, bb, bl: bw, r });
  } else {
    buildRightBorderPath({ doc, x, y, w, h, bt, bb, brW: bw, r });
  }
}

// ─── dashed/dotted fill 实现 ──────────────────────────────────────────────────
//
// 方案：先用该边的梯形路径做 clip，再沿全边铺放 dash/dot。
// clip 精确限制了 dash/dot 到该边所属的梯形区域（角落精确裁剪）。
//
// TODO: dotted/dashed + border-radius 组合尚未实现。
//   当前 buildSidePath 传入的 r 由外部计算，梯形 clip 已正确处理直角情况，
//   圆角时 clip 路径本身正确，但 dot/dash 的铺放范围（x1/y1 的超出量 bw/dashLen）
//   未针对圆角做收缩，角落可能出现多余的点/段，待后续重构。

/**
 * 沿水平线段绘制 dotted 圆点序列。
 * 从 x0+r 开始，步长 = 2*r + gapLen，直到圆心+r 超出 x1。
 */
function dotLine({ doc, x0, x1, yMid, r, gapLen }) {
  const step = 2 * r + gapLen;
  let cx = x0 + r;

  while (cx + r <= x1 + 1e-6) {
    doc.ellipse(cx, yMid, r, r, 'F');
    cx += step;
  }
}

/**
 * 沿竖直线段绘制 dotted 圆点序列。
 * 从 y0+r 开始，步长 = 2*r + gapLen，直到圆心+r 超出 y1。
 */
function dotLineV({ doc, xMid, y0, y1, r, gapLen }) {
  const step = 2 * r + gapLen;
  let cy = y0 + r;

  while (cy + r <= y1 + 1e-6) {
    doc.ellipse(xMid, cy, r, r, 'F');
    cy += step;
  }
}

/**
 * 沿水平线段绘制 dashed 矩形序列。
 * dashLen/gapLen 由调用方按"两端固定+中间均分"算法预先计算传入（dashLen:gapLen = 2:1）。
 * 从 x0 铺到 x1，clip 梯形负责截断角落。
 */
function dashLine({ doc, x0, x1, yMid, bw, dashLen, gapLen }) {
  const step = dashLen + gapLen;
  let cx = x0;

  while (cx + dashLen <= x1 + 1e-6) {
    doc.rect(cx, yMid - bw / 2, dashLen, bw, 'F');
    cx += step;
  }
}

/**
 * 沿竖直线段绘制 dashed 矩形序列。
 * dashLen/gapLen 由调用方按"两端固定+中间均分"算法预先计算传入（dashLen:gapLen = 2:1）。
 */
function dashLineV({ doc, xMid, y0, y1, bw, dashLen, gapLen }) {
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
 * dotted       → 梯形 clip + 圆点序列（dot:gap = 1:1，两端固定+中间均分）
 * dashed       → 梯形 clip + 矩形序列（dashLen:gapLen = 2:1，两端固定+中间均分）
 *
 * @param {string} dir      - 'top' | 'right' | 'bottom' | 'left'
 * @param {number} bwPx     - border-width（px，原始值，由 parsePx 返回）
 * @param {string} colorStr - CSS color 字符串
 * @param {string} bStyle   - border-style
 * @param {Object} sides    - 四边信息 { top, right, bottom, left }，每项含 bwPx
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

  if (bStyle === 'dotted' || bStyle === 'dashed') {
    doc.setFillColor(c[0], c[1], c[2]);

    // 用该边的梯形路径做 clip，确保 dash/dot 不超出本边区域（角落精确裁剪）
    doc.saveGraphicsState();
    buildSidePath({ doc, x, y, w, h, dir, bw, bt, bb, bl, br, r });
    doc.clip();
    doc.discardPath();

    if (bStyle === 'dotted') {
      const dotR = bw / 2;
      const isH = dir === 'top' || dir === 'bottom';
      // 仿 dashed 框架：两端各固定一个 dot（被角 clip 截断），中间均分
      // dot:gap = 1:1，step = 2*bw → nMid = round(outerLen/(2*bw)) - 2
      // 固定 nMid 后均分 gapLen = (outerLen - (nMid+2)*bw) / (nMid+1)
      const outerLen = isH ? w : h;
      const nMid = Math.max(0, Math.round(outerLen / (2.0 * bw)) - 2);
      const gapLen = (outerLen - (nMid + 2) * bw) / (nMid + 1);

      // 方向查找表：避免重复 if/else，每项返回对应方向的绘制调用
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
    } else {
      const isH = dir === 'top' || dir === 'bottom';
      // 浏览器算法：dashLen:gapLen = 2:1，两端固定 + 中间均分
      // gapLen*(3*nMid+5) = outerLen，nMid = round(outerLen/(3*bw)) - 2
      const outerLen = isH ? w : h;
      const nMid = Math.max(0, Math.round(outerLen / (3 * bw)) - 2);
      const gapLen = outerLen / (3 * nMid + 5);
      const dashLen = 2 * gapLen;

      // 方向查找表：避免重复 if/else，每项返回对应方向的绘制调用
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
    }

    doc.restoreGraphicsState();

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
