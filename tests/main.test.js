import { describe, it, expect } from 'vitest';

// main.js 中的 placementOrder 和 comparePlacements 已在 utils.test.js 中测试
// 这里测试 buildPageBreakBorderMap（如果导出的话）

// 由于 buildPageBreakBorderMap 是内部函数未导出，这里我们测试其逻辑
// 通过内联相同实现进行测试

import { matchesSelector } from '../src/utils/index.js';

/**
 * 构建 pageBreakBorder 映射（表格容器 → 边框样式）
 * （从 main.js 复制的实现，用于测试）
 */
function buildPageBreakBorderMap(nodes, tables) {
  const borderMap = new WeakMap();

  tables
    .filter((t) => t.pageBreakBorder)
    .forEach((tableConf) => {
      nodes
        .filter((n) => matchesSelector(n._origEl, tableConf.selector))
        .forEach((containerNode) => {
          borderMap.set(containerNode, tableConf.pageBreakBorder);
        });
    });

  return borderMap;
}

describe('buildPageBreakBorderMap', () => {
  it('空 tables：返回空 WeakMap', () => {
    const nodes = [];
    const tables = [];
    const map = buildPageBreakBorderMap(nodes, tables);

    expect(map).toBeInstanceOf(WeakMap);
  });

  it('无 pageBreakBorder 配置：返回空 WeakMap', () => {
    const nodes = [{ _origEl: { id: 'table' } }];
    const tables = [{ selector: '#table', repeatHeader: '#header' }];
    const map = buildPageBreakBorderMap(nodes, tables);

    expect(map.get(nodes[0])).toBeUndefined();
  });

  it('单个表格配置 pageBreakBorder', () => {
    const tableNode = { _origEl: { id: 'my-table' } };
    const nodes = [tableNode];
    const tables = [
      { selector: '#my-table', pageBreakBorder: '2px solid #000' },
    ];

    const map = buildPageBreakBorderMap(nodes, tables);

    expect(map.get(tableNode)).toBe('2px solid #000');
  });

  it('多个表格配置不同边框', () => {
    const table1 = { _origEl: { id: 'table1' } };
    const table2 = { _origEl: { id: 'table2' } };
    const nodes = [table1, table2];

    const tables = [
      { selector: '#table1', pageBreakBorder: '1px solid red' },
      { selector: '#table2', pageBreakBorder: '2px dashed blue' },
    ];

    const map = buildPageBreakBorderMap(nodes, tables);

    expect(map.get(table1)).toBe('1px solid red');
    expect(map.get(table2)).toBe('2px dashed blue');
  });

  it('同一 selector 匹配多个节点', () => {
    const table1 = {
      _origEl: { classList: { contains: (c) => c === 'data-table' } },
    };
    const table2 = {
      _origEl: { classList: { contains: (c) => c === 'data-table' } },
    };
    const nodes = [table1, table2];

    const tables = [
      { selector: '.data-table', pageBreakBorder: '1px solid #ccc' },
    ];

    const map = buildPageBreakBorderMap(nodes, tables);

    expect(map.get(table1)).toBe('1px solid #ccc');
    expect(map.get(table2)).toBe('1px solid #ccc');
  });

  it('节点不匹配 selector：不添加到映射', () => {
    const table1 = { _origEl: { id: 'table1' } };
    const table2 = { _origEl: { id: 'table2' } };
    const nodes = [table1, table2];

    const tables = [{ selector: '#table1', pageBreakBorder: '1px solid #000' }];

    const map = buildPageBreakBorderMap(nodes, tables);

    expect(map.get(table1)).toBe('1px solid #000');
    expect(map.get(table2)).toBeUndefined(); // table2 不匹配
  });

  it('混合配置：有些有 pageBreakBorder，有些没有', () => {
    const table1 = { _origEl: { id: 'table1' } };
    const table2 = { _origEl: { id: 'table2' } };
    const nodes = [table1, table2];

    const tables = [
      { selector: '#table1', pageBreakBorder: '1px solid #000' },
      { selector: '#table2', repeatHeader: '#header' }, // 无 pageBreakBorder
    ];

    const map = buildPageBreakBorderMap(nodes, tables);

    expect(map.get(table1)).toBe('1px solid #000');
    expect(map.get(table2)).toBeUndefined();
  });

  it('WeakMap 不污染节点对象', () => {
    const tableNode = { _origEl: { id: 'table' } };
    const nodes = [tableNode];
    const tables = [{ selector: '#table', pageBreakBorder: '1px solid #000' }];

    buildPageBreakBorderMap(nodes, tables);

    // 验证节点对象没有被添加新属性
    expect(tableNode.pageBreakBorder).toBeUndefined();
    expect(Object.keys(tableNode)).toEqual(['_origEl']);
  });
});

// ── ensurePage ──────────────────────────────────────────────────────────────

/**
 * 确保 PDF 文档有指定页，并切换到该页
 * （从 main.js 复制的实现，用于测试）
 */
function ensurePage(doc, targetPage, currentPage) {
  if (targetPage <= currentPage) {
    doc.setPage(targetPage);

    return;
  }

  const pagesToAdd = targetPage - Math.max(currentPage, 1);
  for (let i = 0; i < pagesToAdd; i++) doc.addPage();

  doc.setPage(targetPage);
}

describe('ensurePage', () => {
  it('目标页 <= 当前页：直接 setPage', () => {
    const doc = {
      setPage: (p) => {
        doc.currentPage = p;
      },
      addPage: () => {
        doc.pageCount++;
      },
      currentPage: 0,
      pageCount: 1,
    };

    ensurePage(doc, 1, 1);
    expect(doc.currentPage).toBe(1);
    expect(doc.pageCount).toBe(1); // 未添加新页
  });

  it('目标页 > 当前页：添加缺失页', () => {
    const doc = {
      setPage: (p) => {
        doc.currentPage = p;
      },
      addPage: () => {
        doc.pageCount++;
      },
      currentPage: 0,
      pageCount: 1,
    };

    ensurePage(doc, 3, 1); // 从第 1 页跳到第 3 页
    expect(doc.pageCount).toBe(3); // 添加了 2 页 (3 - 1 = 2)
    expect(doc.currentPage).toBe(3);
  });

  it('当前页 = 0（还没渲染任何页）', () => {
    const doc = {
      setPage: (p) => {
        doc.currentPage = p;
      },
      addPage: () => {
        doc.pageCount++;
      },
      currentPage: 0,
      pageCount: 1, // jsPDF 自动创建第一页
    };

    ensurePage(doc, 2, 0); // 从第 0 页跳到第 2 页
    expect(doc.pageCount).toBe(2); // 添加 1 页 (2 - max(0,1) = 1)
    expect(doc.currentPage).toBe(2);
  });

  it('连续跳页：1 → 5', () => {
    const doc = {
      setPage: (p) => {
        doc.currentPage = p;
      },
      addPage: () => {
        doc.pageCount++;
      },
      currentPage: 0,
      pageCount: 1,
    };

    ensurePage(doc, 5, 1);
    expect(doc.pageCount).toBe(5); // 添加 4 页
    expect(doc.currentPage).toBe(5);
  });

  it('回退到前一页', () => {
    const doc = {
      setPage: (p) => {
        doc.currentPage = p;
      },
      addPage: () => {
        doc.pageCount++;
      },
      currentPage: 0,
      pageCount: 3,
    };

    ensurePage(doc, 2, 3); // 从第 3 页回到第 2 页
    expect(doc.currentPage).toBe(2);
    expect(doc.pageCount).toBe(3); // 不添加新页
  });
});
