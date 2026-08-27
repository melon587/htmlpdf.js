# 更新日志

本项目的所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [1.0.7] - 2026-08-27

### 🐛 Bug 修复

#### 跨域图片渲染（canvas tainted）

- **修复跨域 `<img>` 图片在 PDF 中无法渲染的问题** - 来自不同域（如 OSS / CDN）的图片，之前直接把 iframe 内已加载的 `imgEl` 绘制到 canvas，由于该元素加载时没有携带 `crossOrigin="anonymous"`，canvas 被污染后调用 `toDataURL()` 抛出 `SecurityError`，导致节点图片数据丢失，PDF 中该图片位置为空白。
  - 修复方案：`preloadImages` 现在通过 `loadImageAsBase64`（内部设置 `crossOrigin = "anonymous"`）重新请求每个 `<img>` URL，将结果转为 base64 后再解码到干净的 canvas 供裁切使用。由于源数据是同域的 data URL，canvas 不会被污染。
  - 前提条件：图片服务端必须返回 `Access-Control-Allow-Origin` 响应头。若未配置，会输出 `console.warn` 并跳过该图片（行为与修复前一致，但现在有明确提示）。

#### CSP 拦截字体加载导致文档克隆失败

- **修复 `Failed to create cloned document: A network error occurred` 崩溃** - `injectFontsToDocument` 调用 `iframeDoc.fonts.load()` 强制加载字体以确保布局测量精度。当浏览器 CSP 拦截了 iframe 内的字体请求时，`fonts.load()` 会 reject，未处理的异常一路向上穿透 `createClonedDocument`，导致整个 PDF 生成过程以一个误导性的错误信息中止。
  - 修复方案：每个 `fonts.load()` 调用都加了 `.catch()`，失败时输出 `console.warn` 并继续执行。字体加载失败属于非致命错误——仅影响布局测量精度，不影响 PDF 输出结果。

### 📦 迁移指南

无破坏性变更 - 此版本与 v1.0.6 完全向后兼容。

---

## [1.0.6] - 2026-08-17

### ✨ 新功能

#### Dashed / Dotted 边框支持 Border-Radius

- **`dashed` 边框现在支持 `border-radius`** - 圆角虚线边框完整渲染，采用 12 段整圈路径 + Blink 风格 `selectBestDashGap` 算法，使各边虚线段在圆角处均匀对齐
  - 直角边：clip 梯形 + 矩形 dash 序列（原有逻辑不变）
  - 圆角：从 `buildRoundedGeom` 计算弧段；每个 dash 块通过 `fillArcDash` 用贝塞尔内弧近似填充

- **`dotted` 边框现在支持 `border-radius`** - 圆角点线边框沿直线段和圆角弧段铺放圆点，不使用 clip，角落圆点不会被截成半圆
  - 直角边：clip 梯形 + 圆点序列（原有逻辑不变）
  - 圆角：从 `buildRoundedGeom` 弧段计算圆心；每个圆点通过贝塞尔圆 `fillDot` 填充

### ♻️ 重构

#### `border.js` → `border/` 模块拆分

- **将单文件 `border.js` 重构为 `border/` 目录**，各文件职责清晰：
  - `border/index.js` — 主入口：`drawBorder`、`drawOneSide` 路由、`drawSpillClosingLines`、跨页 clip 辅助函数
  - `border/solid.js` — solid（及 double 降级）梯形填充模型；导出 `buildSidePath` 和 `fillOneSideLayer` 供复用
  - `border/double.js` — double 边框：以 bw/3 宽度调用两次 `fillOneSideLayer`，中间留 bw/3 间隙
  - `border/dashed.js` — dashed 边框：直角矩形 dash + 圆角 `fillArcDash`
  - `border/dotted.js` — dotted 边框：直角圆点 + 圆角 `fillDot`
  - `border/rounded-geom.js` — 圆角边框公共几何：`buildRoundedGeom`（12 段整圈路径、角落元数据、线段几何）和 `selectBestDashGap`（Blink fitting 算法）；由 `dashed.js` 和 `dotted.js` 共用

### 🐛 Bug 修复

#### 多表格 Repeat-Header 冲突

