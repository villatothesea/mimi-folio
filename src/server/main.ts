/**
 * 独立模式整服：`node src/server/main.ts` 后同端口端 dist/ 静态页 + /folio/v1/* + /attachments/*。
 * dev 时不用它（vite 中间件直接挂同一套），它是 build 完 `pnpm start` 用的。
 */
import { createServer } from 'node:http';
import { promises as fs, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ServerResponse } from 'node:http';

import { handleFolioApi, serveAttachment } from './api.ts';
import { bootStamp } from './bootlog.ts';

const distSpec = process.env.FOLIO_DIST
    ? path.resolve(process.env.FOLIO_DIST)
    : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');

// FOLIO_DIST 指到文件 = 桌面壳打进来的 dist.pak：
// 格式同 runtime.pak 内层 [u32 manifest 长][manifest JSON {files}][原始数据]，
// 一次读进内存，静态请求切片回——不必把几百个小文件解到盘上。
let pakBlob: Buffer | null = null;
let pakIdx = new Map<string, { offset: number; len: number }>();
try {
    if (statSync(distSpec).isFile()) {
        const buf = readFileSync(distSpec);
        const mlen = buf.readUInt32LE(0);
        const manifest = JSON.parse(buf.subarray(4, 4 + mlen).toString('utf8')) as {
            files: { path: string; offset: number; len: number }[];
        };
        pakBlob = buf.subarray(4 + mlen);
        pakIdx = new Map(manifest.files.map((f) => [f.path, f]));
        bootStamp(`dist.pak loaded ${manifest.files.length} files`);
    }
} catch {
    /* FOLIO_DIST 不存在/不是 pak 时回退按目录读盘 */
}
const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.map': 'application/json',
};

async function serveStatic(url: string, res: ServerResponse): Promise<boolean> {
    const rel = url.split('?')[0].replace(/^\/+/, '') || 'index.html';
    if (pakBlob) {
        const entry =
            pakIdx.get(rel) ?? pakIdx.get(`${rel.replace(/\/+$/, '')}/index.html`);
        if (!entry) return false;
        res.setHeader(
            'content-type',
            MIME[path.extname(rel).toLowerCase()] ?? 'application/octet-stream',
        );
        res.end(pakBlob.subarray(entry.offset, entry.offset + entry.len));
        return true;
    }
    let abs = path.normalize(path.join(distSpec, rel));
    if (!abs.startsWith(distSpec)) return false;
    try {
        const stat = await fs.stat(abs);
        if (stat.isDirectory()) abs = path.join(abs, 'index.html');
        res.setHeader('content-type', MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
        res.end(await fs.readFile(abs));
        return true;
    } catch {
        return false;
    }
}

export function createAppServer(): import('node:http').Server {
    bootStamp('createAppServer');
    // 首请求埋点：GET / = webview 导航进来；首个 /folio/ = 前端 JS 已跑起来。
    let seenPage = false;
    let seenApi = false;
    return createServer(async (req, res) => {
        const url = req.url ?? '';
        if (!seenApi && url.startsWith('/folio/')) {
            seenApi = true;
            bootStamp(`first api ${req.method} ${url.split('?')[0]}`);
        } else if (!seenPage) {
            seenPage = true;
            bootStamp(`first req ${req.method} ${url.split('?')[0]}`);
        }
        // 桌面壳拿这个头核对端口上的服务版本；旧 server 残留时新 exe 据此杀掉重启。
        if (process.env.FOLIO_BUILD) res.setHeader('X-Folio-Build', process.env.FOLIO_BUILD);
        if (await handleFolioApi(req, res)) return;
        if (await serveAttachment(req, res)) return;
        if (await serveStatic(req.url ?? '/', res)) return;
        res.statusCode = 404;
        res.end('not found');
    });
}
