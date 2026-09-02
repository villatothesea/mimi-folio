import type { FolioDoc, FolioHost, FolioImage, FolioListItem, FolioPath } from './types';

/**
 * 独立开发：读写本仓 vault/。单元 0 用本地小服务或 Vite 中间件接上。
 * 浏览器里不能直读盘，此类跑在 node 侧，页面只 fetch 同源 /api。
 */
export class StandaloneHost implements FolioHost {
    constructor(public readonly vaultDir: string) {}

    async read(_path: FolioPath): Promise<FolioDoc> {
        throw new Error('StandaloneHost.read：单元 0 接磁盘');
    }

    async write(_path: FolioPath, _markdown: string): Promise<void> {
        throw new Error('StandaloneHost.write：单元 0 接磁盘');
    }

    async list(): Promise<FolioListItem[]> {
        throw new Error('StandaloneHost.list：单元 0 接磁盘');
    }

    async saveImage(_bytes: Uint8Array, _hint: string): Promise<FolioImage> {
        throw new Error('StandaloneHost.saveImage：单元 4');
    }
}
