/**
 * 把 folio API 打成 Node 单文件 exe，供 Tauri sidecar 内嵌（免本机装 Node）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { repoRoot, toolBin } from './desktop-pnpm.mjs';

const root = repoRoot;
const entry = path.join(root, 'desktop', 'src-tauri', 'resources', 'folio-server.cjs');
const binDir = path.join(root, 'desktop', 'src-tauri', 'binaries');
const out = path.join(binDir, 'folio-server-x86_64-pc-windows-msvc.exe');

fs.mkdirSync(binDir, { recursive: true });

const pkgCli = path.join(toolBin('@yao-pkg/pkg'), 'lib-es5', 'bin.js');
const r = spawnSync(
    process.execPath,
    [pkgCli, entry, '-t', 'node22-win-x64', '--compress', 'GZip', '-o', out],
    { cwd: root, stdio: 'inherit', shell: false },
);
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`folio API sidecar → ${out}`);
