import { parsePx } from '../utils';

/**
 * 贝塞尔圆弧近似系数 K = 4/3*(√2-1) ≈ 0.5523
 * 用于将圆角 arc 近似为三次贝塞尔曲线
 */
export const ARC_K = (4 / 3) * (Math.SQRT2 - 1);

/**
 * 解析四角圆角半径（px → mm），并 clamp 到 w/2, h/2
 * @param {Object} style  - node.style
 * @param {Function} toMM - ctx.toMM
 * @param {number} w      - 节点宽度（mm）
 * @param {number} h      - 节点高度（mm）
 * @returns {{ tl, tr, br, bl }} 单位 mm
 */
export function parseRadius({ style, toMM, w, h }) {
  const maxR = Math.min(w / 2, h / 2);
  const clamp = (v) => Math.min(Math.max(v, 0), maxR);

  return {
    tl: clamp(toMM(parsePx(style.borderTopLeftRadius))),
    tr: clamp(toMM(parsePx(style.borderTopRightRadius))),
    br: clamp(toMM(parsePx(style.borderBottomRightRadius))),
    bl: clamp(toMM(parsePx(style.borderBottomLeftRadius))),
  };
}

/**
 * 判断四角半径是否存在非零值
 */
export function hasRadius({ tl, tr, br, bl }) {
  return tl > 0 || tr > 0 || br > 0 || bl > 0;
}

// ─── 内部贝塞尔 arc 辅助 ─────────────────────────────────────────────────────

/** 右上角 arc（从顶边末端顺时针到右边起点） */
function arcTopRight({ doc, x, y, w, tr }) {
  if (tr <= 0) return;

  doc.curveTo(
    x + w - tr + tr * ARC_K,
    y,
    x + w,
    y + tr - tr * ARC_K,
    x + w,
    y + tr,
  );
}

/** 右下角 arc（从右边末端顺时针到底边末端） */
function arcBottomRight({ doc, x, y, w, h, br }) {
  if (br <= 0) return;

  doc.curveTo(
    x + w,
    y + h - br + br * ARC_K,
    x + w - br + br * ARC_K,
    y + h,
    x + w - br,
    y + h,
  );
}

/** 左下角 arc（从底边末端顺时针到左边起点） */
function arcBottomLeft({ doc, x, y, h, bl }) {
  if (bl <= 0) return;

  doc.curveTo(
    x + bl - bl * ARC_K,
    y + h,
    x,
    y + h - bl + bl * ARC_K,
    x,
    y + h - bl,
  );
}

/** 左上角 arc（从左边末端顺时针到顶边起点） */
function arcTopLeft({ doc, x, y, tl }) {
  if (tl <= 0) return;

  doc.curveTo(x, y + tl - tl * ARC_K, x + tl - tl * ARC_K, y, x + tl, y);
}

// ─── 完整路径 ────────────────────────────────────────────────────────────────

/**
 * 在 jsPDF doc 上建立一条顺时针圆角矩形路径（不 stroke/fill）
 * 支持四角独立半径，使用贝塞尔曲线近似 arc。
 * 适用于单页节点（首页即末页）。
 *
 * @param {Object} doc           - jsPDF 实例
 * @param {number} x             - 矩形左上角 X（mm）
 * @param {number} y             - 矩形左上角 Y（mm）
 * @param {number} w             - 宽度（mm）
 * @param {number} h             - 高度（mm）
 * @param {{ tl, tr, br, bl }} r - 四角半径（mm）
 */
export function addRoundedRectPath({ doc, x, y, w, h, r }) {
  const { tl, tr, br, bl } = r;

  doc.moveTo(x + tl, y);
  doc.lineTo(x + w - tr, y);
  arcTopRight({ doc, x, y, w, tr });
  doc.lineTo(x + w, y + h - br);
  arcBottomRight({ doc, x, y, w, h, br });
  doc.lineTo(x + bl, y + h);
  arcBottomLeft({ doc, x, y, h, bl });
  doc.lineTo(x, y + tl);
  arcTopLeft({ doc, x, y, tl });
  doc.close();
}