- **修复多表格同页时 repeat-header 生成错误副本的问题** - 当两个表格都配置了 `repeatHeader` 且数据行出现在重叠的页码上时，旧的 `buildRepeatHeaderPageSet` 使用 `"${page}-${el}"` 字符串作为 Set key，但 `el.toString()` 始终返回 `"[object HTMLTableSectionElement]"`，导致不同表格的 thead 节点在同一页共用同一个 key，进而跳过了错误的原始表头
  - 根本原因：算法还依赖 `pageStartOffsets` 中的 `headerHeightPx` 来判断哪些页需要生成 repeat-header 副本，但 `headerHeightPx` 是由触发换页的节点决定的，并非按表格区分，导致表格 B 可能继承表格 A 的表头高度，错误地生成副本
  - 修复方案：`buildRepeatHeaderPageSet` 现在扫描每个表格的**数据行**（非 thead 节点）所在页，仅对 `page > 该表格首页` 的页生成 repeat-header 副本，不同表格各自独立计算，互不干扰
  - Map key 从 `string` 改为 `Map<number, Set<Element>>`，以 DOM 对象引用为 key，消除 `toString()` 冲突

### 🧪 测试

- **导出 `buildRepeatHeaderPageSet`** 以支持单元测试（此前为内部函数，未导出）
- **为 `buildRepeatHeaderPageSet` 新增 4 个单元测试**，覆盖：
  - `repeatHeaderManager` 为 null → 返回空 Map
  - 数据行只在首页 → 不生成任何副本
  - 数据行跨 page 1-3 → page 2 和 page 3 各生成一个副本
  - 两个表格数据行页不重叠 → 各自副本互不干扰（即本次修复的核心 bug 场景）

### 📦 迁移指南

无破坏性变更 - 此版本与 v1.0.5 完全向后兼容。

---

## [1.0.5] - 2026-07-27

### ✨ 新功能

#### Border Radius（圆角）支持

- **新增 `border-radius` 渲染** - PDF 输出现在完整支持圆角绘制
  - 新增 `src/render/radius.js` 模块：解析全部八个 `border-radius` CSS 值并生成三次贝塞尔弧形路径
  - `border.js`：重构为使用 `strokeRoundedSides()` 逐边圆角描边，支持跨页（顶部弧仅在首页绘制，底部弧仅在末页绘制）
  - `background.js`：纯色与渐变填充前先应用圆角裁切蒙版；背景图片同样遵循 `border-radius`
  - `image.js`：跨页图片裁切在首页和末页 spill 时裁切到圆角边界

#### 渲染绘制顺序（CSS §17.5.4 表格绘制顺序）

- **实现正确的 CSS 表格绘制顺序** - 与浏览器的 `TABLE → TBODY → TR → TD → text` 绘制顺序一致，确保背景和边框正确分层
  - `stream-pagination.js`：`placementOrder()` 为各类型分配渲染权重——容器 spill（TABLE/TBODY/TR）最先绘制，其次是 repeat-header，再次是 normal 节点，rowspan TD/TH 的 spill 最后绘制（覆盖同列普通格子之上）
  - 修复了 rowspan 格子背景被相邻普通格子背景错误遮盖的问题

### 🐛 Bug 修复

#### Repeat-Header 边界情况

- **修复第一行数据 TR 触发换页时 repeat-header 渲染异常** - 当第一行数据本身需要换页时，表头可能被跳过或渲染位置错误
  - `repeat-header-manager.js` 与 `stream-pagination.js`：新增联动检测——当 THEAD 检测到无法与第一行数据 TR 共享同一页时，在 THEAD 处提前触发换页，保证表头与第一行数据始终从新页顶部开始
  - 解决了 repeat-header 单独孤立停留在页面底部（下方无数据行）的问题

#### 伪元素样式继承

- **修复伪元素计算样式未正确继承父元素 CSS 属性的问题** - 部分属性（如 `color`、`fontSize`）未传播到克隆文档中物化的 `::before` / `::after` span
  - `src/utils/index.js`：扩展 `copyPseudoStyles()`，将父元素完整的文字和布局计算样式复制到注入的 span 元素中

#### `border-collapse` 表格 — 智能边框去重

- **重写 `border-collapse` 去重策略** - 旧策略始终抑制 `borderBottom` 和 `borderRight`，导致业务侧仅声明了 `bottom`/`right` 而没有 `top`/`left` 的格子内边框全部消失
  - 根本原因：业务侧 td 样式为 `top: none`、`right: 1px solid`、`bottom: 1px solid`、`left: 1px solid`，旧策略同时抑制 `bottom` 和 `right`，只剩 `left`，内边框全消失
  - `resolveCellBorderOverrides()` 新策略：检测 td 实际有值的边，只在有主边时才抑制对边
    - 横向：有 `borderTop` → 非末行时抑制 `borderBottom`；无 `borderTop` → 保留 `borderBottom`（唯一来源）
    - 纵向：有 `borderLeft` → 非末列时抑制 `borderRight`；无 `borderLeft` → 保留 `borderRight`（唯一来源）
  - 跨页安全：每对相邻格子始终只保留一侧，分割线不丢失
