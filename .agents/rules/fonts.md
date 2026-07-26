# 字体系统规则

## 字体配置结构

`options.fonts[]` 中的每个条目必须符合以下结构：

```js
{
  family: 'MyFont',        // 必填 — CSS font-family 名称（必须与 @font-face 一致）
  src: 'https://...',      // 必填 — .ttf/.otf 文件 URL（或使用 `data`）
  data: '<base64>',        // 替代 src 的内联 base64 字体数据
  style: 'normal',         // 可选 — 'normal' | 'italic'（默认：'normal'）
  weight: '400',           // 可选 — '400' | '700' | 'bold' 等（默认：'400'）
  charRanges: [            // 可选 — 字体分段的 Unicode 范围
    [0x4E00, 0x9FFF],      //   每个条目：[start, end] 码点对
  ],
}
```

**禁止添加 `priority` 字段。** 源码中不存在此字段，会被静默忽略。

## 两阶段字体加载

### 阶段一 — `injectFontsToDocument()`（在 iframe 内，步骤 2）

向克隆 iframe 注入 `@font-face` CSS，使布局和文字测量结果反映自定义字体度量。

### 阶段二 — `loadFontsToJsPDF()`（iframe 销毁后，步骤 5）

将每个字体以 base64 获取，调用 `doc.addFileToVFS()` + `doc.addFont()` 将其注册到 jsPDF 以供 PDF 嵌入。

`font-loader.js` 中的共享 `fontCache` Map 防止两个阶段重复 fetch。

## 渲染时的字体选择

`text.js` 中的 `drawText()` 通过 `findFontForChar()` 按字符选择字体：

1. 用 `buildEffectiveFontConfig()` 收集该节点的有效字体配置列表。
   - 优先检查节点自身的 `data-pdf-font` 属性（空格分隔的字体 family 名称）。
   - 回退到全局 `fonts[]` 数组。
2. 对每个字符码点，遍历有效配置列表：
   - 若定义了 `charRanges`，检查码点是否落在任意范围内。
   - 若未定义 `charRanges`，该字体匹配任意字符。
3. 若无自定义字体匹配，回退到 jsPDF 内置的 **Helvetica**。
4. 使用相同字体的相邻字符合并为一个分段。

## `data-pdf-font` 属性

元素可通过 HTML 属性声明首选字体：

```html
<span data-pdf-font="NotoSansSC">中文内容</span>
<p data-pdf-font="NotoSansSC Roboto">mixed content</p>
```

- 空格分隔的字体 family 名称列表。
- `node-parser.js` 在解析文本节点时读取父元素的 `pdf-font` 属性，存入 `node.pdfFont`。
- `document-cloner.js` 在 DOM 增强阶段将属性从父元素传播到子元素。

## `charRanges` 与 `unicode-range`

字体配置中的 `charRanges` 是 JS `[start, end]` 对数组。  
`utils/index.js` 中的 `buildUnicodeRange()` 将其转换为注入 iframe 的 `@font-face` 声明中的 CSS `unicode-range` 字符串。

示例：

```js
charRanges: [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
];
// → unicode-range: U+4E00-9FFF, U+3400-4DBF
```

## 字体样式映射

`text.js` 中的 `getCombinedFontStyle(fontStyle, fontWeight)` 将 CSS 值映射到 jsPDF 的四种样式标识符：

| fontStyle | fontWeight     | jsPDF 样式     |
| --------- | -------------- | -------------- |
| `normal`  | `400`/`normal` | `'normal'`     |
| `normal`  | `700`/`bold`   | `'bold'`       |
| `italic`  | `400`/`normal` | `'italic'`     |
| `italic`  | `700`/`bold`   | `'bolditalic'` |

## 添加新字体的规则

1. 将字体配置对象添加到 `options.fonts[]`。
2. 若字体覆盖特定文字（如 CJK、阿拉伯语），请指定 `charRanges`。
3. 对混合语言内容，使用 `data-pdf-font` 在 HTML 元素上强制指定字体。
4. 不要添加 `priority` — 字体选择顺序由 `fonts[]` 数组中的位置和 `buildEffectiveFontConfig()` 的排序控制。
5. 确保字体 URL 可从浏览器访问（CORS 安全或同源）。
