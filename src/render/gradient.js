// gradient.js
// linear-gradient CSS 解析 + Canvas 渲染工具

import { canvasHasAlpha, canvasToDataUrl } from '../utils';

// ─── linear-gradient 解析 ────────────────────────────────────────────────────

/**
 * 将 CSS "to <side/corner>" 关键字转换为角度（deg）
 * CSS gradient 角度定义：0deg = to top，顺时针递增
 */
const DIRECTION_TO_DEG = {
  'to top': 0,
  'to top right': 45,
  'to right': 90,
  'to bottom right': 135,
  'to bottom': 180,
  'to bottom left': 225,
  'to left': 270,
  'to top left': 315,
};

/**
 * 解析单个 color-stop token，返回 { color, pos }
 * pos 为 0~1 的小数（来自百分比），或 null（未指定）
 *
 * 示例输入：
 *   "#1677ff 0%"  → { color: '#1677ff', pos: 0 }
 *   "rgba(0,0,0,0) 100%" → { color: 'rgba(0,0,0,0)', pos: 1 }
 *   "red"         → { color: 'red', pos: null }
 */
function parseColorStop(token) {
  const s = token.trim();

  // 尝试从末尾匹配 <percentage> 或 <length px>
  const posMatch = s.match(/\s+([\d.]+)(%|px)$/);
  let pos = null;
  let posPx = null;
  let colorStr = s;

  if (posMatch) {
    const val = parseFloat(posMatch[1]);
    if (posMatch[2] === '%') {
      pos = val / 100;
    } else {
      posPx = val; // px 值保留，待渲染时归一化
    }

    colorStr = s.slice(0, s.length - posMatch[0].length);
  }

  const color = colorStr.trim() || null;
  if (!color) return null;

  return { color, pos, posPx };
}

/**
 * 按顶层逗号拆分字符串（忽略括号内的逗号，如 rgba(0,0,0,0) 里的逗号）
 */
function splitTopLevelCommas(str) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;

    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);

  return parts;
}

/**
 * 补齐色标位置：
 * - posPx 非 null 的色标直接透传（px 值待渲染时归一化）
 * - 首个无 pos（且无 posPx）→ 0
 * - 末个无 pos（且无 posPx）→ 1
 * - 中间无 pos → 在前后已知 pos 之间均匀插值
 */
function fillStopPositions(stops) {
  const result = stops.map((s) => ({ ...s }));
  const n = result.length;

  // 找到第一个和最后一个 pct 色标（posPx 为 null 的），从两端线性扫描
  let firstPct = null;
  for (let i = 0; i < n; i += 1) {
    if (result[i].posPx === null) {
      firstPct = result[i];
      break;
    }
  }
  let lastPct = null;
  for (let i = n - 1; i >= 0; i -= 1) {
    if (result[i].posPx === null) {
      lastPct = result[i];
      break;
    }
  }

  if (firstPct && firstPct.pos === null) firstPct.pos = 0;

  if (lastPct && lastPct.pos === null) lastPct.pos = 1;

  let i = 0;
  while (i < n) {
    // posPx 色标或已有 pos 的色标：跳过
    if (result[i].posPx !== null || result[i].pos !== null) {
      i += 1;
      continue;
    }

    const prev = i - 1;
    let next = i + 1;
    while (
      next < n &&
      result[next].pos === null &&
      result[next].posPx === null
    ) {
      next += 1;
    }
    const prevPos = result[prev]?.pos ?? 0;
    const nextPos = result[next]?.pos ?? 1;
    const count = next - prev;
    for (let k = 1; k < count; k += 1) {
      result[prev + k].pos = prevPos + (nextPos - prevPos) * (k / count);
    }
    i = next;
  }

  return result;
}