// ─── 跨页分段路径 ────────────────────────────────────────────────────────────

/**
 * 首页分段路径：包含 top 圆角，底部为直边（被分页线截断）
 *
 * 形状（顺时针）：
 *   tl╮─────────────╭tr
 *     │             │
 *     └─────────────┘  ← 底部直线（yTop + segH）
 *
 * @param {Object} doc   - jsPDF 实例
 * @param {number} x     - 片段左上角 X（mm）
 * @param {number} y     - 片段左上角 Y（mm，即 yTop）
 * @param {number} w     - 宽度（mm）
 * @param {number} segH  - 本页片段高度（mm）
 * @param {{ tl, tr }} r - 仅用 tl/tr
 */
export function addFirstPagePath({ doc, x, y, w, segH, r }) {
  const { tl, tr } = r;

  doc.moveTo(x + tl, y);
  doc.lineTo(x + w - tr, y);
  arcTopRight({ doc, x, y, w, tr });
  doc.lineTo(x + w, y + segH);
  doc.lineTo(x, y + segH);
  doc.lineTo(x, y + tl);
  arcTopLeft({ doc, x, y, tl });
  doc.close();
}

/**
 * 末页分段路径：top 为直边，包含 bottom 圆角
 *
 * 形状（顺时针）：
 *     ┌─────────────┐  ← 顶部直线（yTop）
 *     │             │
 *   bl╯─────────────╰br
 *
 * @param {Object} doc   - jsPDF 实例
 * @param {number} x     - 片段左上角 X（mm）
 * @param {number} y     - 片段左上角 Y（mm，即 yTop）
 * @param {number} w     - 宽度（mm）
 * @param {number} segH  - 本页片段高度（mm）
 * @param {{ br, bl }} r - 仅用 br/bl
 */
export function addLastPagePath({ doc, x, y, w, segH, r }) {
  const { br, bl } = r;

  doc.moveTo(x, y);
  doc.lineTo(x + w, y);
  doc.lineTo(x + w, y + segH - br);
  arcBottomRight({ doc, x, y, w, h: segH, br });
  doc.lineTo(x + bl, y + segH);
  arcBottomLeft({ doc, x, y, h: segH, bl });
  doc.close();
}

// ─── border 描边专用分段路径（不含顶/底横线） ──────────────────────────────

/**
 * border 首页分段路径：tl/tr 圆角 + 左右竖线，底部截断（不画横线）。
 * cutY 是截断线的 Y 坐标（不加 off 偏移，保证竖线延伸到页面边缘）。
 */
export function addBorderFirstPagePath({ doc, x, y, w, cutY, r }) {
  const { tl, tr } = r;

  // 一条连续路径（逆时针）：左竖线从截断线 → tl 弧 → 顶边 → tr 弧 → 右竖线到截断线
  doc.moveTo(x, cutY);
  doc.lineTo(x, y + tl);
  arcTopLeft({ doc, x, y, tl });
  doc.lineTo(x + w - tr, y);
  arcTopRight({ doc, x, y, w, tr });
  doc.lineTo(x + w, cutY);
}

/**
 * border 末页分段路径：bl/br 圆角 + 左右竖线，顶部截断（不画横线）。
 * cutY 是截断线的 Y 坐标（不加 off 偏移，保证竖线延伸到页面边缘）。
 */
export function addBorderLastPagePath({ doc, x, y, w, segH, cutY, r }) {
  const { br, bl } = r;

  // 右竖线从截断线 → br 弧 → 底边 → bl 弧 → 左竖线到截断线
  doc.moveTo(x + w, cutY);
  doc.lineTo(x + w, y + segH - br);
  arcBottomRight({ doc, x, y, w, h: segH, br });
  doc.lineTo(x + bl, y + segH);
  arcBottomLeft({ doc, x, y, h: segH, bl });
  doc.lineTo(x, cutY);
}

