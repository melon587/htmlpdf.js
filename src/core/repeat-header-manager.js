/**
 * Repeat-Header 管理器
 * tables 配置格式：[{ selector, repeatHeader, pageBreakBorder }]
 */

import { matchesSelector } from '../utils';

/**
 * 扫描单个 table 容器，找到 headerNode、其子节点，以及 header 后的第一个数据 TR。
 * 返回 { headerNode, headerChildren, firstDataTR } 或 null（未找到 header）。
 *
 * @param {Array}  nodes
 * @param {number} tIdx         - tableNode 在 nodes 中的索引
 * @param {Element} containerEl - tableNode._origEl
 * @param {string} repeatHeader - header 选择器
 */
function scanTableHeader(nodes, tIdx, containerEl, repeatHeader) {
  let headerNode = null;
  let firstDataTR = null;
  const headerChildren = [];

  for (let i = tIdx + 1; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (!n._origEl || !containerEl.contains(n._origEl)) break;

    if (!headerNode) {
      if (matchesSelector(n._origEl, repeatHeader)) headerNode = n;

      continue;
    }

    if (headerNode._origEl.contains(n._origEl)) {
      headerChildren.push(n);
      continue;
    }

    // 在 header 外、table 内：找第一个 TR 作为 firstDataTR，找到即可退出
    if (!firstDataTR && n.tag === 'TR') {
      firstDataTR = n;
      break;
    }
  }

  return headerNode ? { headerNode, headerChildren, firstDataTR } : null;
}

/**
 * 构建节点 → meta 的 WeakMap。
 *
 * 在找到每个 tableNode 后，只做一次向后遍历，同时完成：
 *   1. 找 headerNode、headerChildren、firstDataTR
 *   2. 将 table 范围内所有节点映射到对应 meta（nodeMetaMap）
 *
 * @param {Array} nodes
 * @param {Array} tables - [{ selector, repeatHeader, pageBreakBorder }]
 * @returns {WeakMap} nodeMetaMap - 节点 → meta 映射
 */
function buildNodeMetaMap(nodes, tables) {
  const nodeMetaMap = new WeakMap();

  for (const config of tables) {
    const { selector, repeatHeader } = config;

    if (!repeatHeader) continue;

    let anyTableFound = false;

    for (let tIdx = 0; tIdx < nodes.length; tIdx += 1) {
      const tableNode = nodes[tIdx];
      if (!matchesSelector(tableNode._origEl, selector)) continue;

      anyTableFound = true;
      const containerEl = tableNode._origEl;
      if (!containerEl) continue;

      const found = scanTableHeader(nodes, tIdx, containerEl, repeatHeader);
      if (!found) {
        console.warn(
          `[repeat-header] Header not found: ${repeatHeader} in ${selector}`,
        );
        continue;
      }

      const meta = {
        tableNode,
        headerNode: found.headerNode,
        headerChildren: found.headerChildren,
        /**
         * header 后的第一个数据 TR 节点。
         * 用于 needsNewPage 中"表头 + 首行联体"判断：
         * 若 headerHeight + firstDataTR 有效高度 > 当前页剩余，
         * 则整个表格强推到下一页，避免孤立表头。
         */
        firstDataTR: found.firstDataTR,
        headerRendered: false,
        skipOnCurrentPage: false,
      };

      // 回填 nodeMetaMap：table 范围内所有节点 → meta
      for (let i = tIdx + 1; i < nodes.length; i += 1) {
        const n = nodes[i];
        if (!n._origEl || !containerEl.contains(n._origEl)) break;

        nodeMetaMap.set(n, meta);
      }
    }

    if (!anyTableFound) {
      console.warn(`[repeat-header] Table container not found: ${selector}`);
    }
  }

  return nodeMetaMap;
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
    const nodeMetaMap = buildNodeMetaMap(nodes, tables);

    return {
      getHeaderMetaForNode: (node) => nodeMetaMap.get(node) || null,
      /** 更新 meta 上的任意字段（key/value 对） */
      setMeta(e, key, value) {
        e[key] = value;
      },
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

  // dfsIndex 用连续负整数，保证多 child 时渲染顺序与原始 DFS 一致：
  //   headerNode:       -(childCount + 1)
  //   headerChildren:   -childCount, -(childCount-1), ..., -1
  // 所有值均 < 0，与 normal placement 的正 dfsIndex 自然分隔。
  const childCount = headerMeta.headerChildren.length;

  placements.push({
    page: currentPage,
    node: headerAtTop,
    // offsetYpx = accumulatedYpx → relativeY = node.y - offsetYpx = 0（页顶渲染）
    offsetYpx: accumulatedYpx,
    type: 'repeat-header',
    isLastSpill: true,
    dfsIndex: -(childCount + 1),
  });

  headerMeta.headerChildren.forEach((child, idx) => {
    const offsetInHeader = child.y - headerMeta.headerNode.y;
    const childAtTop = { ...child, y: accumulatedYpx + offsetInHeader };

    placements.push({
      page: currentPage,
      node: childAtTop,
      offsetYpx: accumulatedYpx,
      type: 'repeat-header-child',
      isLastSpill: true,
      dfsIndex: -(childCount - idx),
    });
  });

  return { placements, headerHeightPx };
}
