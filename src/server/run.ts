/**
 * 独立模式整服入口：`pnpm start` / 直接 node 本文件。
 */
import { pathToFileURL } from 'node:url';

import { createAppServer } from './main.ts';
import { vaultRoot } from './api.ts';

export function startStandaloneServer(): void {
    const port = Number(process.env.PORT ?? 3789);
    createAppServer().listen(port, '127.0.0.1', () => {
        console.log(`米素独立服务 http://127.0.0.1:${port}  vault=${vaultRoot()}`);
    });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    startStandaloneServer();
}
