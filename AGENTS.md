# AGENTS.md — 米素 folio

> 动手前读本文，再读 `docs/计划.md`。硬规则违反 = 返工。

## 一句话

**米素**是米米的记忆底座：人看、米米整理的一套本地 markdown 系统。对内目录名 **folio**。  
长文、速记、双链、标签、分组、多媒体都在**同一座 vault**里，落盘仍是 `.md` + 附件。编辑核是 MarkText 的 Muya（`@muyajs/core`，MIT）。

**不是** crate，**不是** 桌面壳，**不是** 米米对话窗，**不是** 嵌 memos / Obsidian。`memory.db` 仍是进提示的小档案；人读的记忆在这座 vault。

独立仓开发，最后合进米米：静态页随安装包，读写走 daemon HTTP。合入口只有 `src/host/`，见 `docs/计划.md` §合入。

## 两条原则

1. **第一性原理**：先问这页要解决什么。别做成第二只 MarkText / Obsidian / Tolaria。
2. **对抗式审查**：交之前自己攻击逻辑、事实、有没有更简单的做法。列出 3–5 个翻车点并打掉。证据：构建输出、测试、浏览器里点过，三者至少一样。

## 硬规则

1. **许可证**：禁 GPL/AGPL（Tolaria、Logseq 等只看交互）。Muya / 主题 CSS 是 MIT，抄要留版权头。新依赖先查 LICENSE。
2. **只取 Muya**：用 `../Assets/marktext-develop/packages/muya`。不要 Electron 桌面、不要 `packages/website`、不要遗留 `muyajs`。
3. **权威是文件**：编辑器状态不是真源；`getMarkdown()` 写回 host。不要自创库格式。分类只写在 md 里（目录 + frontmatter），不要第三种标签库。
4. **合入只经 Host**：业务代码不许直接 `fetch` 米米、不许 import `mimi-core`、不许嵌 GPUI。独立阶段用 `StandaloneHost`；合入只换 `MimiHost`。
5. **默认不出网**：PlantUML 公网关掉。开放 HTML 块不进斜杠。图/音/视频文件在本机附件。外链视频只播白名单站点，存的是链接不是任意 iframe。
6. **出厂源码人改、模型不改**：合入后 UI 包在程序层；笔记在资产层。禁止模型改出厂 `app.js`。
7. **一个 commit = 一个可验证单元**。主题行中文、≤50 字、说做了什么。类型：`feat` / `fix` / `docs` / `refactor` / `test` / `chore`。
8. **视觉只走 token**：色、字号、间距、圆角、图标尺寸/描边**不许写死**在组件里。只改 `src/theme/tokens.css`（或后来的主题文件覆写同一组变量）。图标 `currentColor`，吃 `--folio-fg`。开发阶段默认 **白 / 黑 / 灰**；语义色（危险/成功等）也先是灰阶，后期只换 token 值，不改结构。字体用系统 UI，不写死家族。Muya 的 `--mu-*` 必须从 `--folio-*` 映射，禁止在业务里给 Muya 喂 hex。

## 验证

- `pnpm build` 零错误。
- 动编辑器：浏览器里打开，输入 `/` 插一块、写公式、存盘再打开还在。
- 动视觉：组件里不得出现 `#` / `rgb(` / 写死字号（`src/theme/` 除外）。只改 token 值就能换脸。
- 改完自己重启 dev server，别让人关页。

## 不做

第二品牌、Tauri/Electron 壳、向量库、把 SilverBullet / memos 整应用嵌进来、Always-allow、第三种笔记库、Notion 属性库、用 `[[标签页]]` 冒充标签。
