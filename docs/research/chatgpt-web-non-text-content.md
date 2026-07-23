# ChatGPT Web 非普通文字与富内容能力梳理

- 调研日期：2026-07-22
- 范围：ChatGPT Web 为主，同时标注会影响 Web 历史会话的跨端内容
- 来源：仅使用 OpenAI 官方帮助中心、官方产品说明和官方发布说明
- 目的：区分“消息文本能表达的内容”与“必须额外获取结构、资产或运行时才能还原的内容”

## 结论

“浏览器里普通文字以外的东西”不能只分成文字和附件两类。对会话读取器而言，更实用的是以下四级：

1. **文本可重建**：Markdown 富文本、普通链接、代码、Mermaid/SVG/Vega 源码。只要原始文本和语言标识还在，就能保存其语义；渲染视觉效果需要对应渲染器。
2. **需要结构化数据**：搜索引用、writing/code block 状态、Deep Research 报告结构、Canvas 版本与批注、交互表格和交互图表。纯文本可以降级展示，但不能保留完整体验。
3. **需要资产访问或下载**：上传图片、生成图片、上传附件、生成文件、静态图表、部分音视频、Work 文件。只返回文件名或一句说明并不等于拿到内容本体。
4. **需要专用运行时或外部服务**：React/HTML 预览、Apps 的卡片/地图/播放列表、Work Sites、原生 Google Docs/Sheets/Slides。即使拿到一段文本，也不等于复现了交互应用。

因此，工程上应分别定义：

- 能否**发现并描述**富内容；
- 能否返回**可打开的引用或资产链接**；
- 能否在授权上下文中**下载原始资产**；
- 能否**复现 ChatGPT 的交互 UI**。

这四项是递进能力，不能用一个“支持附件”布尔值概括。

## 官方确认的内容类型

### 1. 富文本、writing blocks 与 code blocks

**官方事实**

