# Muya（@muyajs/core）设置项盘点

来源：`packages/muya/src/types.ts`（`IMuyaOptions`）与 `src/config/index.ts`（`MUYA_DEFAULT_OPTIONS`）。
本仓接线在 `src/ui/editorHost.ts` 的 `mountEditor`；**改设置项只改那里**，别散落。

## 米素当前采用的（mountEditor 里显式传）

| 选项 | 值 | 说明 |
| --- | --- | --- |
| `math` | `true` | 行内 `$..$` 与块级 `$$..$$` 公式（KaTeX 本地渲染） |
| `frontMatter` | `true` | 支持 frontmatter（面板编辑，编辑器内块已收起） |
| `footnote` | `true` | 脚注 |
| `disableHtml` | `false` | HTML 块保留（音视频 html-block 依赖）；斜杠菜单已剔除 |
| `plantumlServer` | `http://127.0.0.1:9` | 死地址，杜绝 PlantUML 公网（菜单也已剔除） |
| `mermaidTheme` | `default` | Mermaid 主题：default / dark / forest |
| `vegaTheme` | `latimes` | Vega 主题：latimes / excel / ggplot2 / quartz / vox / fivethirtyeight / dark |
| `imageAction` | 回调 | 粘贴位图 → `host.saveImage` 落盘，md 留相对路径 |
| `markdown` | 文档内容 | 初始 markdown |

另有插件级选项（`Muya.use` 时传）：`ImageEditTool.imagePathPicker`（文件选择 → saveImage）、`LinkTools.jumpClick`（外链新窗打开）。

## 其余设置项（默认值，未显式改）

**排版**

- `fontSize: 16` / `lineHeight: 1.6` — 本仓不用它，走 `--folio-*` token 映射（`--mu-font-size` 等）
- `editorFontFamily` / `codeFontSize` / `codeFontFamily` — 同上，token 映射
- `wrapCodeBlocks: false` — 代码块换行（false = 横向滚动）
- `tabSize: 4` — Tab 宽度
- `listIndentation: 1` — 列表缩进
- `bulletListMarker: '-'` / `orderListDelimiter: '.'` — 列表符号
- `frontmatterType: '-'` — frontmatter 围栏类型（- YAML / + TOML / ; JSON / { JSON）

**编辑行为**

- `autoPairBracket: true` / `autoPairMarkdownSyntax: true` / `autoPairQuote: true` — 自动配对
- `autoCheck: false` — 任务列表点选
- `autoMoveCheckedToEnd: false` — 勾选后挪到列表尾
- `preferLooseListItem: true` — 宽松列表
- `trimUnnecessaryCodeBlockEmptyLines: false` — 打开时裁剪代码块首尾空行
- `spellcheckEnabled: false` / `spellcheckHideMarks: false` — 拼写检查（浏览器原生）
- `focusMode: false` — 聚焦模式（淡化非活动段落）
- `hideQuickInsertHint: false` — 隐藏「输入 / 插入」提示
- `hideLinkPopup: false` — 隐藏链接悬浮卡

**Markdown 扩展**

- `superSubScript: true` — `H~2~O`、`X^2^`
- `isGitlabCompatibilityEnabled: true` — GitLab 语法（```math 代码块等）

**显示杂项**

- `codeBlockLineNumbers: false` — 代码块行号
- `sequenceTheme: 'hand'` — Sequence 图风格：hand / simple

**宿主钩子**

- `clipboardFilePath` / `clipboardText` — 桌面壳提供的剪贴板桥（浏览器不用）
- `getPathForFile` — 拖放文件解析盘上路径（Electron webUtils；浏览器走宿主层拖放处理）
- `json` — 初始状态树（与 `markdown` 二选一）
- `locale` — 界面语言（本仓用 `zhCN`，经 `muya.locale()`）

**不作为选项的运行时 API**（`muya.xxx()`）：`setOptions`（部分项热更）、`setContent` / `replaceContent`、`getMarkdown` / `getState` / `getTOC`、`focus` / `blur` / `selectAll`、`undo` / `redo` / `clearHistory`、`search` / `find` / `replace`、`format`（行内格式）、`updateParagraph`（段落转换）、`createTable`、`insertImage` / `pasteImage`、`insertParagraph` / `deleteParagraph` / `duplicate`、`setCursor` / `setCursorByOffset` / `getCursorOffset`、`copyAsMarkdown` / `copyAsHtml` / `copyAsRich` / `pasteAsPlainText`、`invalidateImageCache`、`destroy`。
