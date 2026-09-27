/**
 * 单文件 portable：把服务端 + 整个 dist/ 打成 runtime.pak，
 * 供 main.rs include_bytes! 内嵌，首次运行解到 exe 旁 folio-data/runtime/<version>/。
 *
 * 两个变体：
 *   默认      内嵌 pkg 出的 folio-server.exe（本机无需 Node）
 *   --lite   内嵌 folio-server.cjs（启动时调用户本机的 node 跑）
 * 数据段整体 gzip（main.rs 用 flate2 一次解压），files 的 offset/len 指解压后流。
 * 格式与 main.rs parse_pak 对应：[u32 LE manifest 长度][manifest JSON][gzip 数据块]。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { repoRoot } from './desktop-pnpm.mjs';

const lite = process.argv.includes('--lite');
const resources = path.join(repoRoot, 'desktop', 'src-tauri', 'resources');
const serverEntry = lite
    ? ['folio-server.cjs', path.join(resources, 'folio-server.cjs')]
    : [
        'folio-server.exe',
        path.join(
            repoRoot,
            'desktop',
            'src-tauri',
            'binaries',
            'folio-server-x86_64-pc-windows-msvc.exe',
        ),
    ];
const distDir = path.join(repoRoot, 'dist');
const out = path.join(resources, 'runtime.pak');

function walk(dir, base = dir) {
    const rels = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) rels.push(...walk(abs, base));
        else rels.push(path.relative(base, abs).split(path.sep).join('/'));
    }
    return rels.sort();
}

// dist 必须是桌面构建（VITE_FOLIO_DESKTOP=1，index.html 会带上 meta 标记）——
// 打过无标记的包会丢标题栏（无边框窗的拖窗/最小化/关闭全是前端自绘的）。
const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
if (!indexHtml.includes('name="folio-desktop" content="1"')) {
    console.error('dist/ 不是桌面构建（缺 folio-desktop=1 标记）——先跑 scripts/desktop-build.mjs');
    process.exit(1);
}

// dist 不逐文件进包：先打成单个 dist.pak（同 [manifest][blob] 格式、内层不压缩，
// 外层 gzip 会整体压）。运行时只落 server + dist.pak 两个文件，
// 静态资源由服务端从内存切片直读——Windows 建 766 个小文件要过杀软，实测 ~3s。
const distFiles = walk(distDir);
const distEntries = [];
const distBlobs = [];
let distOffset = 0;
for (const rel of distFiles) {
    const buf = fs.readFileSync(path.join(distDir, rel));
    distEntries.push({ path: rel, offset: distOffset, len: buf.length });
    distBlobs.push(buf);
    distOffset += buf.length;
}
const distManifest = Buffer.from(JSON.stringify({ files: distEntries }));
const distHead = Buffer.alloc(4);
distHead.writeUInt32LE(distManifest.length, 0);
const distPak = Buffer.concat([distHead, distManifest, ...distBlobs]);

const inputs = [serverEntry, ['dist.pak', distPak]];

const hash = crypto.createHash('sha256');
const files = [];
const blobs = [];
let offset = 0;
for (const [name, src] of inputs) {
    const buf = Buffer.isBuffer(src) ? src : fs.readFileSync(src);
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
const packed = zlib.gzipSync(Buffer.concat(blobs), { level: 9 });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, manifest, packed]));
console.log(
    `runtime.pak → ${out}（${lite ? 'lite ' : ''}${files.length} 个文件，`
        + `原始 ${(offset / 1048576).toFixed(1)} MB → gzip ${(packed.length / 1048576).toFixed(1)} MB）`,
);
