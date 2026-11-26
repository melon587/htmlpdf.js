import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloneDocument, destroyDocument } from '../src/core/document-cloner.js';
import { parseNodes } from '../src/core/node-parser.js';

vi.mock('../src/core/font-loader.js', () => ({
  injectFontsToDocument: async () => {},
}));
vi.mock('../src/core/wait.js', () => ({
  waitForLayout: async () => {},
  waitForImages: async () => {},
  waitForStyleSheets: async () => {},
}));

/**
 * 创建克隆与解析接口的测试替身，坐标为固定输入，不模拟浏览器布局。
 * @param {string} tag - 节点标签
 * @param {Array} children - 子节点
 * @param {object} attributes - 属性
 * @returns {object} 测试节点
 */
function createNode(tag, children = [], attributes = {}) {
  const nodeAttributes = { ...attributes };
  const node = {
    tagName: tag,
    nodeType: tag === '#text' ? 3 : 1,
    textContent: tag === '#text' ? 'kept text' : '',
    childNodes: [],
    style: { setProperty: vi.fn() },
    hasAttribute: (name) => Object.hasOwn(nodeAttributes, name),
    getAttribute: (name) => nodeAttributes[name] ?? null,
    setAttribute: (name, value) => {
      nodeAttributes[name] = value;
    },
    removeAttribute: (name) => {
      delete nodeAttributes[name];
    },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 20,
      right: 100,
      bottom: 20,
    }),
    appendChild: (el) => {
      el.parentNode = node;
      el.parentElement = node;
      node.childNodes.push(el);

      return el;
    },
    insertBefore: (el) => {
      el.parentNode = node;
      el.parentElement = node;
      node.childNodes.unshift(el);
    },
    remove: () => {
      const { parentNode } = node;
      if (parentNode)
        parentNode.childNodes.splice(parentNode.childNodes.indexOf(node), 1);

      node.parentNode = null;
      node.parentElement = null;
    },
    removeChild: (child) => child.remove(),
    cloneNode: (deep) =>
      createNode(
        tag,
        deep ? node.childNodes.map((child) => child.cloneNode(true)) : [],
        { ...nodeAttributes },
      ),
    matches: (selector) =>
      selector.startsWith('[')
        ? node.hasAttribute(selector.slice(1, -1))
        : selector.split(',').includes(tag.toLowerCase()),
    closest: (selector) =>
      node.matches(selector)
        ? node
        : (node.parentElement?.closest(selector) ?? null),
    querySelectorAll: (selector) =>
      node.childNodes.flatMap((child) => [
        ...(child.nodeType === 1 && child.matches(selector) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]),
    querySelector: (selector) => node.querySelectorAll(selector)[0] ?? null,
  };
  Object.defineProperty(node, 'children', {
    get: () => node.childNodes.filter((child) => child.nodeType === 1),
  });
  children.forEach((child) => node.appendChild(child));

  return node;
}

/**
 * 安装克隆流程需要的文档接口，不模拟浏览器排版。
 * @param {object} root - 导出根节点
 * @returns {object} 原始文档
 */
function createDocument(root) {
  const doc = {
    baseURI: 'https://example.test/',
    defaultView: {
      getComputedStyle: () => ({
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        overflow: 'visible',
      }),
    },
    open: () => {},
    write: () => {},
    close: () => {},
    createTreeWalker: (rootNode) => {
      let current = rootNode;

      return {
        nextNode: () => {
          if (current.children.length > 0) {
            current = current.children[0];

            return current;
          }

          while (current !== rootNode) {
            const siblings = current.parentElement.children;
            const next = siblings[siblings.indexOf(current) + 1];
            if (next) {
              current = next;

              return current;
            }

            current = current.parentElement;
          }

          return null;
        },
      };
    },
    createRange: () => ({
      setStart: () => {},
      setEnd: () => {},
      getClientRects: () => [{ left: 0, top: 0, width: 100, height: 20 }],
    }),
    adoptNode: (el) => {
      el.ownerDocument = doc;
      el.childNodes.forEach((child) => doc.adoptNode(child));

      return el;
    },
    replaceChild: (node) => {
      doc.documentElement = node;
    },
    querySelector: (selector) => doc.documentElement.querySelector(selector),
    createElement: (tag) => {
      const node = createNode(tag.toUpperCase());
      if (tag === 'iframe')
        node.contentDocument = createDocument(createNode('DIV'));

      return node;
    },
  };
  doc.defaultView.document = doc;
  doc.head = createNode('HEAD');
  doc.body = createNode('BODY', [root]);
  doc.documentElement = createNode('HTML', [doc.head, doc.body]);
  doc.adoptNode(doc.documentElement);

  return doc;
}

