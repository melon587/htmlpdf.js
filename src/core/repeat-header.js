/**
 * Repeat-Header 管理器
 * tables 配置格式：[{ selector, repeatHeader, pageBreakBorder }]
 */

import { matchesSelector } from '../utils';

/**
 * 扫描单个 table 容器，找到 headerNode、其子节点，以及 header 后的第一个数据 TR。
 * 返回 { headerNode, headerChildren, firstDataTR } 或 null（未找到 header）。
 *
 * @param {Array}   nodes         - 所有解析后的节点
 * @param {number}  tIdx          - tableNode 在 nodes 中的索引
 * @param {Element} containerEl   - tableNode._origEl
 * @param {string}  repeatHeader  - header 选择器
 * @returns {{ headerNode, headerChildren, firstDataTR } | null}
 */
function scanTableHeader(nodes, tIdx, containerEl, repeatHeader) {
  let headerNode = null;
  let firstDataTR = null;
  const headerChildren = [];

  for (let i = tIdx + 1; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (n._origEl && containerEl.contains(n._origEl)) {
      if (headerNode === null) {
        if (matchesSelector(n._origEl, repeatHeader)) {
          headerNode = n;
        }
      } else if (headerNode._origEl.contains(n._origEl)) {
        headerChildren.push(n);
      } else if (firstDataTR === null && n.tag === 'TR') {
        // 在 header 外、table 内：找第一个 TR 作为 firstDataTR，找到即可退出
        firstDataTR = n;
        break;
      }
    } else {
      break;
    }
  }

  return headerNode ? { headerNode, headerChildren, firstDataTR } : null;
}

/**
 * 将单条表格 meta 回填到 table 范围内的所有节点
 *
 * @param {object}  opts             - 回填参数
 * @param {Array}   opts.nodes       - 所有解析后的节点
 * @param {number}  opts.startIdx    - 从 nodes[startIdx] 开始（tableNode 的下一个）
 * @param {Element} opts.containerEl - table 的原始 DOM 元素（用于 contains 边界判断）
 * @param {object}  opts.meta        - 要写入的 meta 对象
 * @param {WeakMap} opts.nodeMetaMap - 目标映射
 * @returns {void}
 */
function fillNodeMetaMap({ nodes, startIdx, containerEl, meta, nodeMetaMap }) {
  for (let i = startIdx; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (n._origEl && containerEl.contains(n._origEl)) {
      nodeMetaMap.set(n, meta);
    } else {
      break;
    }
  }
}

/**
 * 将单个 config 对应的所有表格节点注册到 nodeMetaMap。
 * 遍历 nodes 找所有匹配 selector 的 tableNode，扫描其 header，
 * 将 table 范围内全部节点映射到对应 meta。
 *
 * @param {Array}   nodes       - 所有解析后的节点
 * @param {object}  config      - 单条表格配置 { selector, repeatHeader }
 * @param {WeakMap} nodeMetaMap - 待填充的节点 → meta 映射
 * @returns {void}
 */
function registerConfigMeta(nodes, config, nodeMetaMap) {
  const { selector, repeatHeader } = config;
  let anyTableFound = false;

  for (let tIdx = 0; tIdx < nodes.length; tIdx += 1) {
    const tableNode = nodes[tIdx];

    if (matchesSelector(tableNode._origEl, selector)) {
      anyTableFound = true;
      const containerEl = tableNode._origEl;

      const found = scanTableHeader(nodes, tIdx, containerEl, repeatHeader);
      if (found) {
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

        fillNodeMetaMap({
          nodes,
          startIdx: tIdx + 1,
          containerEl,
          meta,
          nodeMetaMap,
        });
      } else {
        console.warn(
          `[repeat-header] Header not found: ${repeatHeader} in ${selector}`,
        );
      }
    }
  }

  if (!anyTableFound) {
    console.warn(`[repeat-header] Table container not found: ${selector}`);
  }
}

/**
 * 构建节点 → meta 的 WeakMap。
 * 对每个含 repeatHeader 的 config 调用 registerConfigMeta 完成注册。
 * 若 tables 中没有任何 repeatHeader config，返回 null。
 *
 * @param {Array} nodes
 * @param {Array} tables - [{ selector, repeatHeader, pageBreakBorder }]
 * @returns {WeakMap|null} nodeMetaMap，或 null（无任何 repeatHeader 配置）
 */
function buildNodeMetaMap(nodes, tables) {
  const hasRepeatHeader = tables.some((t) => t.repeatHeader);

  if (hasRepeatHeader) {
    const nodeMetaMap = new WeakMap();

    for (const config of tables) {
      if (config.repeatHeader) {
        registerConfigMeta(nodes, config, nodeMetaMap);
      }
    }

    return nodeMetaMap;
  }

  return null;
}

/**
 * 创建 repeat-header 管理器
 * 若 tables 中没有任何 repeatHeader 配置，返回 null。
 *
 * @param {Array} nodes
 * @param {Array} tables - [{ selector, repeatHeader, pageBreakBorder }]
 * @returns {{ getHeaderMetaForNode, setMeta } | null}
 */
export function initRepeatHeader(nodes, tables = []) {
  const nodeMetaMap = buildNodeMetaMap(nodes, tables);

  if (nodeMetaMap) {
    return {
      getHeaderMetaForNode: (node) => nodeMetaMap.get(node) || null,
      /**
       * 更新 meta 对象上的指定字段
       * @param {object} e     - repeat-header meta 对象
       * @param {string} key   - 字段名
       * @param {*}      value - 新值
       * @returns {void}
       */
      setMeta(e, key, value) {
        e[key] = value;
      },
    };
  }

  return null;
}

/**
 * 判断节点是否需要跳过（原始表头节点或其子节点）
 *
 * @param {object}      node       - 待检测的节点
 * @param {object|null} headerMeta - repeat-header meta，无时传 null
 * @returns {boolean} 应跳过返回 true，否则 false
 */
export function shouldSkipOriginalHeader(node, headerMeta) {
  if (headerMeta) {
    if (node._origEl === headerMeta.headerNode._origEl) return true;

    return (
      node._origEl !== null &&
      headerMeta.headerNode._origEl?.contains(node._origEl) === true
    );
  }

  return false;
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
 * @param {object} headerMeta      - repeat-header meta（含 headerNode、headerChildren）
 * @param {number} currentPage     - 当前页码
 * @param {number} accumulatedYpx  - 新页全局起点（含表头区域，px）
 * @returns {{ placements: Array, headerHeightPx: number }}
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

  for (let idx = 0; idx < childCount; idx += 1) {
    const child = headerMeta.headerChildren[idx];
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
  }

  return { placements, headerHeightPx };
}
