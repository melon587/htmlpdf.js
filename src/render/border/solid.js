/**
 * solid.js — solid border 绘制
 *
 * 浏览器模型：每条边是独立的填充梯形，角落精确拼合，无重叠。
 * 有 radius 时走圆角弧形路径，无 radius（全为 0）时走直角斜切路径。
 * 两者共用同一套 build*BorderPath 函数（r 全 0 时弧形退化为直角）。
 */

import { appendArcSegment } from '../radius';

const PI = Math.PI;

// ─── 梯形路径构建 ────────────────────────────────────────────────────────────

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

function buildBottomBorderPath({ doc, x, y, w, h, bb, bl, br, r }) {
  const { br: rbr, bl: rbl } = r;

  if (rbl > 0) {
    const cxBL = x + rbl;
    const cyBL = y + h - rbl;
    const sBL = PI / 2 + Math.atan2(bb, bl);
    const innerBL = Math.max(rbl - Math.max(bb, bl), 0);

    if (innerBL > 0) {
      doc.moveTo(
        cxBL + innerBL * Math.cos(sBL),
        cyBL + innerBL * Math.sin(sBL),
      );
      appendArcSegment(doc, cxBL, cyBL, innerBL, sBL, PI / 2);
    } else {
      doc.moveTo(x + bl, y + h - bb);
    }
  } else {
    doc.moveTo(x + bl, y + h - bb);
  }

  if (rbr > 0) {
    const cxBR = x + w - rbr;
    const cyBR = y + h - rbr;
    const sBR = Math.atan2(br, bb);
    const innerBR = Math.max(rbr - Math.max(bb, br), 0);

    if (innerBR > 0) {
      doc.lineTo(cxBR, cyBR + innerBR);
      appendArcSegment(doc, cxBR, cyBR, innerBR, PI / 2, sBR);
      doc.lineTo(cxBR + rbr * Math.cos(sBR), cyBR + rbr * Math.sin(sBR));
    } else {
      doc.lineTo(x + w - br, y + h - bb);
      doc.lineTo(cxBR + rbr * Math.cos(sBR), cyBR + rbr * Math.sin(sBR));
    }

    appendArcSegment(doc, cxBR, cyBR, rbr, sBR, PI / 2);
  } else {
    doc.lineTo(x + w - br, y + h - bb);
    doc.lineTo(x + w, y + h);
  }

  doc.lineTo(x + rbl, y + h);

  if (rbl > 0) {
    const cxBL = x + rbl;
    const cyBL = y + h - rbl;
    const sBL = PI / 2 + Math.atan2(bb, bl);
    appendArcSegment(doc, cxBL, cyBL, rbl, PI / 2, sBL);
  }

  doc.close();
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

// ─── 公共：构建指定方向的梯形路径 ────────────────────────────────────────────

/**
 * 构建指定方向的梯形路径（close，不 fill）。
 * 用于 dashed/dotted 的 clip 区域，也供 solid/double 内部使用。
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

// ─── 单层 fill（offset 用于 double 的外/内线） ───────────────────────────────

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

  doc.setFillColor(c[0], c[1], c[2]);

  if (dir === 'top') {
    buildTopBorderPath({
      doc,
      x: ox,
      y: oy,
      w: ow,
      bt: bw,
      bl,
      br,
      r: or,
    });
  } else if (dir === 'bottom') {
    buildBottomBorderPath({
      doc,
      x: ox,
      y: oy,
      w: ow,
      h: oh,
      bb: bw,
      bl,
      br,
      r: or,
    });
  } else if (dir === 'left') {
    buildLeftBorderPath({
      doc,
      x: ox,
      y: oy,
      h: oh,
      bt,
      bb,
      bl: bw,
      r: or,
    });
  } else {
    buildRightBorderPath({
      doc,
      x: ox,
      y: oy,
      w: ow,
      h: oh,
      bt,
      bb,
      brW: bw,
      r: or,
    });
  }

  doc.fill();
}

// ─── 导出 ────────────────────────────────────────────────────────────────────

/**
 * 绘制 solid 单边。radius 全为 0 时等同于直角梯形。
 */
function drawSolidBorder({ doc, x, y, w, h, r, dir, bw, bt, bb, bl, br, c }) {
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

export { drawSolidBorder, buildSidePath, fillOneSideLayer };
