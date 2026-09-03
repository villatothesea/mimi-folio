import type { FolioAttachment, FolioDoc, FolioHost, FolioImage, FolioIndex, FolioListItem, FolioListOpts, FolioPath } from './types.ts';

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

    async list(opts: FolioListOpts = {}): Promise<FolioListItem[]> {
        const query = new URLSearchParams();
        if (opts.dir) query.set('dir', opts.dir);
        if (opts.tag) query.set('tag', opts.tag);
        if (opts.kind) query.set('kind', opts.kind);
        const qs = query.toString();
        const resp = await fetch(this.url(`/folio/v1/list${qs ? `?${qs}` : ''}`));
        return this.json<FolioListItem[]>(resp);
    }

    async saveImage(bytes: Uint8Array, hint: string): Promise<FolioImage> {
        const resp = await fetch(this.url('/folio/v1/image'), {
            method: 'POST',
            // 文件名可能含中文，头部只许 ByteString，先编码
            headers: { 'content-type': 'application/octet-stream', 'x-folio-hint': encodeURIComponent(hint) },
            // 拷进独立 ArrayBuffer，规避 Uint8Array<ArrayBufferLike> 与 BlobPart 的类型冲突
            body: new Blob([new Uint8Array(bytes)]),
        });
        return this.json<FolioImage>(resp);
    }

    async saveFile(bytes: Uint8Array, hint: string): Promise<FolioAttachment> {
        const resp = await fetch(this.url('/folio/v1/file'), {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream', 'x-folio-hint': encodeURIComponent(hint) },
            body: new Blob([new Uint8Array(bytes)]),
        });
        return this.json<FolioAttachment>(resp);
    }

    async index(path: FolioPath): Promise<FolioIndex> {
        const resp = await fetch(this.url(`/folio/v1/index?path=${encodeURIComponent(path)}`));
        return this.json<FolioIndex>(resp);
    }

    async linkOutside(absSource: string): Promise<FolioPath> {
        const resp = await fetch(this.url('/folio/v1/link'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: absSource }),
        });
        const out = await this.json<{ path: FolioPath }>(resp);
        return out.path;
    }
}
