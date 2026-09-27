/**
 * 独立模式整服：`node src/server/main.ts` 后同端口端 dist/ 静态页 + /folio/v1/* + /attachments/*。
 * dev 时不用它（vite 中间件直接挂同一套），它是 build 完 `pnpm start` 用的。
 */
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ServerResponse } from 'node:http';

import { handleFolioApi, serveAttachment } from './api.ts';

const distDir = process.env.FOLIO_DIST
    ? path.resolve(process.env.FOLIO_DIST)
    : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
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
    let abs = path.normalize(path.join(distDir, rel));
    if (!abs.startsWith(distDir)) return false;
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
    return createServer(async (req, res) => {
        // 桌面壳拿这个头核对端口上的服务版本；旧 server 残留时新 exe 据此杀掉重启。
        if (process.env.FOLIO_BUILD) res.setHeader('X-Folio-Build', process.env.FOLIO_BUILD);
        if (await handleFolioApi(req, res)) return;
        if (await serveAttachment(req, res)) return;
        if (await serveStatic(req.url ?? '/', res)) return;
        res.statusCode = 404;
        res.end('not found');
    });
}
