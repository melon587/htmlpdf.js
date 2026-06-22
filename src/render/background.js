import { parseColor, parseBgSizeVal, parseBgPosVal } from '../utils';

/**
 * 根据 backgroundSize / 元素尺寸 / 图片原始尺寸，计算实际渲染的 imgW/imgH（单位 mm）
 */
function calcBgImageSize({ bgSize, elW, elH, natW, natH }) {
  const parts = (bgSize || 'auto').trim().split(/\s+/);
  const sx = parts[0];
  const sy = parts[1] ?? sx;

  if (sx === 'cover') {
    const scale = Math.max(elW / natW, elH / natH);

    return { imgW: natW * scale, imgH: natH * scale };
  }

  if (sx === 'contain') {
    const scale = Math.min(elW / natW, elH / natH);

    return { imgW: natW * scale, imgH: natH * scale };
  }

  return {
    imgW: parseBgSizeVal(sx, elW, natW, natH),
    imgH: parseBgSizeVal(sy, elH, natH, natW),
  };
}

/**
 * 根据 backgroundPosition 计算图片左上角偏移（单位 mm）
 */
function calcBgImagePos({ bgPos, elW, elH, imgW, imgH }) {
  const parts = (bgPos || '50% 50%').trim().split(/\s+/);
  const px = parts[0] ?? '50%';
  const py = parts[1] ?? '50%';

  return {
    offX: parseBgPosVal(px, elW, imgW),
    offY: parseBgPosVal(py, elH, imgH),
  };
}

/**
 * 绘制背景色和背景图
 * clipTop/clipBottom（mm）：当前页可见范围，用于跨页裁剪，只绘制节点与当前页交叉的区域
 */
function drawBackground({ doc, node, ctx, clipTop, clipBottom }) {
  const { style } = node;
  const nodeTop = ctx.toMM(node.y);
  const nodeBottom = ctx.toMM(node.y + node.height);

  const drawTop = Math.max(nodeTop, clipTop);
  const drawBottom = Math.min(nodeBottom, clipBottom);
  if (drawBottom <= drawTop) return;

  const x = ctx.toPdfX(node.x);
  const y = ctx.toPdfYmm(drawTop);
  const w = ctx.toMM(node.width);
  const h = drawBottom - drawTop;

  // 1. 先画背景色
  const color = parseColor(style.backgroundColor);
  if (color) {
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(x, y, w, h, 'F');
  }

  // 2. 再画背景图（叠加在背景色上）
  if (node.bgSrc) {
    const elW = ctx.toMM(node.width);
    const elH = ctx.toMM(node.height);
    const natW = node.bgNaturalWidth;
    const natH = node.bgNaturalHeight;

    if (natW > 0 && natH > 0) {
      const { imgW, imgH } = calcBgImageSize({
        bgSize: style.backgroundSize,
        elW,
        elH,
        natW,
        natH,
      });
      const { offX, offY } = calcBgImagePos({
        bgPos: style.backgroundPosition,
        elW,
        elH,
        imgW,
        imgH,
      });

      // 背景图左上角：基于节点原始顶部（nodeTop），跨页时可能在当前页之上
      const imgX = ctx.toPdfX(node.x) + offX;
      const imgY = ctx.toPdfYmm(nodeTop + offY);

      try {
        // 用裁剪区域限制背景图只在当前页可见范围内绘制，防止跨页溢出
        // style=null：putStyle(null) 直接 return，只建路径不执行 stroke/fill，
        // 避免 style=undefined 时走 defaultPathOperation="S" 产生意外描边
        doc.saveGraphicsState();
        doc.rect(x, y, w, h, null);
        doc.clip();
        doc.discardPath();
        doc.addImage(
          node.bgSrc,
          node.bgFormat || 'JPEG',
          imgX,
          imgY,
          imgW,
          imgH,
        );
        doc.restoreGraphicsState();
      } catch (e) {
        console.warn('[htmlpdf] bgImage addImage failed:', e);
      }
    }
  }
}

export { drawBackground };