function parseLinearGradientInner(inner) {
  if (!inner) return null;

  const parts = splitTopLevelCommas(inner);
  if (parts.length < 2) return null;

  let angle = 180; // 默认 to bottom
  let stopStart = 0;

  const first = parts[0].trim();

  if (/^to\s+/i.test(first)) {
    const key = first.toLowerCase().replace(/\s+/g, ' ');
    angle = DIRECTION_TO_DEG[key] ?? 180;
    stopStart = 1;
  } else if (/^-?[\d.]+deg$/i.test(first)) {
    angle = parseFloat(first);
    stopStart = 1;
  } else if (/^-?[\d.]+turn$/i.test(first)) {
    angle = parseFloat(first) * 360;
    stopStart = 1;
  }

  const rawStops = parts.slice(stopStart).map(parseColorStop).filter(Boolean);
  if (rawStops.length < 2) return null;

  return { angle, stops: fillStopPositions(rawStops) };
}

/**
 * 解析 CSS linear-gradient() 字符串
 *
 * @param {string} str - 完整的 backgroundImage 值，如
 *   "linear-gradient(135deg, #f00 0%, #00f 100%)"
 *   "linear-gradient(to right, red, blue)"
 *   "linear-gradient(red, blue)"
 * @returns {{ angle: number, stops: Array<{color:string, pos:number}> } | null}
 */
function parseLinearGradient(str) {
  if (!str || !str.includes('linear-gradient')) return null;

  // trim 消除末尾空白，避免正则 $ 锚点匹配失败
  const s = str.trim();

  const fnMatch = s.match(
    /linear-gradient\s*\((.+)\)\s*(?:,\s*linear-gradient|$)/s,
  );
  if (!fnMatch) {
    return parseLinearGradientInner(
      s.match(/linear-gradient\s*\((.+)\)$/s)?.[1],
    );
  }

  return parseLinearGradientInner(fnMatch[1]);
}

// ─── 渐变绘制到 Canvas ────────────────────────────────────────────────────────

/**
 * 将 CSS gradient 角度（0deg=to top，顺时针）转为 Canvas createLinearGradient 的两端点坐标
 *
 * 渐变线长度公式（CSS 规范）：|W·sin(a)| + |H·cos(a)|
 */
function gradientEndPoints(w, h, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const len = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
  const halfLen = len / 2;

  return {
    x0: cx - Math.sin(a) * halfLen,
    y0: cy + Math.cos(a) * halfLen,
    x1: cx + Math.sin(a) * halfLen,
    y1: cy - Math.cos(a) * halfLen,
    len,
  };
}

/**
 * 将渐变直接绘制到当前页片段大小的 canvas 并返回 { dataUrl, format }
 *
 * 优化：只创建 natW × srcH 的 canvas（当前页片段），而非 natW × natH 的完整节点 canvas，
 * 省去先绘制整个节点再裁切的额外内存开销。
 *
 * 原理：渐变端点坐标依据完整节点尺寸（natW × natH）计算，保证方向/比例与 CSS 一致；
 * 绘制前将 canvas 坐标系向上平移 srcY，使渐变在片段内的位置与完整节点对齐。
 *
 * 格式选择：绘制后用 canvasHasAlpha 检测，有透明像素用 PNG，否则用 JPEG（体积更小）
 *
 * @param {object} params
 * @param {object} params.gradient - parseLinearGradient 返回的结果 { angle, stops }
 * @param {number} params.natW     - 节点完整宽度（px）
 * @param {number} params.natH     - 节点完整高度（px）
 * @param {number} params.srcY     - 当前页片段在完整节点中的起始 y（px）
 * @param {number} params.srcH     - 当前页片段高度（px）
 * @returns {{ dataUrl: string, format: 'PNG' | 'JPEG' }}
 */
function renderGradientSlice({ gradient, natW, natH, srcY, srcH }) {
  const { angle, repeating } = gradient;
  const { x0, y0, x1, y1, len: gradLen } = gradientEndPoints(natW, natH, angle);

  const stops = repeating
    ? expandRepeatingStops(gradient.stops, gradLen)
    : gradient.stops;

  const canvas = document.createElement('canvas');
  canvas.width = natW;
  canvas.height = srcH;
  const ctx2d = canvas.getContext('2d');

  // 向上平移 srcY：让渐变坐标系的原点对齐完整节点顶部
  ctx2d.translate(0, -srcY);

  const grad = ctx2d.createLinearGradient(x0, y0, x1, y1);
  for (const stop of stops) {
    grad.addColorStop(Math.max(0, Math.min(1, stop.pos)), stop.color);
  }
  ctx2d.fillStyle = grad;
  ctx2d.fillRect(0, srcY, natW, srcH);

  const hasAlpha = canvasHasAlpha(canvas);
  const format = hasAlpha ? 'PNG' : 'JPEG';
  const dataUrl = canvasToDataUrl(canvas, hasAlpha);

  return { dataUrl, format };
}

