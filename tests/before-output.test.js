import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initContext } from '../src/core/context.js';
import { htmlpdf } from '../src/main.js';

vi.mock('../src/core', () => ({
  initContext,
  cloneDocument: async () => ({ iframe: {}, cloneRoot: {} }),
  parseNodes: () => [],
  preloadImages: async () => {},
  destroyDocument: () => {},
  injectFontsToJsPDF: async () => {},
  initRepeatHeader: () => null,
  getPageBreakLinesMap: () => new WeakMap(),
  streamPaginate: () => ({ totalPages: 1, allPlacements: [] }),
  getPageBreakLines: () => new Map(),
  renderHeaderFooter: (doc, { header }) => header?.render(doc, {}),
}));
vi.mock('../src/render', () => ({
  renderNode: () => {},
  drawSpillClosingLines: () => {},
}));

const element = { getBoundingClientRect: () => ({ width: 800 }) };

describe('beforeOutput', () => {
  beforeEach(() => vi.clearAllMocks());

  it('receives the pagination count after header rendering and changes output', async () => {
    let calls = 0;
    const output = await htmlpdf(element, {
      output: 'arraybuffer',
      header: { height: 0, render: (doc) => doc.addPage() },
      beforeOutput: (doc, { totalPages, ctx }) => {
        calls += 1;
        expect(totalPages).toBe(1);
        expect(ctx.doc).toBe(doc);
        expect(ctx.pageWidth).toBeGreaterThan(0);
        doc.setProperties({ title: 'HOOK_TITLE' });
        doc.addPage();
      },
    });
    expect(calls).toBe(1);
    const pdf = new TextDecoder().decode(output);
    expect(pdf).toContain('/Title (HOOK_TITLE)');
    expect(pdf).toContain('/Count 3');
  });

  it('runs the hook inside a destructured context output method', async () => {
    const ctx = initContext(element, {
      beforeOutput: (doc, info) => {
        expect(info.totalPages).toBe(4);
        expect(info.ctx).toBe(ctx);
        doc.setProperties({ title: 'CONTEXT_TITLE' });
      },
    });
    const { output } = ctx;
    const pdf = await output('arraybuffer', 4);
    expect(new TextDecoder().decode(pdf)).toContain('/Title (CONTEXT_TITLE)');
  });

  it('waits for asynchronous changes before serializing', async () => {
    const output = await htmlpdf(element, {
      output: 'arraybuffer',
      beforeOutput: async (doc) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        doc.setProperties({ title: 'ASYNC_TITLE' });
      },
    });
    expect(new TextDecoder().decode(output)).toContain('/Title (ASYNC_TITLE)');
  });

  it.each([false, true])(
    'propagates hook errors (async: %s)',
    async (asyncHook) => {
      const error = new Error('hook failed');
      const beforeOutput = asyncHook
        ? async () => {
            throw error;
          }
        : () => {
            throw error;
          };
      await expect(htmlpdf(element, { beforeOutput })).rejects.toBe(error);
    },
  );

  it('still outputs a PDF without a hook', async () => {
    expect(await htmlpdf(element, { output: 'arraybuffer' })).toBeInstanceOf(
      ArrayBuffer,
    );
  });
});
