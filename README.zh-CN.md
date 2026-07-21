# htmlpdfx.js

[![npm version](https://img.shields.io/npm/v/htmlpdfx.js.svg)](https://www.npmjs.com/package/htmlpdfx.js) [![license](https://img.shields.io/npm/l/htmlpdfx.js.svg)](https://github.com/melon587/htmlpdf.js/blob/main/LICENSE)

[English](./README.md) | [中文文档](./README.zh-CN.md)

基于 jsPDF 的轻量级 HTML 转 PDF 库，支持自定义字体、分页控制、表头重复、伪元素渲染和跨页图片/画布裁切的多页渲染。

## ✨ 特性

- 📄 **多页渲染** - 自动将内容拆分到多个 PDF 页面
- 🎨 **自定义字体** - 支持不同字重和样式的自定义字体族，包括多语言混排（如英文 + 中文 + 阿拉伯语）
- 🌍 **RTL/BiDi 支持** - 原生支持从右到左的语言（阿拉伯语、希伯来语），自动文本重排序
- 📑 **分页控制** - 使用 `page-break="before"` 或 `page-break="avoid"` 属性控制分页
- 🔁 **表头重复** - 使用 `repeat-header` 属性在每页自动重复表格表头
- 📐 **页眉页脚** - 可自定义页眉页脚，支持页码显示
- 🖼️ **跨页裁切** - 跨多页的图片和画布会自动裁切并在各页渲染
- 🎭 **伪元素** - 支持 `::before` 和 `::after` 伪元素的字符串内容
- 🌈 **线性渐变** - 渲染 CSS `linear-gradient()` 背景（支持上下左右方向、角度、多色停点）
- 🗜️ **压缩** - 内置 PDF 压缩支持
- 🎯 **基于内容的渲染** - 使用浏览器的计算布局（`getBoundingClientRect()`）捕获元素位置，支持 Flexbox、Grid 和大多数 CSS 布局

## 📦 安装

```bash
npm install htmlpdfx.js
```

## 🚀 快速开始

```javascript
import { htmlpdf } from 'htmlpdfx.js';

// 基础用法
const element = document.getElementById('content');
const blob = await htmlpdf(element);

// 下载 PDF
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'document.pdf';
a.click();
```

## 📖 使用示例

### 基础配置

```javascript
const blob = await htmlpdf(element, {
  format: 'a4', // 页面格式：'a4'、'letter' 等
  orientation: 'portrait', // 'portrait'（纵向）或 'landscape'（横向）
  margin: 10, // 页边距（单位：px）
  compress: true, // 启用 PDF 压缩
  output: 'blob', // 输出格式：'blob'、'dataurl' 或 'arraybuffer'
});
```

### 元素级字体覆盖（`pdf-font`）

使用 `pdf-font` 属性为特定元素指定字体，不影响全局字体配置。适合文档中不同区域需要使用不同字体的场景。

> **前提**：`pdf-font` 中填写的字体名必须已在全局 `fonts` 配置中注册，否则该字体会被跳过并打印警告。

**基础用法 — 为单个元素指定字体：**

```javascript
// 第一步：在全局 fonts 中注册字体
const blob = await htmlpdf(element, {
  fonts: [
    {
      fontFamily: 'Roboto',
      fontUrl: '/fonts/Roboto-Regular.ttf',
      isDefault: true,
    },
    {
      fontFamily: 'NotoSansCJK',
      fontUrl: '/fonts/NotoSansCJK-Regular.ttf',
      charRanges: [[0x4e00, 0x9fff]],
    },
  ],
});
```

```html
<!-- 第二步：在 HTML 中通过 pdf-font 指定该元素使用哪个已注册字体 -->
<!-- 该段落强制使用 NotoSansCJK，不受全局默认字体影响 -->
<p pdf-font="NotoSansCJK">你好世界</p>
```

**多字体 — 用于单个元素内的多语言混排：**

```html
<!-- 静态属性（逗号分隔） -->
<p pdf-font="Roboto,NotoSansCJK">Hello 你好</p>

<!-- Vue 动态绑定（数组） -->
<p :pdf-font="['Roboto', 'NotoSansCJK']">Hello 你好</p>
```

当指定多个字体时，配置了 `charRanges` 的字体会按字符范围精确匹配，第一个未配置 `charRanges` 的字体作为该元素的默认兜底字体。

**`pdf-font` 元素的优先级链：**

```
pdf-font 字体（有 charRanges）
  → pdf-font 字体（无 charRanges，作元素默认）
    → 全局 charRanges 字体
      → 全局 isDefault 字体
        → helvetica
```

**精细控制 — 结合 `pdf-font` 与 `charRanges`：**

全局配置使用 Roboto 作为默认字体，但某个段落全部是中文，希望直接用 NotoSansCJK 渲染而不走 charRanges 匹配：

```javascript
// 全局配置
fonts: [
  { fontFamily: 'Roboto', isDefault: true },
  { fontFamily: 'NotoSansCJK', charRanges: [[0x4e00, 0x9fff]] },
];
```

```html
<!-- 该段落以 NotoSansCJK 作为默认字体（无需每个字符走 charRanges 匹配） -->
<p pdf-font="NotoSansCJK">全中文段落，直接用 NotoSansCJK 渲染</p>
```

---

### 自定义字体

```javascript
const blob = await htmlpdf(element, {
  fonts: [
    {
      fontFamily: 'Roboto',
      fontUrl: 'https://example.com/fonts/roboto-regular.ttf',
      fontWeight: 400,
      fontStyle: 'normal',
      isDefault: true,
    },
    {
      fontFamily: 'Roboto',
      fontUrl: 'https://example.com/fonts/roboto-bold.ttf',
      fontWeight: 700,
      fontStyle: 'normal',
    },
  ],
});
```

### 多语言混排（英文 + 中文 + 阿拉伯语）

```javascript
const blob = await htmlpdf(element, {
  fonts: [
    {
      fontFamily: 'Roboto',
      fontUrl: 'https://example.com/Roboto-Regular.ttf',
      fontWeight: 400,
      fontStyle: 'normal',
      isDefault: true, // 英文和其他拉丁字符的默认字体
    },
    {
      fontFamily: 'NotoSansCJK',
      fontUrl: 'https://example.com/NotoSansCJK-Regular.ttf',
      fontWeight: 400,
      fontStyle: 'normal',
      charRanges: [
        [0x4e00, 0x9fff], // CJK 统一表意文字（中文）
      ],
    },
    {
      fontFamily: 'NotoSansArabic',
      fontUrl: 'https://example.com/NotoSansArabic-Regular.ttf',
      fontWeight: 400,
      fontStyle: 'normal',
      charRanges: [
        [0x0600, 0x06ff], // 阿拉伯语
        [0x0750, 0x077f], // 阿拉伯语补充
      ],
    },
  ],
});
```

### 页眉和页脚

```javascript
const blob = await htmlpdf(element, {
  header: {
    height: 10, // 页眉高度（单位：mm）
    render(doc, { pageNumber, totalPages, pageWidth, margin }) {
      doc.setFontSize(9);
      doc.text('我的文档', margin, margin - 2);
      doc.text(
        `第 ${pageNumber} 页 / 共 ${totalPages} 页`,
        pageWidth - margin,
        margin - 2,
        { align: 'right' },
      );
    },
  },
  footer: {
    height: 8, // 页脚高度（单位：mm）
    render(doc, { pageNumber, totalPages, pageWidth, pageHeight, margin }) {
      doc.setFontSize(8);
      doc.text(
        `${pageNumber} / ${totalPages}`,
        pageWidth / 2,
        pageHeight - margin + 4,
        { align: 'center' },
      );
    },
  },
});
```

### 分页控制

```html
<!-- 在此元素前强制分页 -->
<div page-break="before">此内容从新页开始</div>

<!-- 避免在此元素内分页 -->
<div page-break="avoid">此内容不会被拆分到多页</div>
```

> **自动 avoid**：`TR`、`SVG` 和 `VIDEO` 元素无需设置任何属性，自动获得 `page-break="avoid"` 效果——这些元素永远不会被跨页截断。

### 表头重复

通过 `tables` 添加表格选择器和表头选择器：

```html
<table id="my-table">
  <thead id="my-table-header">
    <tr>
      <th>姓名</th>
      <th>邮箱</th>
      <th>部门</th>
    </tr>
  </thead>
  <tbody>
    <!-- 表格行... -->
  </tbody>
</table>
```

```javascript
const blob = await htmlpdf(element, {
  tables: [
    {
      selector: '#my-table',
      repeatHeader: '#my-table-header',
    },
  ],
});
```

### 伪元素

htmlpdf 支持 `::before` 和 `::after` 伪元素，但**仅支持字符串内容**：

```css
/* ✅ 支持：字符串内容 */
.icon::before {
  content: '✓ ';
  color: green;
}

.badge::after {
  content: 'NEW';
  background: red;
  color: white;
}

/* ✅ 支持：Unicode 转义 */
.star::before {
  content: '\2605'; /* ★ */
}

/* ❌ 不支持：计数器、attr()、url() */
.item::before {
  content: counter(item); /* 不支持计数器 */
}
```

**计数器的替代方案**：在导出前使用 JavaScript 生成编号元素：

```javascript
// 导出 PDF 前
document.querySelectorAll('.step-list li').forEach((li, index) => {
  const span = document.createElement('span');
  span.className = 'step-number';
  span.textContent = index + 1;
  li.insertBefore(span, li.firstChild);
});

// 然后导出
await htmlpdf(element);
```

## 📚 API 参考

### `htmlpdf(element, options)`

将 HTML 元素转换为 PDF。

#### 参数

- **element** `HTMLElement` - 要转换的 DOM 元素
- **options** `Object` - 配置选项

#### 选项

| 选项 | 类型 | 默认值 | 描述 |
| --- | --- | --- | --- |
| `output` | `string` | `'blob'` | 输出格式：`'blob'`、`'dataurl'` 或 `'arraybuffer'` |
| `format` | `string` | `'a4'` | 页面格式（任何 jsPDF 支持的格式） |
| `orientation` | `string` | `'portrait'` | 页面方向：`'portrait'`（纵向）或 `'landscape'`（横向） |
| `margin` | `number` | `0` | 页边距（单位：px） |
| `compress` | `boolean` | `true` | 启用 PDF 压缩 |
| `fonts` | `Array` | `[]` | 自定义字体配置 |
| `header` | `Object` | - | 页眉配置 `{ height: mm, render(doc, info) }` |
| `footer` | `Object` | - | 页脚配置 `{ height: mm, render(doc, info) }` |
| `tables` | `Array` | `[]` | 表格配置，例如 `[{ selector: '#t1', repeatHeader: 'thead', pageBreakBorder: '1px solid #ccc' }]` |
| `debug` | `boolean` | `false` | 在控制台打印每个阶段的计时日志 |
| `onProgress` | `Function` | - | 进度回调 `({ stage, progress: 0~1 }) => void`。阶段值：`'clone'`、`'images'`、`'fonts'`、`'paginate'`、`'render'`、`'output'` |

#### 字体配置

每个字体配置对象支持以下字段：

| 字段 | 类型 | 必需 | 描述 |
| --- | --- | --- | --- |
| `fontFamily` | `string` | ✅ | 字体族名称（例如 `'Roboto'`、`'NotoSansCJK'`） |
| `fontUrl` | `string` | \* | .ttf 字体文件的 URL（如未提供 `fontBase64` 则必需） |
| `fontBase64` | `string` | \* | Base64 编码的字体数据（如未提供 `fontUrl` 则必需） |
| `fontWeight` | `number\|string` | ❌ | 字体粗细：`400`、`700`、`'bold'` 等（默认：`400`） |
| `fontStyle` | `string` | ❌ | 字体样式：`'normal'` 或 `'italic'`（默认：`'normal'`） |
| `isDefault` | `boolean` | ❌ | 如果为 `true`，此字体用于所有未被 `charRanges` 匹配的字符 |
| `charRanges` | `Array<[number, number]>` | ❌ | 此字体的 Unicode 范围，例如 `[[0x4E00, 0x9FFF]]` 表示 CJK |

**字体选择规则：**

1. **charRanges 优先**：字符首先与具有 `charRanges` 的字体按数组顺序匹配
2. **isDefault 回退**：如果没有 `charRanges` 匹配，使用标记为 `isDefault: true` 的字体
3. **Helvetica 回退**：如果没有匹配（无 `isDefault`，也无命中的 `charRanges`），回退到内置的 `helvetica`

**示例：多语言混排**

```javascript
fonts: [
  {
    fontFamily: 'NotoSansCJK',
    fontUrl: 'https://example.com/NotoSansCJK-Regular.ttf',
    charRanges: [[0x4e00, 0x9fff]], // 中文字符
  },
  {
    fontFamily: 'Roboto',
    fontUrl: 'https://example.com/Roboto-Regular.ttf',
    isDefault: true, // 用于所有其他字符（英文、数字等）
  },
];
```

**注意：**

- `charRanges` 和 `isDefault` 互斥（每个字体只能使用其中一个）
- 当多个字体的 `charRanges` 重叠时，数组顺序决定优先级
- 字体按 URL 缓存在页面生命周期内；更改 URL 是清除缓存的正确方式

#### 返回值

返回一个 `Promise`，解析为：

- `Blob` - 如果 `output` 为 `'blob'`
- `string` - 如果 `output` 为 `'dataurl'`
- `ArrayBuffer` - 如果 `output` 为 `'arraybuffer'`

## 🎨 支持的 CSS 特性

### ✅ 完全支持

- **文本**：`color`、`fontSize`、`fontFamily`、`fontWeight`、`fontStyle`、`textAlign`、`lineHeight`、`textDecoration`
- **背景**：纯色（`background-color`）、线性渐变（`linear-gradient()`）、背景图片（`background-image: url(...)`），支持 `background-size` 和 `background-position`
- **边框**：所有边框样式（`border-width`、`border-color`、`border-style`）。注意：`border-radius` 会被读取但**不会渲染**（不支持圆角绘制）
- **图片**：`<img>` 标签，支持跨页裁切
- **画布**：`<canvas>` 元素，支持跨页裁切
- **伪元素**：`::before` 和 `::after`，支持字符串内容
- **RTL/BiDi**：从右到左的文本（阿拉伯语、希伯来语），自动文本重排序

### ⚠️ 布局注意事项

**基于内容的定位**：htmlpdf 使用浏览器的计算布局（通过 `getBoundingClientRect()`）来确定元素位置。这意味着：

- ✅ **Flexbox 和 Grid 布局可以工作** - 由 flex/grid 定位的元素会在其计算位置渲染
- ✅ **大多数布局能正确渲染** - 只要浏览器正确计算位置，htmlpdf 就能捕获它们

**但是，对于表格特别需要注意：**

- ✅ **使用原生 `<table>` 标签** - 推荐用于表格数据，特别是使用表头重复等功能时
- ⚠️ **避免用 flex/grid 做表格** - 虽然技术上支持，但使用 `display: flex` 或 `display: grid` 创建类表格布局可能会在表格特定功能（重复表头、表格内分页）时产生意外行为

**性能优化建议：**

- ⚡ **保持 HTML 结构简单** - htmlpdf 递归遍历 DOM 树；深度嵌套的元素会显著增加处理时间
- ⚡ **减少包裹元素** - 尽可能避免不必要的 `<div>` 包裹层
- ⚡ **扁平化复杂布局** - 在生成 PDF 前简化嵌套的 flex/grid 结构可以获得更好的性能

**示例 - 性能优化：**

```html
<!-- ❌ 避免：深度嵌套结构 -->
<div class="wrapper">
  <div class="container">
    <div class="row">
      <div class="col">
        <div class="card">
          <div class="card-body">
            <p>内容</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ✅ 更好：扁平化结构 -->
<div class="content">
  <p>内容</p>
</div>
```

**示例 - 推荐的表格结构：**

```html
<!-- ✅ 推荐：原生表格 -->
<table>
  <thead>
    <tr>
      <th>列 1</th>
      <th>列 2</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>数据 1</td>
      <td>数据 2</td>
    </tr>
  </tbody>
</table>

<!-- ⚠️ 不推荐用于表格：Flex/Grid -->
<div style="display: grid; grid-template-columns: 1fr 1fr;">
  <div>列 1</div>
  <div>列 2</div>
  <div>数据 1</div>
  <div>数据 2</div>
</div>
```

### ⚠️ 部分支持

- **背景**：仅支持标准方向（to top/bottom/left/right、对角线方向如 `to top right`、角度值）的 `linear-gradient()`。不支持径向/锥形渐变。
- **伪元素**：仅支持 `content: "string"`。不支持计数器（`counter()`）、属性（`attr()`）和图片（`url()`）。
- **布局**：Flexbox 和 Grid 通过计算布局位置支持，但在复杂嵌套布局或表格特定功能中可能有限制。

### ❌ 不支持

- **高级布局**：变换（`rotate`、`scale`、`skew`）、浮动元素、绝对定位边缘情况
- **高级 CSS**：动画、过渡、滤镜、阴影、backdrop-filter
- **复杂边框**：边框图片、高级边框样式（double、groove、ridge、inset、outset）
- **渐变**：径向渐变、锥形渐变、重复渐变

## 🎯 浏览器支持

支持 ES6+ 的现代浏览器：

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## 🤝 贡献

欢迎贡献！请随时提交 Pull Request。

## 📄 许可证

MIT © [melon587](https://github.com/melon587)

## 🙏 致谢

基于 [jsPDF](https://github.com/parallax/jsPDF) 构建