// ─── radial-gradient 解析 ────────────────────────────────────────────────────

/**
 * 解析 CSS radial-gradient() 字符串
 *
 * 支持子集：
 *   - 可选 shape / size 关键字（忽略，按 ellipse 处理）
 *   - "at <x> <y>"（百分比或关键字）指定圆心，默认 50% 50%
 *   - 色标（颜色 + 可选百分比位置）
 *
 * @param {string} str
 * @returns {{ cx: number, cy: number, stops: Array } | null}
 *   cx/cy 为 0~1 的比例值，stops 同 linear-gradient
 */
function parseRadialGradient(str) {
  if (!str || !str.includes('radial-gradient')) return null;

  const fnMatch = str.trim().match(/radial-gradient\s*\((.+)\)$/s);
  if (!fnMatch) return null;

  const inner = fnMatch[1];
  const parts = splitTopLevelCommas(inner);
  if (parts.length < 2) return null;

  let cx = 0.5;
  let cy = 0.5;
  let shape = 'ellipse'; // 默认 ellipse
  let stopStart = 0;

  // 第一个 token 可能是 shape/size/position 描述，或直接是色标颜色
  const first = parts[0].trim().toLowerCase();
  const hasDescriptor =
    /^(circle|ellipse|closest|farthest|contain|cover|at\s)/i.test(first) ||
    /\bat\b/.test(first);

  if (hasDescriptor) {
    stopStart = 1;
    if (/\bcircle\b/.test(first)) shape = 'circle';

    // 提取 "at <x> <y>"
    const atMatch = first.match(/at\s+([\w.%]+)(?:\s+([\w.%]+))?/);

    if (atMatch) {
      cx = parsePosToken(atMatch[1]);
      cy = parsePosToken(atMatch[2] ?? atMatch[1]);
    }
  }

  const rawStops = parts.slice(stopStart).map(parseColorStop).filter(Boolean);
  if (rawStops.length < 2) return null;

  return { cx, cy, shape, stops: fillStopPositions(rawStops) };
}

/**
 * 将位置关键字 / 百分比 / px 转换为 0~1 比例
 */
function parsePosToken(tok) {
  if (!tok) return 0.5;

  const t = tok.trim().toLowerCase();

  if (t === 'left' || t === 'top') return 0;

  if (t === 'right' || t === 'bottom') return 1;

  if (t === 'center') return 0.5;

  if (t.endsWith('%')) return parseFloat(t) / 100;

  // px：先按 50% 兜底（运行时无宽高信息）
  return 0.5;
}

/**
 * 将 radial-gradient 绘制到 canvas 并返回 { dataUrl, format }
 *
 * 模拟浏览器默认的 ellipse 行为：
 *   将坐标系缩放到正方形（scale(1, natW/natH)），在正方形里画
 *   "farthest-corner 圆形"渐变，再通过逆 scale 还原为椭圆。
 *   这样 X/Y 半径之比 = natW/natH，与 CSS ellipse 默认行为一致。
 *
 * @param {object} params
 * @param {object} params.gradient  parseRadialGradient 返回结果
 * @param {number} params.natW      节点完整宽度（px）
 * @param {number} params.natH      节点完整高度（px）
 * @param {number} params.srcY      当前页片段起始 y（px）
 * @param {number} params.srcH      当前页片段高度（px）
 * @returns {{ dataUrl: string, format: 'PNG' | 'JPEG' }}
 */