- **修复 `isNonLastRow` 范围** - 原来只看 section（thead/tbody/tfoot）范围，导致 thead 末行被错误认为是表格末行；现在查询整张 `<table>` 的所有 `<tr>`，thead/tbody 交界处边框去重正确

#### rowspan 合并单元格跨页入口线

- **修复 rowspan 单元格在跨页续页顶部缺少上边框的问题** - `rowspan > 1` 的 TD/TH 跨页后，新页顶部该格子的上边框线消失
  - 根本原因：`drawBorder` 只在 `isFirstPage === true` 时画 top 边。spill placement 的节点自然顶部在上一页，`isFirstPage` 始终为 `false`，入口线被跳过
  - 修复：`expandSpillPlacements`（`stream-pagination.js`）为每个节点的第一个 spill 页标记 `isFirstSpill: true`；`drawBorder`（`border.js`）在 `isFirstPage || isFirstSpill` 时画 top 线，位置为 `clipTop`（repeat-header 底部以下）
  - 涉及文件：`src/core/stream-pagination.js`、`src/render/node.js`、`src/render/border.js`

### ♻️ 重构

#### `node-parser.js` — Border Collapse 去重与辅助函数提取

- **`border-collapse` 边框去重** - `getComputedStyle` 在 `border-collapse` 表格中返回每个 td/th 各自声明的边框值，不经过合并处理。若不修正，相邻格子会产生重叠双线
  - `resolveCellBorderOverrides()`：智能检测策略——仅在有主边时才抑制对边，取代原来无条件抑制 `borderBottom`/`borderRight` 的旧策略。详见 Bug 修复小节
  - 导出 `TABLE_TAGS` 常量：包含所有表格结构标签名（TABLE、THEAD、TBODY、TFOOT、TR、TD、TH），供渲染层统一使用

- **将 `parseElement` 内的内联逻辑提取为独立辅助函数**，降低圈复杂度，提升可读性：
  - `calcRowSpanChildMaxHeight(tag, isPseudo, measEl)` — 计算 TR 内 rowspan>1 子格的最大高度
  - `getCellRowSpan(tag, isPseudo, origEl)` — 读取并缓存 `rowSpan` 属性值
  - `getMediaEl(origEl, measEl)` — 解析 `_el` 引用（IMG → 克隆，CANVAS → 原始，其他 → null）

#### `src/utils/index.js` — 共享工具函数

- **新增 `isCanvasBlank(canvas)` 工具函数**，用于检测空白 canvas 元素，从 `image-loader.js` 和 `image.js` 中提取以消除重复代码

### 📦 迁移指南

无破坏性变更 - 此版本与 v1.0.4 完全向后兼容。

---

## [1.0.4] - 2026-07-19

### 🐛 Bug 修复

#### 跨行单元格（rowspan）分页异常

- **修复含 `rowspan` 子 TD 的 TR 分页位置错误问题** - 当 TR 内存在 `rowspan > 1` 的 TD 时，该 TD 的实际高度可能超过 TR 自身的 `height`，导致该行在分页时被从单元格中间截断
  - 根本原因：`needsNewPage()` 只检查 `node.height`（TR 自身高度），未考虑更高的 rowspan 子 TD
  - 修复方案：在 `node-parser.js` 中为 TR 节点新增 `rowSpanChildMaxHeight` 字段（通过对 `rowspan > 1` 的子元素调用 `getBoundingClientRect()` 计算）。`needsNewPage()` 现在使用 `Math.max(node.height, rowSpanChildMaxHeight)` 作为 avoid 推页判断的有效高度
  - 同步修复 `calcNextPageStart()`，区分文本节点裁切（返回 `currentPageBottom`）与 avoid/before 推页（返回 `node.y`），避免超大 TD 内的文本节点被错误锚定

#### 重复表头与文字视觉重叠

