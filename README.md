# 米素（folio）

米米的**记忆底座**：人看、米米整理的本地 markdown 系统。预览即编辑，落盘仍是 `.md` + 附件。编辑核 [Muya](https://github.com/marktext/marktext)（`@muyajs/core`，MIT）。

独立开发，合进米米时只换 `src/host/`。纪律见 `AGENTS.md`，步骤见 `docs/计划.md`。

## 跑起来

```bash
pnpm install
pnpm dev     # vite + 同端口 /folio/v1/* 小服务，http://localhost:5173
pnpm build   # tsc --noEmit + vite build → dist/
pnpm start   # 独立整服：同端口端 dist/ + API（node ≥ 22.18，直跑 TS）
pnpm test    # node --test，服务端 API / 解析器 / wikilink / 嵌入链接
```

`@muyajs/core` 用 `link:` 接本地检出 `../Assets/marktext-develop/packages/muya`（计划原定 `file:`，但 muya 的 `files: ["lib"]` 只打包构建产物、开发版 exports 又指向 src，`file:` 打包会丢源码，故改 `link:` 直连，需在 muya 侧 `pnpm install && pnpm build` 一次——本机已做）。它经 `@marktext/file-icons` 声明了一个 git 子依赖，仅构建期使用，已在 `pnpm-workspace.yaml` 用本地 stub 覆写。

## 这座 vault 里有什么

- `notes/` 长文、`memos/` 速记（文件名带日期前缀，时间线倒序）、`attachments/` 图/音/视频。
- **预览即编辑**：Muya 所见即所得，改动防抖自动落盘，权威永远是文件。
- **斜杠菜单**：`/` 插标题/表格/公式/Mermaid；PlantUML 与开放 HTML 块已从菜单剔除，PlantUML 服务端指向死地址（默认不出网）。
- **灰阶主题**：组件只吃 `--folio-*`，Muya 的 `--mu-*`/`--editor-*` 全量映射自同一组 token（`src/theme/muya.css`），换主题只改 `src/theme/tokens.css`。
- **本机多媒体**：粘贴截图走 `saveImage`，音视频文件走 `saveFile`，落盘 `attachments/`，md 里是相对路径，`/attachments/*` 由小服务端给页面播放。
- **三种组织方式互不冒充**：目录即分组（侧栏）、frontmatter `tags:` 筛选（标签条）、`[[wikilink]]` 连接（点击弹芯片跳转，未命中一键建页；反链面板能看见谁链过来）。
- **链接播视频**：粘贴 YouTube / B 站链接，页内出播放器；md 只存链接，白名单外不理，iframe 进不了盘。

## 合入米米

契约在 `src/host/types.ts`：`read` / `write` / `list(opts)` / `saveImage` / `saveFile?` / `index?`。独立阶段 `StandaloneHost` 打本仓小服务的 `/folio/v1/*`；合入换 `MimiHost` 打 daemon 的同名端点，编辑器不感知。探测：`?host=mimi` 或 `window.__MIMI_FOLIO__`。
