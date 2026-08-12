/**
 * double.js — double border 绘制
 *
 * double = 外线（宽 bw/3，偏移 0）+ 内线（宽 bw/3，偏移 2*bw/3）
 * 中间留 bw/3 间隙，每条线各自是独立的 solid 梯形 fill。
 */

import { fillOneSideLayer } from './solid';

/**
 * 绘制 double 单边。
 */
function drawDoubleBorder({ doc, x, y, w, h, r, dir, bw, bt, bb, bl, br, c }) {
  // 外线
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

  // 内线
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
}

export { drawDoubleBorder };