- **修复文本节点触发换页时与 repeat-header 发生视觉重叠的问题** - 当 `text` 节点的底部超出 `currentPageBottom` 而触发换页时，`calcNextPageStart()` 之前对文本节点特殊返回 `currentPageBottom` 而非 `node.y`，导致 `accumulatedYpx` 落入 repeat-header 区域，文字被渲染到表头之上
  - 根本原因：`calcNextPageStart()` 存在一个针对 `text` 节点的特殊分支，返回 `currentPageBottom`；该分支最初的意图是防止无限循环，但实际上对 text 节点而言该场景不可达，是无效保护
  - 修复方案：删除该特殊分支——`calcNextPageStart()` 现在对 text 保护和 avoid/before 推页统一返回 `node.y`，确保文本从新页内容区顶部（repeat-header 下方）开始渲染
  - 同步收紧 `needsNewPage()` 中 text 节点的死循环豁免条件：将 `node.height > contentHeightPx` 改为 `node.height > contentHeightPx - pageContentOffsetPx`，正确计入 repeat-header 占用的高度
  - 将 `needsNewPage()` 的参数列表从位置参数重构为解构对象，满足 ESLint `max-params` 规则

#### 背景色和边框渲染超出分页实际内容底部

- **修复 `page-break: avoid/before` 推页后，背景色和边框继续绘制到空白区域的问题** - 当节点被推到下一页后，当前页的背景色和边框本应在实际内容底部截止，但实际上延伸到了整页底部
  - 根本原因：`clipBottom` 始终等于 `ctx.contentHeight`（整页高度），不感知推页后的实际内容边界
  - 修复方案：`stream-pagination.js` 现在为每页追踪 `pageActualBottomPx`（avoid/before 推页后的实际全局 px 底部），该值通过 `placement` 对象传递，在 `renderNode()` 中转换为精确的 `clipBottom`（mm）
  - 同步修复 `page-break-lines.js`（`collectPageBreakLines`），闭合边框线现在绘制在正确位置，而不是整页底部

### ♻️ 重构

#### 文本渲染重写

- **重写 `text.js` 渲染管线** - 将布局相关职责从 `node-parser.js` 迁移到 `text.js`，降低耦合，提升可维护性
  - 修复右对齐、居中对齐文本的行宽计算错误
  - 清理多行文本坐标计算逻辑

#### 分页边框模块迁移

- **将 `page-break-lines.js` 从 `src/render/` 迁移至 `src/core/`** - 更准确地反映其作为布局/分页关注点而非渲染关注点的定位
  - 更新了所有相关引用路径，无 API 变更

#### 渲染上下文整合

- **整合渲染上下文（`context.js`）** - 将分散在各渲染模块的重复计算统一收归 `context.js`
  - 删除了 `background.js`、`border.js`、`image.js`、`text.js`、`node.js` 中约 65 行重复样板代码

### 📦 迁移指南

无破坏性变更 - 此版本与 v1.0.3 完全向后兼容。

---

## [1.0.3] - 2026-07-09

### ✨ 新功能

#### 元素级字体覆盖（`pdf-font`）

- **新增 `pdf-font` 属性** - 允许对单个元素覆盖字体，不影响全局字体配置
  - 支持单字体：`pdf-font="roboto"`
  - 支持多字体（逗号分隔）：`pdf-font="roboto,notoSansArabic"`
  - 支持 Vue 动态绑定（数组）：`:pdf-font="['roboto', 'notoSansArabic']"`
  - 配置了 `charRanges` 的字体按字符范围精确匹配；未配置 `charRanges` 的字体作为该元素的默认兜底字体
  - 优先级链：`pdf-font`（有 charRanges）> `pdf-font`（无 charRanges，作元素默认）> 全局 charRanges > 全局默认 > helvetica

### 🐛 Bug 修复

#### 文本渲染 - 多行文本坐标偏移

- **修复多行文本字符坐标偏移问题** - `processMultilineText` 之前将规范化后的文本传入 Range 作为下标，但 `textNode` 的 offset 对应的是原始文本，导致坐标测量偏差
  - 解决方案：将原始文本（`raw`）传入 Range，提取各行文本后再做规范化处理

---

## [1.0.2] - 2026-07-07

### 🐛 Bug 修复

#### 文本渲染 - 阿拉伯语连体字支持

- **修复阿拉伯语上下文字形（连体字）渲染问题** - 修改分词逻辑以保留阿拉伯语连体字
  - 问题：在保留空格 token 时，由于单词级分词导致阿拉伯语上下文字母形式被破坏
  - 解决方案：在分词时跳过空格 token，在 RTL 文本合并时通过 `join(' ')` 恢复空格
  - 阿拉伯字母现在能正确显示其上下文形式（词首、词中、词尾、独立形式）
  - 影响所有连体文字：阿拉伯语、波斯语、乌尔都语等