afterEach(() => vi.unstubAllGlobals());

describe('htmlpdf-ignore', () => {
  it.each(['', 'true', 'false'])(
    'removes the cloned subtree without touching the original (%s)',
    async (value) => {
      vi.stubGlobal('NodeFilter', { SHOW_ELEMENT: 1 });
      const ignored = createNode(
        'DIV',
        [createNode('DIV', [], { 'htmlpdf-ignore': '' })],
        { 'htmlpdf-ignore': value },
      );
      const kept = createNode('CANVAS');
      const root = createNode('DIV', [ignored, kept]);
      const ownerDoc = createDocument(root);
      const { iframe, cloneRoot } = await cloneDocument(root);
      expect(cloneRoot.querySelectorAll('[htmlpdf-ignore]')).toHaveLength(0);
      expect(cloneRoot.children.map((child) => child.tagName)).toEqual([
        'CANVAS',
      ]);
      expect(root.children).toEqual([ignored, kept]);
      expect(root.hasAttribute('data-htmlpdf-root')).toBe(false);
      destroyDocument(iframe);
      expect(ownerDoc.body.children).toEqual([root]);
    },
  );

  it.each(['root', 'ancestor'])(
    'rejects an ignored export %s before creating an iframe',
    async (location) => {
      vi.stubGlobal('NodeFilter', { SHOW_ELEMENT: 1 });
      const root = createNode('DIV');
      const ownerDoc = createDocument(root);
      (location === 'root' ? root : ownerDoc.body).setAttribute(
        'htmlpdf-ignore',
        '',
      );
      await expect(cloneDocument(root)).rejects.toThrow(/ignored/i);
      expect(ownerDoc.body.children).toEqual([root]);
      expect(root.hasAttribute('data-htmlpdf-root')).toBe(false);
    },
  );

  it('keeps canvas, form and text aligned after consecutive ignored siblings and pseudo-elements', () => {
    vi.stubGlobal('Node', { ELEMENT_NODE: 1, TEXT_NODE: 3 });
    const ignored = createNode('DIV', [], { 'htmlpdf-ignore': '' });
    const ignoredAgain = createNode('INPUT', [], { 'htmlpdf-ignore': 'false' });
    const canvas = createNode('CANVAS');
    const input = createNode('INPUT');
    input.value = 'current input';
    input.type = 'text';
    const root = createNode('DIV', [
      ignored,
      ignoredAgain,
      canvas,
      createNode('#text'),
      input,
    ]);
    const cloneRoot = root.cloneNode(true);
    cloneRoot.querySelectorAll('[htmlpdf-ignore]').forEach((el) => el.remove());
    cloneRoot.insertBefore(createNode('SPAN', [], { 'data-pseudo': 'before' }));
    createDocument(cloneRoot);
    const nodes = parseNodes(root, cloneRoot);
    expect(nodes.map((node) => node.tag)).toEqual([
      'DIV',
      'SPAN',
      'CANVAS',
      '#text',
      'INPUT',
    ]);
    expect(nodes[1]._origEl).toBeNull();
    expect(nodes[2]._el).toBe(canvas);
    expect(nodes[2]._origEl).toBe(canvas);
    expect(nodes[3]._origEl).toBe(root);
    expect(nodes[4]._origEl).toBe(input);
    expect(nodes[4].formMeta.value).toBe('current input');
  });
});

