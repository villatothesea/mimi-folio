# 米素（folio）

米米的记忆底座：人看、米米整理的本地 markdown。预览即编辑，落盘仍是 `.md`。编辑核 [Muya](https://github.com/marktext/marktext)（MIT，单元 1 接入）。

独立开发，合进米米时只换 `src/host/`。纪律见 `AGENTS.md`，步骤见 `docs/计划.md`。

```bash
pnpm install
pnpm dev     # vite + 同端口 /folio/v1/* 小服务
pnpm build   # 类型检查 + 产 dist/
pnpm start   # 独立整服：同端口端 dist/ + API（node ≥ 22.18，直跑 TS）
```

vault 目录约定：`notes/` 长文、`memos/` 速记、`attachments/` 图/音/视频。内容不入库，只留示例。
