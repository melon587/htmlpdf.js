/**
 * Repeat-Header 管理器
 * tables 配置格式：[{ selector, repeatHeader, pageBreakBorder }]
 */

import { matchesSelector } from '../utils';

/**
 * 收集 repeat-header 元信息
 * @param {Array} nodes
 * @param {Array} tables - [{ selector, repeatHeader, pageBreakBorder }]
 */
function collectHeaderMetas(nodes, tables) {
  const headerMetas = [];

  for (const config of tables) {
    const { selector, repeatHeader } = config;

    // 只处理配置了 repeatHeader 的表格
    if (!repeatHeader) continue;

    // 找所有匹配的表格容器节点（同一 selector 可能匹配多个表格实例）
    // 注意：不做预扫描，直接遍历，最后判断是否有匹配项
    let anyTableFound = false;

    for (let tIdx = 0; tIdx < nodes.length; tIdx += 1) {
      const tableNode = nodes[tIdx];
      if (!matchesSelector(tableNode._origEl, selector)) continue;

      anyTableFound = true;

      // 在容器节点之后查找表头节点（DOM 顺序保证子节点在容器后）
      let headerNode = null;
      let headerNodeIdx = -1;

      for (let i = tIdx + 1; i < nodes.length; i += 1) {
        const n = nodes[i];
        // tableNode._origEl 为 null 时无法判断包含关系，停止查找
        if (!tableNode._origEl) break;

        // 已超出容器范围，停止查找
        if (n._origEl && !tableNode._origEl.contains(n._origEl)) break;

        if (matchesSelector(n._origEl, repeatHeader)) {
          headerNode = n;
          headerNodeIdx = i;
          break;
        }
      }

      if (!headerNode) {
        console.warn(
          `[repeat-header] Header not found: ${repeatHeader} in ${selector}`,
        );
        continue;
      }

      // 找表头的所有子节点（从 headerNodeIdx+1 开始，范围内节点不可能是 headerNode 自身）
      const headerChildren = [];

      for (let i = headerNodeIdx + 1; i < nodes.length; i += 1) {
        const n = nodes[i];
        // 已超出表头范围，停止查找
        if (n._origEl && !headerNode._origEl.contains(n._origEl)) break;

        if (n._origEl) {
          headerChildren.push(n);
        }
      }

      headerMetas.push({
        tableNode,
        headerNode,
        headerChildren,
        headerRendered: false,
        skipOnCurrentPage: false,
      });
    }

    if (!anyTableFound) {
      console.warn(`[repeat-header] Table container not found: ${selector}`);
    }
  }

  return headerMetas;
}

/**
 * 预标记节点所属的 headerMeta，返回 WeakMap<node, meta>
 */
function buildNodeHeaderMetaMap(nodes, headerMetas) {
  const metaMap = new WeakMap();

  for (const meta of headerMetas) {
    const containerEl = meta.tableNode._origEl;
    if (!containerEl) continue;

    const startIdx = nodes.indexOf(meta.tableNode);
    if (startIdx === -1) continue;

    for (let i = startIdx + 1; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node._origEl || !containerEl.contains(node._origEl)) break;

      metaMap.set(node, meta);
    }
  }

  return metaMap;
}

/**
 * 创建 repeat-header 管理器
 * 若 tables 中没有任何 repeatHeader 配置，返回 null。
 * @param {Array} nodes
 * @param {Array} tables - [{ selector, repeatHeader, pageBreakBorder }]
 */
export function createRepeatHeaderManager(nodes, tables = []) {
  const hasRepeatHeader = tables.some((t) => t.repeatHeader);

  if (hasRepeatHeader) {
    const headerMetas = collectHeaderMetas(nodes, tables);
    const nodeMetaMap =
      headerMetas.length > 0
        ? buildNodeHeaderMetaMap(nodes, headerMetas)
        : new WeakMap();

    return {
      headerMetas,
      getHeaderMetaForNode: (node) => nodeMetaMap.get(node) || null,
    };
  }

  return null;
}

/**
 * 判断节点是否需要跳过（原始表头节点或其子节点）
 */
export function shouldSkipOriginalHeader(node, headerMeta) {
  if (!headerMeta) return false;

  if (node._origEl === headerMeta.headerNode._origEl) return true;

  return !!(
    node._origEl && headerMeta.headerNode._origEl?.contains(node._origEl)
  );
}

/**
 * CSS Table painting order（与 stream-pagination.js getPaintOrder 保持一致）
 */
function getPaintOrderForNode(node) {
  if (node.type === 'text' || node.type === 'pseudo-element') return 5;

  const { tag } = node;
  if (tag === 'TABLE' || tag === 'COLGROUP' || tag === 'COL') return 0;

  if (tag === 'TBODY' || tag === 'THEAD' || tag === 'TFOOT') return 1;

  if (tag === 'TR') return 2;

  if (tag === 'TD' || tag === 'TH') return 3;

  return 4;
}

/**
 * 生成 repeat-header 的渲染计划。
 *
 * repeat-header / repeat-header-child 的 offsetYpx = accumulatedYpx，
 * 使节点的 relativeY = 0，从新页顶部开始渲染（y - offsetYpx = 0）。
 *
 * 祖先容器 spill 的 clipTopPx = pageRawTopPx - pageContentTopPx = 0，
 * 因为 pageRawTopPx 已被设为 pageContentTopPx（见 stream-pagination.js），
 * 所以祖先边框/背景从页顶开始覆盖，repeat-header 内容自然盖在其上。
 *
 * @param {Object} headerMeta
 * @param {number} currentPage
 * @param {number} accumulatedYpx - 新页全局起点（含表头区域，px）
 */
export function generateRepeatHeaderPlacements(
  headerMeta,
  currentPage,
  accumulatedYpx,
) {
  const placements = [];
  const headerHeightPx = headerMeta.headerNode.height;
  // 浅拷贝节点，仅覆盖 y 坐标以对齐新页表头位置（引用字段共享，渲染管线只读）
  const headerAtTop = { ...headerMeta.headerNode, y: accumulatedYpx };

  placements.push({
    page: currentPage,
    node: headerAtTop,
    // offsetYpx = accumulatedYpx → relativeY = node.y - offsetYpx = 0（页顶渲染）
    offsetYpx: accumulatedYpx,
    type: 'repeat-header',
    isLastSpill: true,
    paintOrder: getPaintOrderForNode(headerMeta.headerNode),
    dfsIndex: -2,
  });

  for (const child of headerMeta.headerChildren) {
    const offsetInHeader = child.y - headerMeta.headerNode.y;
    const childAtTop = { ...child, y: accumulatedYpx + offsetInHeader };

    placements.push({
      page: currentPage,
      node: childAtTop,
      offsetYpx: accumulatedYpx,
      type: 'repeat-header-child',
      isLastSpill: true,
      paintOrder: getPaintOrderForNode(child),
      dfsIndex: -1,
    });
  }

  return { placements, headerHeightPx };
}