// ─── fill 梯形模型专用弧段辅助 ───────────────────────────────────────────────
//
// 以下函数用于 border fill 模型（browser-accurate trapezoid fill）。
// 每个角由"外弧"（节点外轮廓圆角）和"内弧"（外弧半径 - border宽度）组成弧形梯形。
//
// 命名规则：
//   appendArcOuter*  — 顺时针追加外弧到当前路径（供 doc.curveTo 使用）
//   appendArcInner*  — 逆时针追加内弧到当前路径（闭合梯形内边）
//
// 注意：内弧半径 innerR = max(outerR - borderWidth, 0)。
//       当 borderWidth >= outerR 时，innerR = 0，内弧退化为一个点（直接 lineTo）。

/**
 * 右上角外弧（顺时针）：从顶边右端 → 右边上端
 * 起点：(x + w - tr, y)，终点：(x + w, y + tr)
 */
export function appendArcOuterTopRight({ doc, x, y, w, tr }) {
  if (tr <= 0) return;

  doc.curveTo(
    x + w - tr + tr * ARC_K,
    y,
    x + w,
    y + tr - tr * ARC_K,
    x + w,
    y + tr,
  );
}

/**
 * 右上角内弧（逆时针）：从右边上端内侧 → 顶边右端内侧
 * 起点：(x + w - bl_right, y + bt)，终点：(x + w - br, y + bt)
 * innerR = max(tr - borderWidth, 0)
 * 简化说明：此处 borderWidth 取 top-border 与 right-border 宽度中较大值来确定内弧半径。
 * 浏览器精确实现会对 top/right 各自计算内弧半径并在 45° 处分割，此处简化为统一内弧。
 * TODO: 如需完全对标浏览器，需按 CSS Backgrounds spec §4.3 对角落做精确的边宽比例分割。
 */
export function appendArcInnerTopRight({ doc, x, y, w, innerR }) {
  if (innerR <= 0) {
    // 内弧半径为零：角落退化为尖角点，路径当前点已在正确位置，无需额外操作
    return;
  }

  // 逆时针：从 (x+w-bl_right, y+innerR) → (x+w-innerR, y+bt)
  // 注意贝塞尔控制点方向与顺时针相反
  doc.curveTo(
    x + w,
    y + innerR - innerR * ARC_K,
    x + w - innerR + innerR * ARC_K,
    y,
    x + w - innerR,
    y,
  );
}

/**
 * 右下角外弧（顺时针）：从右边下端 → 底边右端
 * 起点：(x + w, y + h - br)，终点：(x + w - br, y + h)
 */
export function appendArcOuterBottomRight({ doc, x, y, w, h, br }) {
  if (br <= 0) return;

  doc.curveTo(
    x + w,
    y + h - br + br * ARC_K,
    x + w - br + br * ARC_K,
    y + h,
    x + w - br,
    y + h,
  );
}

/**
 * 右下角内弧（逆时针）：从底边右端内侧 → 右边下端内侧
 * innerR = max(br - borderWidth, 0)
 * 简化同 appendArcInnerTopRight 注释。
 */
export function appendArcInnerBottomRight({ doc, x, y, w, h, innerR }) {
  if (innerR <= 0) {
    return;
  }

  doc.curveTo(
    x + w - innerR + innerR * ARC_K,
    y + h,
    x + w,
    y + h - innerR - innerR * ARC_K,
    x + w,
    y + h - innerR,
  );
}

/**
 * 左下角外弧（顺时针）：从底边左端 → 左边下端
 * 起点：(x + bl, y + h)，终点：(x, y + h - bl)
 */
