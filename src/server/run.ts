/**
 * 独立模式整服入口：`pnpm start` / 直接 node 本文件。
 */
import { pathToFileURL } from 'node:url';

import { createAppServer } from './main.ts';
import { vaultRoot } from './api.ts';
import { bootStamp } from './bootlog.ts';

export function startStandaloneServer(): void {
    const port = Number(process.env.PORT ?? 3789);
    createAppServer().listen(port, '127.0.0.1', () => {
        bootStamp('listening');
        console.log(`米素独立服务 http://127.0.0.1:${port}  vault=${vaultRoot()}`);
    });
    // 静默消失盘查：服务端死法也进 boot-log（kill 无 exit 事件，SIGTERM/异常才有）
    process.on('SIGTERM', () => { bootStamp('SIGTERM'); process.exit(0); });
    process.on('SIGINT', () => { bootStamp('SIGINT'); process.exit(0); });
    process.on('uncaughtException', (err) => { bootStamp(`uncaughtException ${err.message}\n${err.stack ?? ''}`); });
    process.on('unhandledRejection', (err) => { bootStamp(`unhandledRejection ${String(err)}`); });
    process.on('exit', (code) => { bootStamp(`exit code=${code}`); });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    startStandaloneServer();
}