#### 文本渲染 - 单词间距

- **改进 LTR 文本的单词间距** - 修复英文单词之间空格丢失的问题
  - 之前的方法：保留空格 token 但破坏了阿拉伯语连体字
  - 当前方法：在分词时跳过空格，依赖浏览器度量和 RTL 合并来处理间距
  - LTR（英文）和 RTL（阿拉伯语）文本现在都能以正确的间距渲染

### 🧪 测试

- 所有 158 个单元测试通过
- 添加了连字符单词和特殊字符的综合测试用例：
  - 连字符分隔标识符：`SWSUPPORT-Programing`、`ESTGARSTD-Extend`
  - 括号表示法：`[SKU123]-(2024)`、`[INV-2024]-(001)`
  - 混合符号：`{server}-(production):[port-8080]`
  - 版本字符串：`[DOC-XYZ]-(v1.0.2)`

### 📝 文档更新

- 更新示例页面（`examples/basic.html`）添加测试用例：
  - 连字符技术标识符（产品代码、序列号）
  - 括号和圆括号组合
  - 技术文档中的特殊字符

### 📦 迁移指南

无破坏性变更 - 此版本与 v1.0.1 完全向后兼容。

---

## [1.0.1] - 2026-07-06

### 🐛 Bug 修复

#### 外部 CSS 加载

- **修复克隆 iframe 中的外部样式表加载问题** - 新增 `waitForStyleSheets()` 函数，确保所有 `<link rel="stylesheet">` 标签在渲染前完全加载
  - 外部 CSS（如 Bootstrap CDN）现在能正确应用到 PDF 输出中
  - 同时处理同域和跨域（CORS）样式表
  - 在克隆的 iframe 中添加 `<base>` 标签，修复嵌套 iframe 场景下的相对路径解析问题
  - 每个样式表实现 10 秒超时机制，防止无限期阻塞

#### 伪元素样式

- **增强伪元素样式复制** - 改进 `copyPseudoStyles()` 函数，包含之前缺失的 CSS 属性
  - 新增 `textAlign` 支持 - 确保文本对齐方式得以保留
  - 新增 Flexbox 属性支持（`alignItems`、`justifyContent`、`flexDirection`、`flexWrap`）
  - 提取 `copyBorderStyles()` 辅助函数，降低代码复杂度并通过 ESLint 检查
  - 注意：`opacity` 暂不支持（需要实现 jsPDF GState API）

### 🔧 代码质量

- **降低圈复杂度** - 重构 `copyPseudoStyles()` 以满足 ESLint 复杂度阈值（<20）
- **修复 ESLint 违规** - 解决边框样式复制中的 `no-param-reassign` 警告
- **添加调试日志** - 在 `findFontForChar()` 中实现详细日志记录，用于字体选择调试（生产环境可移除）

### 📝 文档更新

- **更新 Unicode 范围示例** - 明确说明特殊符号（★ ✓ ● ➤）需要正确配置 `charRanges`：
  - `U+2600-U+26FF` - 杂项符号（Miscellaneous Symbols）：★ ☀ ☁ ☂
  - `U+2700-U+27BF` - 装饰符号（Dingbats）：✓ ✗ ➤ ✈
  - 添加使用 `charRanges` 配置符号字体的示例

### 🧪 测试

- 所有 158 个单元测试通过
- 手动测试确认外部 CSS 和伪元素修复正常工作

### ⚠️ 已知限制

- **不支持透明度** - 带有 `opacity` 的伪元素将以完全不透明方式渲染（需要未来实现 jsPDF GState API）
- **符号字体** - 特殊字符（★ ✓）需要显式配置字体并指定适当的 `charRanges`

### 📦 迁移指南

无破坏性变更 - 此版本与 v1.0.0 完全向后兼容。

如果您遇到 PDF 输出中样式缺失的问题：

1. 确保外部 CSS 文件可访问（跨域样式表需要启用 CORS）
2. 检查 CSS 中的相对路径是否正确（现在通过 `<base>` 标签自动处理）
3. 如果伪元素 `content` 中使用特殊字符，需配置符号字体

---

## [1.0.0] - 2026-07-02

### 🎉 首次发布

htmlpdf.js 首个稳定版本 - 基于 jsPDF 的轻量级 HTML 转 PDF 转换库。