export function appendArcOuterBottomLeft({ doc, x, y, h, bl }) {
  if (bl <= 0) return;

  doc.curveTo(
    x + bl - bl * ARC_K,
    y + h,
    x,
    y + h - bl + bl * ARC_K,
    x,
    y + h - bl,
  );
}

/**
 * 左下角内弧（逆时针）：从左边下端内侧 → 底边左端内侧
 * innerR = max(bl - borderWidth, 0)
 * 简化同 appendArcInnerTopRight 注释。
 */
export function appendArcInnerBottomLeft({ doc, x, y, h, innerR }) {
  if (innerR <= 0) {
    return;
  }

  doc.curveTo(
    x,
    y + h - innerR + innerR * ARC_K,
    x + innerR - innerR * ARC_K,
    y + h,
    x + innerR,
    y + h,
  );
}

/**
 * 左上角外弧（顺时针）：从左边上端 → 顶边左端
 * 起点：(x, y + tl)，终点：(x + tl, y)
 */
export function appendArcOuterTopLeft({ doc, x, y, tl }) {
  if (tl <= 0) return;

  doc.curveTo(x, y + tl - tl * ARC_K, x + tl - tl * ARC_K, y, x + tl, y);
}

/**
 * 左上角内弧（逆时针）：从顶边左端内侧 → 左边上端内侧
 * innerR = max(tl - borderWidth, 0)
 * 简化同 appendArcInnerTopRight 注释。
 */
export function appendArcInnerTopLeft({ doc, x, y, innerR }) {
  if (innerR <= 0) {
    return;
  }

  doc.curveTo(
    x + innerR - innerR * ARC_K,
    y,
    x,
    y + innerR - innerR * ARC_K,
    x,
    y + innerR,
  );
}

// ─── border 梯形内弧（以外弧圆心为基准）────────────────────────────────────────
//
// 以下函数用于 border fill 梯形的内轮廓弧段。
// 与 appendArcInner* 不同：这里的圆心与外弧**完全相同**（即外轮廓圆角圆心），
// 半径缩小为 innerR。弧段走完整 90°（从一个轴方向到相邻轴方向），
// 端点落在内弧与两轴的切点上（不在内边线上，需调用方补连线到内边线）。
//
// 命名：borderArcInner<Corner><Dir>
//   Corner: TR/TL/BR/BL
//   Dir: 贝塞尔弧的走向（与外弧方向相反，均为逆时针）

/**
 * 右上角 border 内弧（逆时针，90°）：
 *   外弧圆心 (x+w-tr, y+tr)，内弧半径 innerR
 *   起点（3点方向）: (x+w-tr+innerR, y+tr)
 *   终点（12点方向）: (x+w-tr, y+tr-innerR)
 *
 * 调用前：当前点必须已在起点 (x+w-tr+innerR, y+tr)。
 */
export function borderArcInnerTR({ doc, x, y, w, tr, innerR }) {
  if (innerR <= 0) return;

  const cx = x + w - tr;
  const cy = y + tr;

  doc.curveTo(
    cx + innerR,
    cy - innerR * ARC_K,
    cx + innerR * ARC_K,
    cy - innerR,
    cx,
    cy - innerR,
  );
}

/**
 * 左上角 border 内弧（逆时针，90°）：
 *   外弧圆心 (x+tl, y+tl)，内弧半径 innerR
 *   起点（12点方向）: (x+tl, y+tl-innerR)
 *   终点（9点方向）: (x+tl-innerR, y+tl)
 *
 * 调用前：当前点必须已在起点 (x+tl, y+tl-innerR)。
 */
export function borderArcInnerTL({ doc, x, y, tl, innerR }) {
  if (innerR <= 0) return;

  const cx = x + tl;
  const cy = y + tl;

  doc.curveTo(
    cx - innerR * ARC_K,
    cy - innerR,
    cx - innerR,
    cy - innerR * ARC_K,
    cx - innerR,
    cy,
  );
}

