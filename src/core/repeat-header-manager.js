/**
 * Repeat-Header 管理器：工厂函数模式
 */

import { matchesSelector } from '../utils';

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
function collectHeaderMetas(nodes, repeatHeaders) {
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

    // 收集元信息
    headerMetas.push({
      tableNode,
      headerNode,
      // headerChildren 同时包含 element 和 text 子节点，renderNode 会按 type 分别处理
      headerChildren,
      headerRendered: false, // 原始表头是否已渲染，决定换页时是否生成 repeat-header 副本
      skipOnCurrentPage: false, // 当前页是否跳过原始表头（各表格独立维护，避免多表格竞态）
    });
  }

  return headerMetas;
}

/**
 * 预标记节点所属的 headerMeta
 *
 * 利用 collectNodes 深度优先遍历产生的数组连续性：
 * 表格容器节点之后的节点，连续属于该容器，直到遇到第一个不属于该容器的节点为止。
 * 因此无需对每个节点调用 DOM contains()，只需找到容器在数组中的起始位置，
 * 然后向后线性扫描，大幅减少 DOM 查询次数。
 */
function markNodeHeaderMeta(nodes, headerMetas) {
  for (const meta of headerMetas) {
    const containerEl = meta.tableNode._origEl;
    if (!containerEl) continue;

    // 找到表格容器节点在数组中的位置
    const startIdx = nodes.indexOf(meta.tableNode);
    if (startIdx === -1) continue;

    // 向后扫描：只要节点的 _origEl 在容器内，就标记；一旦不在则停止
    for (let j = startIdx + 1; j < nodes.length; j++) {
      const node = nodes[j];
      if (!node._origEl || !containerEl.contains(node._origEl)) break;

      node._headerMeta = meta;
    }
  }
}

/**
 * 工厂函数：创建 repeat-header 管理器
 * @param {Array} nodes - 节点数组
 * @param {Array} repeatHeaders - repeat-header 配置
 * @returns {Object} 管理器对象
 */
export function createRepeatHeaderManager(nodes, repeatHeaders = []) {
  // 1. 收集元数据
  const headerMetas = collectHeaderMetas(nodes, repeatHeaders);

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
 * 判断节点是否需要跳过（原始表头节点或其子节点）
 * 当前页已有 repeat-header 副本时，跳过原始表头避免重复渲染
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
 * 将原始表头克隆到新页顶部，子节点坐标相对表头做偏移
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
