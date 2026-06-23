/**
 * Repeat-Header 管理器
 * 接收 tables 配置格式：
 * [{ selector, repeatHeader, pageBreakBorder }]
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

    // 1. 找到表格容器节点
    const tableNodeIdx = nodes.findIndex((n) =>
      matchesSelector(n._origEl, selector),
    );

    if (tableNodeIdx === -1) {
      console.warn(`[repeat-header] Table container not found: ${selector}`);
      continue;
    }

    const tableNode = nodes[tableNodeIdx];

    // 2. 查找表头节点（只在容器节点之后的范围内查找，DOM 顺序保证子节点在容器后）
    let headerNode = null;
    let headerNodeIdx = -1;

    for (let i = tableNodeIdx + 1; i < nodes.length; i++) {
      const n = nodes[i];
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

    // 3. 找到表头的所有子节点（只在表头节点之后查找）
    const headerChildren = [];

    for (let i = headerNodeIdx + 1; i < nodes.length; i++) {
      const n = nodes[i];
      // 已超出表头范围，停止查找
      if (n._origEl && !headerNode._origEl.contains(n._origEl)) break;

      if (n._origEl && n._origEl !== headerNode._origEl) {
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

  return headerMetas;
}

/**
 * 预标记节点所属的 headerMeta
 */
function markNodeHeaderMeta(nodes, headerMetas) {
  for (const meta of headerMetas) {
    const containerEl = meta.tableNode._origEl;
    if (!containerEl) continue;

    const startIdx = nodes.indexOf(meta.tableNode);
    if (startIdx === -1) continue;

    for (let j = startIdx + 1; j < nodes.length; j++) {
      const node = nodes[j];
      if (!node._origEl || !containerEl.contains(node._origEl)) break;

      node._headerMeta = meta;
    }
  }
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

    if (headerMetas.length > 0) {
      markNodeHeaderMeta(nodes, headerMetas);
    }

    return {
      headerMetas,
      getHeaderMetaForNode: (node) => node._headerMeta || null,
    };
  }

  return null;
}

/**
 * 判断节点是否需要跳过（原始表头节点或其子节点）
 */
export function shouldSkipOriginalHeader(node, headerMeta) {
  if (!headerMeta) return false;

  // 先判断是否是表头节点本身
  const isHeaderNode = node._origEl === headerMeta.headerNode._origEl;
  if (isHeaderNode) return true;

  // 再判断是否是表头子节点
  const isHeaderChild =
    node._origEl &&
    headerMeta.headerNode._origEl &&
    headerMeta.headerNode._origEl.contains(node._origEl);

  return isHeaderChild;
}

/**
 * 生成 repeat-header 的渲染计划
 */
export function generateRepeatHeaderPlacements(
  headerMeta,
  currentPage,
  accumulatedYpx,
) {
  const placements = [];
  const headerHeightPx = headerMeta.headerNode.height;
  const headerAtTop = { ...headerMeta.headerNode, y: accumulatedYpx };

  placements.push({
    page: currentPage,
    node: headerAtTop,
    offsetYpx: accumulatedYpx,
    type: 'repeat-header',
    isLastSpill: true,
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
    });
  }

  return { placements, headerHeightPx };
}
