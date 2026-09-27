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
console.log(`portable → ${out}`);
