/**
 * Repeat-Header 管理器：工厂函数模式
 */

import { matchesSelector } from '../utils';

/**
 * 获取 y 坐标所在的页码（从 1 开始）
 */
function getPageNumber(y, pageHeightPx) {
  return Math.floor(y / pageHeightPx) + 1;
}

/**
 * 统一配置格式（支持字符串或对象）
 */
function normalizeContainerConfig(config) {
  return typeof config === 'string'
    ? { container: config, header: null }
    : config;
}

/**
 * 收集 repeat-header 元信息
 */
function collectHeaderMetas(nodes, pageHeightPx, repeatHeaders) {
  const headerMetas = [];

  for (const config of repeatHeaders) {
    const { container, header } = normalizeContainerConfig(config);

    // 1. 找到表格容器节点
    const tableNode = nodes.find((n) => matchesSelector(n._origEl, container));

    if (!tableNode) {
      console.warn(`[repeat-header] Table container not found: ${container}`);
      continue;
    }

    // 2. 查找表头节点
    let headerNode = null;

    if (header) {
      // 用户指定了表头选择器，直接查找
      headerNode = nodes.find(
        (n) =>
          matchesSelector(n._origEl, header) &&
          tableNode._origEl.contains(n._origEl),
      );

      if (!headerNode) {
        console.warn(
          `[repeat-header] Specified header not found: ${header} in ${container}`,
        );
        continue;
      }
    } else {
      // 用户未指定，自动查找带 repeat-header 属性的节点
      headerNode = nodes.find(
        (n) => n.repeatHeader && tableNode._origEl.contains(n._origEl),
      );

      if (!headerNode) {
        console.warn(
          `[repeat-header] No repeat-header attribute found in ${container}. ` +
            `Please add repeat-header to the header element, ` +
            `or specify header selector in config.`,
        );
        continue;
      }
    }

    // 3. 找到表头的所有子节点
    const headerChildren = nodes.filter(
      (n) =>
        n._origEl &&
        n._origEl !== headerNode._origEl &&
        headerNode._origEl.contains(n._origEl),
    );

    // 4. 计算表格跨越的页数
    const tableStartPage = getPageNumber(tableNode.y, pageHeightPx);
    const tableEndPage = Math.ceil(
      (tableNode.y + tableNode.height) / pageHeightPx,
    );

    // 5. 计算需要插入表头的页码
    const pages = [];
    for (let pg = tableStartPage + 1; pg <= tableEndPage; pg++) {
      pages.push(pg);
    }

    // 收集元信息
    headerMetas.push({
      tableNode,
      headerNode,
      headerChildren,
      pages,
      pageHeightPx,
      actualStartPage: null, // 动态记录实际开始页码
    });
  }

  return headerMetas;
}

/**
 * 预标记节点所属的 headerMeta
 */
function markNodeHeaderMeta(nodes, headerMetas) {
  for (const meta of headerMetas) {
    if (!meta.tableNode._origEl) continue;

    for (const node of nodes) {
      if (node._origEl && meta.tableNode._origEl.contains(node._origEl)) {
        node._headerMeta = meta;
      }
    }
  }
}

/**
 * 工厂函数：创建 repeat-header 管理器
 * @param {Array} nodes - 节点数组
 * @param {number} pageHeightPx - 页面高度（px）
 * @param {Array} repeatHeaders - repeat-header 配置
 * @returns {Object} 管理器对象
 */
export function createRepeatHeaderManager(
  nodes,
  pageHeightPx,
  repeatHeaders = [],
) {
  // 1. 收集元数据
  const headerMetas = collectHeaderMetas(nodes, pageHeightPx, repeatHeaders);

  // 2. 预标记节点
  if (headerMetas.length > 0) {
    markNodeHeaderMeta(nodes, headerMetas);
  }

  // 3. 返回管理器对象（数据 + 辅助方法）
  return {
    headerMetas,
    hasHeaders: () => headerMetas.length > 0,
    getHeaderMetaForNode: (node) => node._headerMeta || null,
  };
}

/**
 * 判断节点是否需要跳过（原始表头节点）
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

  // 生成子节点渲染计划
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