describe('pdf-font measurement style', () => {
  it('syncs root and inherited fonts, respecting overrides without touching originals', async () => {
    vi.stubGlobal('NodeFilter', { SHOW_ELEMENT: 1 });
    const child = createNode('SPAN', [createNode('SPAN')]);
    const override = createNode('INPUT', [], { 'pdf-font': 'Custom' });
    const root = createNode('DIV', [child, override], { 'pdf-font': 'roboto' });
    createDocument(root);
    const { iframe, cloneRoot } = await cloneDocument(root, [
      { fontFamily: 'Roboto', isDefault: true },
      { fontFamily: 'Roboto', fontWeight: 700 },
      { fontFamily: 'Custom' },
    ]);
    for (const el of [
      cloneRoot,
      cloneRoot.children[0],
      cloneRoot.children[0].children[0],
    ]) {
      expect(el.getAttribute('pdf-font')).toBe('roboto');
      expect(el.style.setProperty).toHaveBeenCalledWith(
        'font-family',
        '"Roboto"',
        'important',
      );
      expect(el.style.setProperty).toHaveBeenCalledTimes(1);
    }
    expect(cloneRoot.children[1].style.setProperty).toHaveBeenCalledWith(
      'font-family',
      '"Custom", "Roboto"',
      'important',
    );
    for (const el of [root, child, child.children[0], override]) {
      expect(el.style.setProperty).not.toHaveBeenCalled();
    }
    expect(child.getAttribute('pdf-font')).toBeNull();
    destroyDocument(iframe);
  });

  it('uses existing mixed-font priority instead of the attribute declaration order', async () => {
    vi.stubGlobal('NodeFilter', { SHOW_ELEMENT: 1 });
    const root = createNode('DIV', [], { 'pdf-font': 'Roboto,CJK' });
    createDocument(root);
    const { iframe, cloneRoot } = await cloneDocument(root, [
      { fontFamily: 'Roboto', isDefault: true },
      { fontFamily: 'CJK', charRanges: [[0x4e00, 0x9fff]] },
    ]);
    expect(cloneRoot.style.setProperty).toHaveBeenCalledWith(
      'font-family',
      '"CJK", "Roboto"',
      'important',
    );
    destroyDocument(iframe);
  });

  it.each([null, '', 'Unknown'])(
    'preserves CSS for absent or unresolved pdf-font (%s)',
    async (pdfFont) => {
      vi.stubGlobal('NodeFilter', { SHOW_ELEMENT: 1 });
      const root = createNode(
        'DIV',
        [],
        pdfFont === null ? {} : { 'pdf-font': pdfFont },
      );
      createDocument(root);
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { iframe, cloneRoot } = await cloneDocument(root, [
        { fontFamily: 'Roboto', isDefault: true },
      ]);
      expect(cloneRoot.style.setProperty).not.toHaveBeenCalled();
      destroyDocument(iframe);
      warning.mockRestore();
    },
  );

  it('syncs materialized pseudo fonts after copying their original CSS', async () => {
    vi.stubGlobal('NodeFilter', { SHOW_ELEMENT: 1 });
    const root = createNode('DIV', [], { 'pdf-font': 'Roboto' });
    const ownerDoc = createDocument(root);
    const createElement = ownerDoc.createElement;
    ownerDoc.createElement = (tag) => {
      const el = createElement(tag);
      if (tag === 'iframe') {
        el.contentDocument.defaultView.getComputedStyle = (node, pseudo) => ({
          content:
            node.tagName === 'DIV' && pseudo === '::before'
              ? '"amount"'
              : 'none',
          fontFamily: 'Times New Roman',
          fontSize: '12px',
          fontWeight: '700',
          fontStyle: 'italic',
        });
      }

      return el;
    };
    const { iframe, cloneRoot } = await cloneDocument(root, [
      { fontFamily: 'Roboto', isDefault: true },
    ]);
    const span = cloneRoot.children[0];
    expect(span.getAttribute('data-pseudo')).toBe('before');
    expect(span.getAttribute('pdf-font')).toBe('Roboto');
    expect(span.style.setProperty).toHaveBeenCalledWith(
      'font-family',
      '"Roboto"',
      'important',
    );
    expect(span.style.fontSize).toBe('12px');
    expect(span.style.fontWeight).toBe('700');
    expect(span.style.fontStyle).toBe('italic');
    expect(root.children).toHaveLength(0);
    destroyDocument(iframe);
  });
});
