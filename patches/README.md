# patches/ — 对 link 依赖的本地补丁

本仓的编辑器核 `@muyajs/core` 走 `link:../Assets/marktext-develop/packages/muya`
本地源码（无 git 仓）。对这份源码的修改无法随本仓提交，故以 unified diff
形式留档于此，保证修复可复现、可迁移。

## 源码锁

`muya-source.lock.json` 是 muya `src/` 全量文件 + `package.json` 的
SHA-256 清单，`pnpm build` 前置校验（`scripts/check-muya-source.mjs`）：
link 目标被改动 / 被上游重同步时构建直接失败并列出变动文件。

- 有意改 muya 源码后：`pnpm lock:muya` 重置基线；若是修复，同步更新本目录补丁。
- 手动校验：`pnpm check:muya`。
- 换了 muya 源码版本（整树替换）后同样 `pnpm lock:muya`。

## 补丁应用方式

在 muya 包根（`packages/muya`，即 `src/` 的上一级）执行：

```bash
cd ../Assets/marktext-develop/packages/muya
git apply /path/to/mimi-folio/patches/muya-copy-nested-list.patch
```

校验（不落盘）：`git apply --check <patch>`。

## 补丁清单

| 文件 | 说明 |
|---|---|
| `muya-copy-nested-list.patch` | 修嵌套列表内复制：`collectSameOutMostBlockState` 原把祖先容器一路包成无正文的空 item，序列化成 `1. 1. 1. text`，粘贴后嵌套乱号。改为下钻到两端点最深公共容器再发射；裸 `list-item` 回退父级 list。含 `copyWithinContainer.spec.ts` 回归用例。 |