function renderRadialGradientSlice({ gradient, natW, natH, srcY, srcH }) {
  const { cx, cy, shape, repeating } = gradient;

  const canvas = document.createElement('canvas');
  canvas.width = natW;
  canvas.height = srcH;
  const ctx2d = canvas.getContext('2d');

  // 跨页偏移：让渐变坐标系原点对齐完整节点顶部
  ctx2d.translate(0, -srcY);

  // circle: scaleY=1（正圆，无缩放）
  // ellipse: scaleY = natW/natH（在 Y 轴归一化坐标系里画圆，还原为椭圆）
  const scaleY = shape === 'circle' ? 1 : natH > 0 ? natW / natH : 1;
  ctx2d.scale(1, 1 / scaleY);

  // 归一化坐标（Y 轴已缩放）
  const centerX = cx * natW;
  const centerY = cy * natH * scaleY;

  // farthest-corner 半径（在归一化空间里取四角距离最大值）
  const corners = [
    [0, 0],
    [natW, 0],
    [0, natH * scaleY],
    [natW, natH * scaleY],
  ];
  const radius = Math.max(
    ...corners.map(([px, py]) =>
      Math.sqrt((px - centerX) ** 2 + (py - centerY) ** 2),
    ),
  );

  // repeating 变体：在知道半径后展开色标
  const stops = repeating
    ? expandRepeatingStops(gradient.stops, radius)
    : gradient.stops;

  const grad = ctx2d.createRadialGradient(
    centerX,
    centerY,
    0,
    centerX,
    centerY,
    radius,
  );

  for (const stop of stops) {
    grad.addColorStop(Math.max(0, Math.min(1, stop.pos)), stop.color);
  }

  ctx2d.fillStyle = grad;
  ctx2d.fillRect(0, srcY * scaleY, natW, srcH * scaleY);

  const hasAlpha = canvasHasAlpha(canvas);
  const format = hasAlpha ? 'PNG' : 'JPEG';
  const dataUrl = canvasToDataUrl(canvas, hasAlpha);

  return { dataUrl, format };
}

// ─── repeating gradient 色标展开 ─────────────────────────────────────────────

/**
 * 将 repeating gradient 的色标沿 0~1 展开为完整色标序列
 *
 * @param {Array<{color,pos,posPx}>} stops
 * @param {number} gradientLength - 渐变线长度（px），用于将 posPx 归一化
 * @returns {Array<{color, pos}>} 展开后的色标（覆盖 0~1）
 */
function expandRepeatingStops(stops, gradientLength) {
  // 将每个 stop 转为 0~1 位置（优先 pos，否则 posPx/gradientLength）
  const normalized = stops.map((s) => ({
    color: s.color,
    pos:
      s.pos !== null
        ? s.pos
        : gradientLength > 0
          ? s.posPx / gradientLength
          : 0,
  }));

  const tileSize = normalized[normalized.length - 1].pos;

  // tileSize <= 0 或 >= 1 则无需重复
  if (!tileSize || tileSize >= 1) return normalized;

  const result = [];
  let offset = 0;

  while (offset <= 1) {
    for (const s of normalized) {
      const pos = s.pos + offset;
      if (pos > 1 + 1e-6) break;

      result.push({ color: s.color, pos: Math.min(pos, 1) });
    }

    offset += tileSize;
  }

  return result;
}

/**
 * 解析 CSS repeating-linear-gradient() 字符串
 * 返回带 repeating:true 标记的对象；色标展开推迟到渲染层（需要渐变线长度）
 */
function parseRepeatingLinearGradient(str) {
  if (!str || !str.includes('repeating-linear-gradient')) return null;

  const replaced = str.replace(/repeating-linear-gradient/g, 'linear-gradient');
  const parsed = parseLinearGradient(replaced);
  if (!parsed) return null;

  return { ...parsed, repeating: true };
}

/**
 * 解析 CSS repeating-radial-gradient() 字符串
 * 返回带 repeating:true 标记的对象；色标展开推迟到渲染层（需要半径长度）
 */
function parseRepeatingRadialGradient(str) {
  if (!str || !str.includes('repeating-radial-gradient')) return null;

  const replaced = str.replace(/repeating-radial-gradient/g, 'radial-gradient');
  const parsed = parseRadialGradient(replaced);
  if (!parsed) return null;

  return { ...parsed, repeating: true };
}

export {
  parseLinearGradient,
  renderGradientSlice,
  parseRadialGradient,
  renderRadialGradientSlice,
  parseRepeatingLinearGradient,
  parseRepeatingRadialGradient,
  expandRepeatingStops,
};