### ✨ 功能特性

#### 核心功能

- **多页渲染** - 自动将内容分割到多个 PDF 页面，智能处理分页
- **自定义字体** - 支持不同字重和样式的自定义字体族
- **多语言支持** - 渲染包含多种语言（如英文 + 中文 + 阿拉伯语）的文档，自动字体回退
- **RTL/BiDi 支持** - 原生支持从右到左的语言（阿拉伯语、希伯来语），自动文本重排序和 BiDi 算法

#### 布局与样式

- **Flexbox 和 Grid 支持** - 使用浏览器计算布局（`getBoundingClientRect()`）捕获准确的元素位置
- **伪元素** - 支持 `::before` 和 `::after` 伪元素，包括字符串内容和 Unicode 转义
- **线性渐变** - 渲染 CSS `linear-gradient()` 背景，支持：
  - 方向渐变（to top/bottom/left/right）
  - 角度渐变（deg、rad、grad、turn）
  - 多个颜色停止点和位置控制
- **CSS 属性** - 支持边框、背景、阴影、透明度、变换等

#### 分页控制

- **分页符** - 使用 `page-break="before"` 或 `page-break="avoid"` 属性控制分页
- **重复表头** - 自动在每页重复表格表头，支持可配置的选择器
- **分页边框** - 在表格和容器的分页点添加视觉边框
- **页眉和页脚** - 可自定义页眉页脚，支持页码和自定义渲染

#### 内容处理

- **跨页裁切** - 跨多页的图片和 canvas 元素自动裁切并跨页渲染
- **图片支持** - 支持常见图片格式（JPEG、PNG、GIF、WebP、SVG）
- **Canvas 支持** - 渲染 HTML5 canvas 元素，支持适当的缩放
- **文本渲染** - 准确的文本定位，支持字重、样式和装饰

#### 性能与输出

- **压缩** - 内置 PDF 压缩支持，减小文件大小
- **多种输出格式** - 导出为 Blob、Data URL 或 ArrayBuffer
- **进度跟踪** - 长时间转换的可选进度回调
- **调试模式** - 详细的性能分析计时日志

### 📦 包信息

- **大小**：约 1.6MB（未压缩）
- **依赖**：jsPDF 4.2.1
- **Node.js**：>= 14.0.0
- **模块格式**：CommonJS (dist/htmlpdf.js) 和 ESM (dist/htmlpdf.esm.js)

### 🧪 测试

- **158 个单元测试** - 全面覆盖所有核心工具和函数
  - `src/utils/` - 颜色解析、CSS 解码、字体选择、布局工具
  - `src/render/gradient.js` - 线性渐变解析和渲染
  - `src/core/repeat-header-manager.js` - 表格表头重复逻辑
  - `src/main.js` - 核心渲染管道函数
  - 分页和分页符计算
- **47 个端到端测试** - 使用 Playwright 覆盖真实场景

### 📖 文档

- 包含示例和 API 参考的完整 README（英文）
- 中文文档（README.zh-CN.md）
- 源代码中完整的 JSDoc 注释
- MIT 许可证

### 🔧 配置选项

```javascript
htmlpdf(element, {
  output: 'blob',              // 'blob' | 'dataurl' | 'arraybuffer'
  format: 'a4',                // 页面格式
  orientation: 'portrait',      // 'portrait' | 'landscape'
  margin: 0,                   // 页边距（像素）
  compress: true,              // 启用 PDF 压缩
  fonts: [...],                // 自定义字体配置
  tables: [...],               // 表格重复表头和分页边框
  header: { ... },             // 页眉配置
  footer: { ... },             // 页脚配置
  debug: false,                // 启用调试日志
  onProgress: (info) => {}     // 进度回调
})
```

### 🎯 使用场景

- 从 Web 应用程序生成 PDF 报告
- 导出仪表板和数据可视化
- 创建可打印的发票和文档
- 将 HTML 邮件转换为 PDF
- 归档网页内容以供离线查看
- 生成证书和徽章

### 🙏 致谢

构建工具：

- [jsPDF](https://github.com/parallax/jsPDF) - PDF 生成库
- [Rollup](https://rollupjs.org/) - 模块打包工具
- [Vitest](https://vitest.dev/) - 单元测试框架

---

[1.0.7]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.7
[1.0.6]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.6
[1.0.5]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.5
[1.0.4]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.4
[1.0.3]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.3
[1.0.2]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.2
[1.0.1]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.1
[1.0.0]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.0
