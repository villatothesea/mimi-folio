/**
 * 单文件 portable：把 pkg 出的 folio-server.exe + 整个 dist/ 打成 runtime.pak，
 * 供 main.rs include_bytes! 内嵌，首次运行解到 exe 旁 folio-data/runtime/。
 * 格式与 main.rs parse_pak 对应：[u32 LE manifest 长度][manifest JSON][按序数据块]。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { repoRoot } from './desktop-pnpm.mjs';

const serverExe = path.join(
    repoRoot,
    'desktop',
    'src-tauri',
    'binaries',
    'folio-server-x86_64-pc-windows-msvc.exe',
);
const distDir = path.join(repoRoot, 'dist');
const out = path.join(repoRoot, 'desktop', 'src-tauri', 'resources', 'runtime.pak');

function walk(dir, base = dir) {
    const rels = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) rels.push(...walk(abs, base));
        else rels.push(path.relative(base, abs).split(path.sep).join('/'));
    }
    return rels.sort();
}

const inputs = [
    ['folio-server.exe', serverExe],
    ...walk(distDir).map((rel) => [`dist/${rel}`, path.join(distDir, rel)]),
];

const hash = crypto.createHash('sha256');
const files = [];
const blobs = [];
let offset = 0;
for (const [name, abs] of inputs) {
    const buf = fs.readFileSync(abs);
    hash.update(buf);
    files.push({ path: name, offset, len: buf.length });
    blobs.push(buf);
    offset += buf.length;
}

const manifest = Buffer.from(
    JSON.stringify({ version: hash.digest('hex').slice(0, 16), files }),
);
const head = Buffer.alloc(4);
head.writeUInt32LE(manifest.length, 0);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, manifest, ...blobs]));
console.log(`runtime.pak → ${out}（${files.length} 个文件，${(offset / 1048576).toFixed(1)} MB）`);