/**
 * 右下角 border 内弧（逆时针，90°）：
 *   外弧圆心 (x+w-br, y+h-br)，内弧半径 innerR
 *   起点（6点方向）: (x+w-br, y+h-br+innerR)
 *   终点（3点方向）: (x+w-br+innerR, y+h-br)
 *
 * 调用前：当前点必须已在起点 (x+w-br, y+h-br+innerR)。
 */
export function borderArcInnerBR({ doc, x, y, w, h, br, innerR }) {
  if (innerR <= 0) return;

  const cx = x + w - br;
  const cy = y + h - br;

  doc.curveTo(
    cx + innerR * ARC_K,
    cy + innerR,
    cx + innerR,
    cy + innerR * ARC_K,
    cx + innerR,
    cy,
  );
}

/**
 * 左下角 border 内弧（逆时针，90°）：
 *   外弧圆心 (x+bl, y+h-bl)，内弧半径 innerR
 *   起点（9点方向）: (x+bl-innerR, y+h-bl)
 *   终点（6点方向）: (x+bl, y+h-bl+innerR)
 *
 * 调用前：当前点必须已在起点 (x+bl-innerR, y+h-bl)。
 */
export function borderArcInnerBL({ doc, x, y, h, bl, innerR }) {
  if (innerR <= 0) return;

  const cx = x + bl;
  const cy = y + h - bl;

  doc.curveTo(
    cx - innerR,
    cy + innerR * ARC_K,
    cx - innerR * ARC_K,
    cy + innerR,
    cx,
    cy + innerR,
  );
}

// ─── 通用弧段（任意圆心、半径、起止角）────────────────────────────────────────

/**
 * 在当前路径上追加一段圆弧（贝塞尔近似）。
 *
 * 坐标系：jsPDF，y 轴向下。
 * 角度约定：标准数学角（弧度），0 = 3点方向（右），逆时针为正。
 *   但因 y 轴向下，视觉上逆时针变顺时针。
 *   startRad → endRad 按角度增大方向走弧（视觉顺时针当 endRad > startRad）。
 *
 * 精度：单段贝塞尔最大误差 < 0.1% @ 90°。
 * 超过 90° 的弧段请分段调用（或本函数内自动分段）。
 *
 * 公式（Morgen 1986 贝塞尔圆弧近似）：
 *   k = 4/3 * tan(Δθ/4)
 *   cp1 = P0 + k * r * tangent(startRad)
 *   cp2 = P3 - k * r * tangent(endRad)
 *
 * @param {Object} doc      - jsPDF 实例（当前点必须已在弧起点）
 * @param {number} cx       - 圆心 X
 * @param {number} cy       - 圆心 Y
 * @param {number} r        - 半径
 * @param {number} startRad - 起始角（弧度）
 * @param {number} endRad   - 结束角（弧度）；endRad > startRad 为顺弧
 */
// eslint-disable-next-line max-params
export function appendArcSegment(doc, cx, cy, r, startRad, endRad) {
  if (r <= 0) return;

  const delta = endRad - startRad;

  // 超过 90° 时分成两段，保证精度
  if (Math.abs(delta) > Math.PI / 2 + 1e-9) {
    const mid = startRad + delta / 2;
    appendArcSegment(doc, cx, cy, r, startRad, mid);
    appendArcSegment(doc, cx, cy, r, mid, endRad);

    return;
  }

  const k = (4 / 3) * Math.tan(delta / 4);
  const cosS = Math.cos(startRad);
  const sinS = Math.sin(startRad);
  const cosE = Math.cos(endRad);
  const sinE = Math.sin(endRad);

  doc.curveTo(
    cx + r * (cosS - k * sinS),
    cy + r * (sinS + k * cosS),
    cx + r * (cosE + k * sinE),
    cy + r * (sinE - k * cosE),
    cx + r * cosE,
    cy + r * sinE,
  );
}
