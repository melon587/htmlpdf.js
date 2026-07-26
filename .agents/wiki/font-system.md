# 字体系统 — 深入解析

## 概述

字体系统处理两个独立的关注点：

1. **布局保真** — 确保克隆 iframe 使用正确的字体，使文本测量结果（字符宽度、行高）与 PDF 输出一致。
2. **PDF 嵌入** — 将字体注册到 jsPDF，使其嵌入输出文件。

两个关注点均由 `src/core/font-loader.js` 处理，在流水线的不同步骤执行。

## 字体配置参考

```js
options.fonts = [
  {
    family: 'NotoSansSC', // 必填 — CSS font-family 名称
    src: 'https://cdn/.../NotoSansSC-Regular.ttf', // 必填（或使用 data）
    data: '<base64 字符串>', // 替代 src 的内联 base64 数据
    style: 'normal', // 可选：'normal' | 'italic'
    weight: '400', // 可选：'400' | '700' | 'bold' 等
    charRanges: [
      // 可选：Unicode 码点范围对
      [0x4e00, 0x9fff], // CJK 统一表意文字
      [0x3040, 0x309f], // 平假名
    ],
  },
];
```

**不存在且不得添加的字段：**

- `priority` — 不存在。选择顺序由数组位置决定。
- `fallback` — 不存在。

## 阶段一：向 iframe 注入字体（`injectFontsToDocument`）

在 `createClonedDocument()` 内部、**布局测量之前**调用。

对每个字体配置：

1. `getFontBase64(config)` — 从 `config.data` 或通过 fetch `config.src` 获取 base64。
2. `buildFontFaceRule(config, base64)`（`utils/index.js`）— 构造包含 `unicode-range` 描述符的 `@font-face` CSS 规则（通过 `buildUnicodeRange(charRanges)` 生成）。
3. 将包含所有 `@font-face` 规则的 `<style>` 元素注入 iframe 的 `<head>`。

注入后，浏览器将字体应用到克隆 DOM，使 `node-parser.js` 中的 `getBoundingClientRect()` 和 Range 测量反映真实字体度量。

## 阶段二：向 jsPDF 加载字体（`loadFontsToJsPDF`）

在 iframe 销毁后（步骤 5）调用。

对每个字体配置：

1. `getFontBase64(config)` — 从 `fontCache` 获取或重新 fetch。
2. `doc.addFileToVFS(filename, base64)` — 在 jsPDF 的虚拟文件系统中注册字体文件。
3. `doc.addFont(filename, family, style)` — 使 jsPDF 可通过 `setFont` 使用该字体。

`font-loader.js` 中的 `fontCache` Map 确保每个 URL 在两个阶段中只 fetch 一次。

## 渲染时的字体选择

`src/render/text.js` 中的 `drawText()` 按字符分段选择字体。

### 步骤一：`buildEffectiveFontConfig(node, sortedFontConfig)`

为当前节点构建有序的候选字体配置列表。

- 若 `node.pdfFont` 已设置（来自 `data-pdf-font` 属性），只有 `family` 出现在该空格分隔列表中的字体会被纳入（按其在 `options.fonts` 中的顺序）。
- 否则，`options.fonts` 中的所有字体均为候选。

### 步骤二：`segmentTextByFont(text, effectiveFontConfig)`

将文本字符串拆分为多个分段，每段使用单一字体。

对每个字符：

1. 获取 Unicode 码点。
2. 调用 `findFontForChar(code, effectiveFontConfig)`：
   - 遍历有效配置列表。
   - 若配置有 `charRanges`，检查码点是否落在任意范围内。
   - 若配置无 `charRanges`，则匹配任意字符。
   - 返回第一个匹配的配置。
3. 若无配置匹配 → 使用 Helvetica（jsPDF 内置）。
4. 将使用相同字体的连续字符合并为一个分段。

### 步骤三：`measureSegmentWidths(segments, fontStyle, ctx)`

临时设置每个分段的字体，调用 `doc.getTextWidth()` 测量宽度，用于对齐计算。

### 步骤四：`drawMultiSegmentAligned()`

在正确的 X 位置渲染每个分段，考虑整体文本对齐（左/居中/右）和 RTL 方向。

## `data-pdf-font` 属性

HTML 元素可通过此属性指定首选字体：

```html
<!-- 为该元素强制使用 NotoSansSC -->
<p data-pdf-font="NotoSansSC">中文内容</p>

<!-- 为该元素优先使用 NotoSansSC，其次使用 Roboto -->
<span data-pdf-font="NotoSansSC Roboto">混合内容 mixed</span>
```

在 `document-cloner.js` 的 DOM 增强阶段：

- `propagatePdfFontToElement()` 遍历 DOM 树，将属性从父元素复制到没有自己声明的子元素。
- `node-parser.js` 在解析文本节点时读取父元素的 `pdf-font` 属性，存入 `node.pdfFont`。

## `charRanges` 与 CSS `unicode-range`

### JS 字体配置中的写法

```js
charRanges: [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
];
```

### 通过 `buildUnicodeRange()` 转换为 CSS

```css
unicode-range: U+4E00-9FFF, U+3400-4DBF;
```

此 CSS 包含在注入 iframe 的 `@font-face` 规则中，使浏览器在布局时将字体应用到匹配字符。

渲染时，同样的 `charRanges` 被 `findFontForChar()` 用于在 jsPDF 中为每个字符选择正确字体。

## 字体样式 / 字重映射

| CSS `font-style`    | CSS `font-weight` | jsPDF 样式字符串 |
| ------------------- | ----------------- | ---------------- |
| `normal`            | `400`、`normal`   | `'normal'`       |
| `normal`            | `700`、`bold`     | `'bold'`         |
| `italic`、`oblique` | `400`、`normal`   | `'italic'`       |
| `italic`、`oblique` | `700`、`bold`     | `'bolditalic'`   |

`text.js` 中的 `getCombinedFontStyle(fontStyle, fontWeight)` 处理此映射。

若要支持粗体/斜体变体，必须在 `options.fonts` 中添加对应 `style` 和 `weight` 的独立字体配置条目。

## 回退链

1. **`data-pdf-font` 限定集** — 属性列出的字体
2. **完整 `options.fonts` 列表** — 所有已配置字体，按 `charRanges` 检查
3. **Helvetica** — jsPDF 内置，始终可用，覆盖基本拉丁字符

不存在 `fonts[0]` 回退层——若 `charRanges` 使所有字体对某字符不匹配，系统直接回退到 Helvetica。

## 常见字体问题及原因

| 症状 | 可能原因 |
| --- | --- |
| 文字显示为方块 / 豆腐块 | jsPDF 中未注册字体（阶段二失败） |
| 浏览器显示正确但 PDF 不对 | iframe 中未注入字体（阶段一失败） |
| 出现错误字符 | `charRanges` 在多个字体间重叠 |
| PDF 中粗体文字不粗 | `options.fonts` 中缺少粗体变体（同 family，`weight: '700'`） |
| `data-pdf-font` 无效 | `document-cloner.js` 未传播该属性 |
