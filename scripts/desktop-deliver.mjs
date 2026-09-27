/**
 * portable 交付：把 release 产物复制成单文件 mimi-folio.exe。
 * 目标目录用 FOLIO_PORTABLE_DIR 覆写，默认 D:\Programs\MimiFolio。
 */
import fs from 'node:fs';
import path from 'node:path';

import { repoRoot } from './desktop-pnpm.mjs';

const targetDir = process.env.FOLIO_PORTABLE_DIR ?? 'D:\\Programs\\MimiFolio';
const exe = path.join(repoRoot, 'desktop', 'src-tauri', 'target', 'release', 'folio-desktop.exe');
const out = path.join(targetDir, 'mimi-folio.exe');

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(exe, out);
// 分发合规：exe 内嵌了 muya 全家桶编译产物，许可通告随交付目录走
for (const f of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) {
    fs.copyFileSync(path.join(repoRoot, f), path.join(targetDir, f));
}
console.log(`portable → ${out}（+ LICENSE / THIRD-PARTY-NOTICES.md）`);
