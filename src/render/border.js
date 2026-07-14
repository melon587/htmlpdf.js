import { parsePx, parseColor } from '../utils';

/**
 * 解析 CSS border 简写字符串，例如 '1px solid #d9d9d9' 或 '1px solid rgb(200,200,200)'
 * 返回 { bw, color } 或 null
 */
function parseBorderString(borderStr) {
  if (!borderStr) return null;

  // 提取宽度（第一个数字+px）
  const widthMatch = borderStr.match(/(\d+(?:\.\d+)?)\s*px/);
  if (!widthMatch) return null;

  const bw = parseFloat(widthMatch[1]);
  if (bw <= 0) return null;

  // 提取颜色：先尝试 rgb/rgba，再尝试 #hex
  const rgbMatch = borderStr.match(/rgba?\([^)]+\)/);
  const colorStr = rgbMatch
    ? rgbMatch[0]
    : (borderStr.match(/#[0-9a-fA-F]{3,8}\b/) || [])[0];
  const color = parseColor(colorStr);
  if (!color) return null;

  return { bw, color };
}

/**
 * 绘制边框（跨页裁剪）
 * - isFirstPage（nodeTop >= 0）→ 画 top border
 * - isLastPage（isLastSpill 且节点底部在页内）→ 画 bottom border
 * - left/right 每页都画（中间 spill 页延伸到整页高度）
 * @param {boolean} isLastSpill - false 表示中间 spill 页，不画 bottom border
 */
function drawBorder({ node, ctx, clipBottom, isLastSpill = true }) {
  const { doc, toMM, toPdfX, toPdfYmm } = ctx;
  const { style } = node;
  const nodeTop = toMM(node.y);
  const nodeBottom = toMM(node.y + node.height);

  const x = toPdfX(node.x);
  const w = toMM(node.width);

  // clipTop 固定为 0（页面顶部），背景/边框从页面顶部开始
  const drawTop = Math.max(nodeTop, 0);
  const drawBottom = Math.min(nodeBottom, clipBottom);
  if (drawBottom <= drawTop) return;

  const yTop = toPdfYmm(drawTop);
  const yBottom = toPdfYmm(drawBottom);
  // nodeTop >= 0：节点顶部在当前页内，即本页是节点的第一页
  const isFirstPage = nodeTop >= 0;
  // isLastSpill=false 说明是中间 spill 页，不能画 bottom border
  const isLastPage = isLastSpill && nodeBottom <= clipBottom;
  // 中间 spill 页：左右边框延伸到整页高度；最后一页：到节点实际底部
  const leftRightBottom = isLastSpill ? yBottom : toPdfYmm(clipBottom);

  const sides = [
    {
      bw: parsePx(style.borderTopWidth),
      color: style.borderTopColor,
      borderStyle: style.borderTopStyle,
      side: 'top',
    },
    {
      bw: parsePx(style.borderRightWidth),
      color: style.borderRightColor,
      borderStyle: style.borderRightStyle,
      side: 'right',
    },
    {
      bw: parsePx(style.borderBottomWidth),
      color: style.borderBottomColor,
      borderStyle: style.borderBottomStyle,
      side: 'bottom',
    },
    {
      bw: parsePx(style.borderLeftWidth),
      color: style.borderLeftColor,
      borderStyle: style.borderLeftStyle,
      side: 'left',
    },
  ];

  for (const { bw, color, borderStyle, side } of sides) {
    // CSS 规范：border-style: none / hidden 时不渲染，无论 border-width 是多少
    if (!borderStyle || borderStyle === 'none' || borderStyle === 'hidden')
      continue;

    if (bw <= 0) continue;

    const c = parseColor(color);
    if (!c) continue;

    doc.setDrawColor(c[0], c[1], c[2]);
    doc.setLineWidth(toMM(bw));

    if (side === 'top') {
      if (isFirstPage) doc.line(x, yTop, x + w, yTop);
    } else if (side === 'bottom') {
      if (isLastPage) doc.line(x, yBottom, x + w, yBottom);
    } else if (side === 'left') {
      doc.line(x, yTop, x, leftRightBottom);
    } else {
      doc.line(x + w, yTop, x + w, leftRightBottom);
    }
  }
}

/**
 * 在表格跨页截断处画出口闭合线（贴着当前页最后一行 TR 底部），所有节点渲染完后调用。
 * @param {string} pageBreakBorder - CSS border 简写，如 '1px solid #d9d9d9'
 * @param {number} clipBottom      - 出口线位置（mm，相对页面内容区顶部）
 */
function drawSpillClosingLines({ node, ctx, clipBottom, pageBreakBorder }) {
  const { doc, toMM, toPdfX, toPdfYmm } = ctx;
  const fb = parseBorderString(pageBreakBorder);
  if (!fb) return;

  const x = toPdfX(node.x);
  const w = toMM(node.width);

  doc.setDrawColor(fb.color[0], fb.color[1], fb.color[2]);
  doc.setLineWidth(toMM(fb.bw));
  doc.line(x, toPdfYmm(clipBottom), x + w, toPdfYmm(clipBottom));
}

export { drawBorder, drawSpillClosingLines };
