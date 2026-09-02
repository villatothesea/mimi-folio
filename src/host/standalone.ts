import type { FolioDoc, FolioHost, FolioImage, FolioListItem, FolioPath } from './types.ts';

/**
 * 独立模式的浏览器侧实现：fetch 本仓小服务（src/server/）的 /folio/v1/*。
 * 磁盘在 node 侧，这里只管同一套 FolioHost 契约；合入换 MimiHost，编辑器不感知。
 */
export class StandaloneHost implements FolioHost {
    constructor(private readonly base = '') {}

    private url(p: string): string {
        return `${this.base}${p}`;
    }

    private async json<T>(resp: Response): Promise<T> {
        if (!resp.ok) {
            const body = (await resp.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `HTTP ${resp.status}`);
        }
        return (await resp.json()) as T;
    }

    private async send(method: string, p: string, body: unknown): Promise<void> {
        const resp = await fetch(this.url(p), {
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const err = (await resp.json().catch(() => ({}))) as { error?: string };
            throw new Error(err.error ?? `HTTP ${resp.status}`);
        }
    }

    async read(path: FolioPath): Promise<FolioDoc> {
        const resp = await fetch(this.url(`/folio/v1/doc?path=${encodeURIComponent(path)}`));
        return this.json<FolioDoc>(resp);
    }

    async write(path: FolioPath, markdown: string): Promise<void> {
        await this.send('PUT', '/folio/v1/doc', { path, markdown });
    }

    async list(): Promise<FolioListItem[]> {
        const resp = await fetch(this.url('/folio/v1/list'));
        return this.json<FolioListItem[]>(resp);
    }

    async saveImage(bytes: Uint8Array, hint: string): Promise<FolioImage> {
        const resp = await fetch(this.url('/folio/v1/image'), {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream', 'x-folio-hint': hint },
            // 拷进独立 ArrayBuffer，规避 Uint8Array<ArrayBufferLike> 与 BlobPart 的类型冲突
            body: new Blob([new Uint8Array(bytes)]),
        });
        return this.json<FolioImage>(resp);
    }
}
