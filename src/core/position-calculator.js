import { matchesSelector } from '../utils';

/**
 * 获取 y 坐标所在的页码（从 1 开始）
 */
function getPageNumber(y, pageHeightPx) {
  return Math.floor(y / pageHeightPx) + 1;
}

/**
 * 获取指定页的结束位置（下一页的起始位置）
 */
function getPageEnd(page, pageHeightPx) {
  return page * pageHeightPx;
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
 * 处理所有节点的 page-break，直接修改 node.y（原地更新）
 * @param {Array} nodes
 * @param {number} pageHeightPx
 */
export function applyPageBreaks(nodes, pageHeightPx) {
  let shift = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const y = node.y + shift; // 当前节点应处于的 y
    let delta = 0;

    if (node.type === 'text') {
      // 文本节点底部超出页底 → 推到下一页顶
      const pageEnd = getPageEnd(getPageNumber(y, pageHeightPx), pageHeightPx);
      if (y + node.height > pageEnd) delta = pageEnd - y;
    } else if (node.pageBreak === 'before') {
      // 强制在页顶渲染：snap 到最近的页顶（四舍五入）
      // 这样无论 margin 导致的微小偏移，还是真正在页面中间，都能正确处理
      delta = Math.round(y / pageHeightPx) * pageHeightPx - y;
    } else if (node.pageBreak === 'avoid') {
      // 整体不能跨页 → 底部超出时推到下一页顶
      const pageEnd = getPageEnd(getPageNumber(y, pageHeightPx), pageHeightPx);
      if (y + node.height >= pageEnd) delta = pageEnd - y;
    }

    if (delta > 0) {
      shift += delta;
      // 更新所有包含该节点的祖先的高度
      for (let j = 0; j < i; j++) {
        if (nodes[j]._origEl?.contains(node._origEl)) {
          nodes[j].height += delta;
        }
      }
    }

    node.y = y + delta; // 写入最终 y
  }
}

/**
 * 收集 repeat-header 元信息（不生成副本，传递给 Pass2）
 * @param {Array} nodes
 * @param {number} pageHeightPx
 * @param {Array} repeatHeaders
 * @returns {Array} repeatHeaderMeta
 */
export function collectRepeatHeaderMeta(
  nodes,
  pageHeightPx,
  repeatHeaders = [],
) {
  const repeatHeaderMeta = [];

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

    // 收集元信息（不生成副本）
    repeatHeaderMeta.push({
      tableNode,
      headerNode,
      headerChildren,
      pages,
      pageHeightPx,
    });
  }

  return repeatHeaderMeta;
}
