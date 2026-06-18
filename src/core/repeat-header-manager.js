/**
 * Repeat-Header 管理器：工厂函数模式
 *
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
    const tableNode = nodes.find((n) => matchesSelector(n._origEl, selector));

    if (!tableNode) {
      console.warn(`[repeat-header] Table container not found: ${selector}`);
      continue;
    }

    // 2. 查找表头节点（用 repeatHeader 选择器，在容器内查找）
    const headerNode = nodes.find(
      (n) =>
        matchesSelector(n._origEl, repeatHeader) &&
        tableNode._origEl.contains(n._origEl),
    );

    if (!headerNode) {
      console.warn(
        `[repeat-header] Header not found: ${repeatHeader} in ${selector}`,
      );
      continue;
    }

    // 3. 找到表头的所有子节点
    const headerChildren = nodes.filter(
      (n) =>
        n._origEl &&
        n._origEl !== headerNode._origEl &&
        headerNode._origEl.contains(n._origEl),
    );

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
 * 工厂函数：创建 repeat-header 管理器
 * @param {Array} nodes
 * @param {Array} tables - [{ selector, repeatHeader, pageBreakBorder }]
 */
export function createRepeatHeaderManager(nodes, tables = []) {
  const headerMetas = collectHeaderMetas(nodes, tables);

  if (headerMetas.length > 0) {
    markNodeHeaderMeta(nodes, headerMetas);
  }

  return {
    headerMetas,
    getHeaderMetaForNode: (node) => node._headerMeta || null,
  };
}

/**
 * 判断节点是否需要跳过（原始表头节点或其子节点）
 */
export function shouldSkipOriginalHeader(node, headerMeta) {
  if (!headerMeta) return false;

  const isHeaderNode = node._origEl === headerMeta.headerNode._origEl;
  const isHeaderChild =
    node._origEl &&
    headerMeta.headerNode._origEl &&
    headerMeta.headerNode._origEl.contains(node._origEl);

  return isHeaderNode || isHeaderChild;
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
  });

  for (const child of headerMeta.headerChildren) {
    const offsetInHeader = child.y - headerMeta.headerNode.y;
    const childAtTop = { ...child, y: accumulatedYpx + offsetInHeader };

    placements.push({
      page: currentPage,
      node: childAtTop,
      offsetYpx: accumulatedYpx,
      type: 'repeat-header-child',
    });
  }

  return { placements, headerHeightPx };
}
