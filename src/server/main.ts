/**
 * 独立模式整服：`node src/server/main.ts` 后同端口端 dist/ 静态页 + /folio/v1/*。
 * dev 时不用它（vite 中间件直接挂同一套 API），它是 build 完 `pnpm start` 用的。
 */
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleFolioApi, vaultRoot } from './api.ts';

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
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

async function serveStatic(url: string, res: import('node:http').ServerResponse): Promise<boolean> {
    if (url.startsWith('/folio/v1/')) return false;
    const rel = url.split('?')[0].replace(/^\/+/, '') || 'index.html';
    let abs = path.normalize(path.join(distDir, rel));
    if (!abs.startsWith(distDir)) return false;
    try {
        const stat = await fs.stat(abs);
        if (stat.isDirectory()) abs = path.join(abs, 'index.html');
        res.setHeader('content-type', MIME[path.extname(abs)] ?? 'application/octet-stream');
        res.end(await fs.readFile(abs));
        return true;
    } catch {
        return false;
    }
}

const port = Number(process.env.PORT ?? 3789);
createServer(async (req, res) => {
    if (await handleFolioApi(req, res)) return;
    if (await serveStatic(req.url ?? '/', res)) return;
    res.statusCode = 404;
    res.end('not found');
}).listen(port, () => {
    console.log(`米素独立服务 http://localhost:${port}  vault=${vaultRoot()}`);
});