ChatGPT 的 writing block 支持粗体、斜体、标题、链接、项目列表、编号列表和 checklist。Code block 除了展示代码，还可能支持编辑、全屏、运行 Python、分享只读链接，以及在 Code/Preview 之间切换。官方列出的可预览内容包括 HTML、React、SVG、Mermaid 和 Vega/Vega-Lite 图表。[Working with writing blocks and code blocks in ChatGPT](https://help.openai.com/en/articles/20001246-working-with-writing-blocks-and-code-blocks-in-chatgpt)

**工程推断**

- 标题、列表、普通 Markdown 链接、代码、Mermaid/SVG/Vega 源码，本质上可以保存在文本中。
- Mermaid 图并不是必须下载的二进制图片：若原始 Mermaid 源码和 block 语言标识仍在，可以重新渲染。
- 但 ChatGPT 内的“可编辑 block、预览、运行、分享、保存后的编辑状态”不是普通文本；完整还原至少需要 block 类型、语言、最新内容和相关状态。
- HTML/React 的视觉结果需要沙箱运行时；如果代码依赖外部资源，还可能需要网络访问和用户授权，不能把“拿到源码”等同于“拿到浏览器中的最终画面”。

### 2. 上传图片与生成图片

**官方事实**

ChatGPT Web 支持把静态图片作为输入，官方列出 PNG、JPEG 和非动画 GIF；不支持把视频当作普通图像输入。[ChatGPT Image Inputs FAQ](https://help.openai.com/en/articles/8400551-image-inputs-for-chatgpt)

ChatGPT 也能在会话中创建和编辑图片；生成图片会进入 Images，用户可以复制、保存下载或分享。[Images in ChatGPT](https://help.openai.com/en/articles/11084440-chatgpt-image-library)

**工程推断**

- 图片说明、文件名和 alt text 都不能替代像素本体。
- 最低限度需要图片资产引用，以及 MIME 类型、尺寸等元数据；要真正交付图片，还需要带授权的读取或下载能力。
- 图片编辑器的选区、编辑历史和不同版本属于额外状态，单张最终图片不能完整表达编辑过程。

### 3. 上传附件、生成文件与 Library

**官方事实**

ChatGPT 会把用户上传和 ChatGPT 创建的文件保存到 Library；官方举例包括文档、电子表格、演示文稿、PDF 和图片，并提供下载功能。[File storage and Library in ChatGPT](https://help.openai.com/en/articles/20001052-file-storage-and-library-in-chatgpt)

官方明确列出的常见上传格式包括 XLSX、XLS、CSV、TSV、DOCX、PPTX、PDF 和 TXT。[What types of files are supported?](https://help.openai.com/en/articles/8983675-what-types-of-files-are-supported)

**工程推断**

- 会话中的附件卡片通常至少涉及文件标识、文件名、类型、大小、来源和访问权限。
- “发现会话里有一个 PDF”与“成功下载 PDF 原文件”是两个能力。
- 资产地址可能依赖登录态或临时授权；不应假设它是永久、公开 URL。
- 来自 Google Drive、OneDrive、SharePoint 等连接来源的文件，还可能需要外部服务引用和对应账户权限。

### 4. 普通链接、搜索引用、Sources 与搜索图片

**官方事实**

ChatGPT Search 的答案可能包含行内引用；用户可以点击引用打开来源，也可以通过 Sources 面板查看引用来源和其他相关链接。搜索结果有时还会在答案顶部显示图片，点击图片可以看到引用详情及来源链接。[ChatGPT Search](https://help.openai.com/en/articles/9237897-chatgpt-search)

**工程推断**

- 普通 Markdown 链接如果 URL 已写在消息文本里，可以作为文本保留。
- 搜索引用通常还需要“正文哪一段对应哪个来源”的关联，以及标题、URL、站点等结构化元数据；只抽取可见正文会丢失可核验性。
- Sources 面板与来源图片不是普通正文。要还原它们，需要引用列表、排序、图片资产或远程图片 URL 等额外数据。

### 5. 表格、静态图与交互图表

**官方事实**

Data Analysis 可以显示表格和图表；Python 分析环境可把 pandas DataFrame 显示成交互表格。图表可能是静态图片，也可能是交互图；官方列出的交互图类型包括柱状图、折线图、饼图和散点图。[Data analysis with ChatGPT](https://help.openai.com/en/articles/8437071-data-analysis-with-chatgpt)

**工程推断**

- 普通 Markdown 表格可以从文本重建。
- DataFrame 交互表格需要结构化的行列数据，只有渲染后复制出的文字无法保留排序、筛选等体验。
- 静态图属于图片资产。
- 交互图需要数据集、图表 specification 和渲染器；截图只能保留某一时刻的外观。
- Vega/Vega-Lite code block 是另一个情况：若 spec 本身存在于代码文本中，可以重新渲染，不一定需要下载静态图。

### 6. Canvas

**官方事实**

Canvas 是用于写作和代码编辑的独立界面，支持选区编辑、行内建议、版本恢复、变更查看、Python 执行以及 React/HTML 沙箱预览。Canvas 文档可导出为 PDF、Markdown、Word，代码 Canvas 可按语言导出为相应文件。[What is the canvas feature in ChatGPT and how do I use it?](https://help.openai.com/en/articles/9930697-what-is-the-canvas-feature-in-chatgpt-and-how-do-i-use-it)

**工程推断**

- Canvas 的正文或代码可以降级成文本。
- 要保留选区、批注、版本、变更记录和执行/预览状态，需要 Canvas 专用结构。
- 导出的 PDF、DOCX 或代码文件属于单独资产，需要生成和下载能力。
- React/HTML 预览属于运行结果；源码、依赖、网络权限和沙箱环境共同决定最终画面。

### 7. Deep Research 报告

**官方事实**

完成的 Deep Research 会在全屏报告视图中展示目录、来源区和活动历史，报告包含引用或来源链接，并可下载为 Markdown、Word 和 PDF。[Deep research in ChatGPT](https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt)

**工程推断**

- 报告正文可以降级为 Markdown 或普通文本。
- 引用关系、目录、来源区、活动历史需要结构化数据。
- Word/PDF/Markdown 下载件属于生成文件；正文存在不代表下载件已经被获取。

### 8. Work 文件、运行状态与 Sites

**官方事实**

ChatGPT Work 面向较长的多步骤任务和最终交付物，可研究、分析并创建文档、电子表格、演示文稿、报告或 Site。用户可以查看进度、回答问题、改变方向并审批重要操作。[ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275)

Work 可以创建或编辑文档、电子表格、演示文稿、报告和分析，也可能通过已连接的 Google Workspace 创建原生 Docs、Sheets 和 Slides；云端创建的文件可能保存到 Library。[Creating and editing documents, spreadsheets, and presentations with ChatGPT Work](https://help.openai.com/en/articles/20001278-creating-and-editing-documents-spreadsheets-and-presentations-with-chatgpt-work)

ChatGPT Sites 可以在 Work 中创建、预览、发布和分享交互网站或轻量应用；部署后会生成 Site URL。官方说明 Site 会涉及代码、生成资产、托管 URL、存储和运行数据。[Creating and managing ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-managing-chatgpt-sites)

**工程推断**

- Work 会话中的解释文字只是过程的一部分，不能代表最终交付物。
- Work 文件需要文件资产或外部文档引用；原生 Google 文件还需要 provider、文档 ID/URL 和相应授权。
- Work 的运行进度、问题、审批和活动记录属于任务状态或事件流，不等同于最终 transcript。
- Site 是托管应用：只拿到聊天文字或一段代码，无法等价获得已部署 Site、其资源和运行状态。

### 9. Apps 与专用 widgets

**官方事实**

ChatGPT Apps 有些会在会话中提供富交互体验，官方示例包括 interactive cards、maps 和 playlists；另一些 App 会从外部服务检索、引用信息或执行动作。[Apps in ChatGPT](https://help.openai.com/en/articles/11487775-apps-in-chatgpt)

**工程推断**

- 这类内容通常需要 provider/tool payload、结构化字段、资产 URL 和应用运行时。
- 文本摘要可以作为兼容性降级，但无法保留卡片操作、地图交互、播放状态或第三方动作。
- 不同 App 的 payload 未必能由一个通用 Markdown schema 完整表达。

### 10. Voice 的 transcript、音频与视频

**官方事实**

Voice 可在 ChatGPT Web 使用。Voice 结束后会把 transcript 加入聊天历史；官方同时说明 Live/Advanced Voice 的音频片段以及 Advanced Voice 的视频片段会与 transcript 关联保存一段时间。Standard 模式的音频在完成转录后通常会删除。Live 当前也不一定适用于 Work 或 Codex。[ChatGPT Voice](https://help.openai.com/en/articles/20001274)

**工程推断**

- transcript 是文本近似，不是原始音频的可逆表示。
- 若产品仍保留音视频片段，读取媒体本体需要媒体引用、格式、时长、权限和下载/流式读取能力。
- 某些模式下原始音频已被官方删除，因此历史读取器最多只能得到 transcript，不能承诺恢复不存在的媒体。

## 面向会话读取器的建议内容模型

以下是基于上述官方能力做出的工程建议，不是 OpenAI 公布的 ChatGPT 私有后端 schema：

| 建议类型 | 最低可用数据 | 完整支持还需要 |
|---|---|---|
| `text` / `markdown` | 原始文本 | 格式或安全渲染器 |
| `link` / `citation` | URL、标题 | 正文区间映射、来源面板元数据 |
| `code` / `diagram_source` | 源码、语言 | Preview/Run 状态、沙箱运行时 |
| `image` | 资产引用、MIME | 授权读取、缩略图、尺寸、版本 |
| `file` | 文件引用、名称、类型 | 授权下载、大小、来源、校验信息 |
| `table` | 行列结构 | 排序、筛选、分页等交互状态 |
| `chart` | 图片或数据/spec | 交互图渲染器与状态 |
| `artifact` | 类型、标题、引用 | Canvas/报告/Work/Site 专用结构 |
| `media` | 媒体引用、类型 | 时长、编码、授权播放或下载 |
| `widget` | provider、摘要 | App payload、资源与专用 runtime |

## 支持等级建议

为了避免“支持图片/附件”产生歧义，建议每种内容分别标注：

- `detected`：能识别它存在，并返回类型及基本元数据；
- `referenced`：能返回可打开的引用或链接；
- `downloadable`：能在授权上下文中下载原始内容；
- `renderable`：能安全渲染静态视觉结果；
- `interactive`：能复现编辑、运行或应用交互。

例如，Mermaid 可以是 `detected + renderable` 而不涉及附件下载；上传 PDF 可能是 `detected + downloadable` 但不一定可在线渲染；Work Site 即使有 URL，也不代表读取器拥有其代码、资产或交互运行时。

## 边界与时效性

- ChatGPT 的功能会因 plan、workspace 设置、设备、模型和灰度发布而变化；官方 writing/code blocks 文档也明确说明可用操作存在这些差异。
- 本文是能力分类，不声称每个账户、每个会话或每个 Work 都会出现全部内容。
- 官方帮助文档证明的是产品能力，不证明某个未公开的 ChatGPT Web endpoint 一定返回哪些字段。
- 所有“需要什么字段、资产或 runtime”的描述均为工程推断，应再通过隐私安全的 schema 观察和测试确认。
