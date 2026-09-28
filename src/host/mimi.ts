import type { FolioAttachment, FolioDoc, FolioFileAssoc, FolioHost, FolioImage, FolioIndex, FolioListItem, FolioListOpts, FolioPath, FolioSearchItem, FolioWorkspace } from './types';

/**
 * 合入米米的浏览器侧实现：同源 fetch daemon 的 /folio/v1/*。
 * 页面由 daemon HTTP 自己端（入口 URL 带 token 首访种 Cookie，之后
 * Cookie 自动跟），所以这里与 StandaloneHost 一样不感知 token。
 * 端点/方法/体形状与 StandaloneHost 逐方法对齐；409 冲突照 types
 * 注释往外抛（带 status）。pickFile / pickFolder 不实现——daemon 无对应
 * 路由，页内已降级为路径输入（folioPickSource 不给「浏览」钮），实现成
 * 501 反而更差。
 */
export class MimiHost implements FolioHost {
    private async json<T>(resp: Response): Promise<T> {
        if (!resp.ok) {
            const body = (await resp.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `HTTP ${resp.status}`);
        }
        return (await resp.json()) as T;
    }

    private async void(resp: Response): Promise<void> {
        if (!resp.ok) {
            const body = (await resp.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `HTTP ${resp.status}`);
        }
    }

    async read(path: FolioPath): Promise<FolioDoc> {
        const resp = await fetch(`/folio/v1/doc?path=${encodeURIComponent(path)}`);
        return this.json<FolioDoc>(resp);
    }

    async write(path: FolioPath, markdown: string, ifMatch?: number): Promise<void> {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (ifMatch !== undefined) headers['if-match'] = String(ifMatch);
        const resp = await fetch('/folio/v1/doc', {
            method: 'PUT',
            headers,
            body: JSON.stringify({ path, markdown }),
        });
        if (!resp.ok) {
            const err = (await resp.json().catch(() => ({}))) as { error?: string };
            const e = new Error(err.error ?? `HTTP ${resp.status}`) as Error & { status?: number };
            e.status = resp.status;
            throw e;
        }
    }

    async list(opts: FolioListOpts = {}): Promise<FolioListItem[]> {
        const query = new URLSearchParams();
        if (opts.dir) query.set('dir', opts.dir);
        if (opts.tag) query.set('tag', opts.tag);
        if (opts.kind) query.set('kind', opts.kind);
        const qs = query.toString();
        const resp = await fetch(`/folio/v1/list${qs ? `?${qs}` : ''}`);
        return this.json<FolioListItem[]>(resp);
    }

    async saveImage(bytes: Uint8Array, hint: string): Promise<FolioImage> {
        const resp = await fetch('/folio/v1/image', {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream', 'x-folio-hint': encodeURIComponent(hint) },
            body: new Blob([new Uint8Array(bytes)]),
        });
        return this.json<FolioImage>(resp);
    }

    async saveFile(bytes: Uint8Array, hint: string): Promise<FolioAttachment> {
        const resp = await fetch('/folio/v1/file', {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream', 'x-folio-hint': encodeURIComponent(hint) },
            body: new Blob([new Uint8Array(bytes)]),
        });
        return this.json<FolioAttachment>(resp);
    }

    async saveRemoteImage(url: string): Promise<FolioImage> {
        const resp = await fetch('/folio/v1/pic', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url }),
        });
        return this.json<FolioImage>(resp);
    }

    async mkdir(path: FolioPath): Promise<void> {
        const resp = await fetch('/folio/v1/mkdir', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        await this.void(resp);
    }

    async linkOutside(absSource: string): Promise<FolioPath> {
        const resp = await fetch('/folio/v1/link', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: absSource }),
        });
        const out = await this.json<{ path: FolioPath }>(resp);
        return out.path;
    }

    async openExternal(absPath: string): Promise<{ path: FolioPath }> {
        const resp = await fetch('/folio/v1/open-external', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: absPath }),
        });
        return this.json<{ path: FolioPath }>(resp);
    }

    async defaultMdStatus(): Promise<FolioFileAssoc> {
        const resp = await fetch('/folio/v1/file-assoc');
        return this.json<FolioFileAssoc>(resp);
    }

    async registerDefaultMd(): Promise<FolioFileAssoc> {
        const resp = await fetch('/folio/v1/file-assoc', { method: 'POST' });
        return this.json<FolioFileAssoc>(resp);
    }

    async linkFolder(absSource: string): Promise<{ dir: FolioPath; count: number }> {
        const resp = await fetch('/folio/v1/folderlink', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: absSource }),
        });
        return this.json<{ dir: FolioPath; count: number }>(resp);
    }

    async relinkFolder(dir: FolioPath, absSource: string): Promise<{ dir: FolioPath; count: number }> {
        const resp = await fetch('/folio/v1/folderrelink', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dir, source: absSource }),
        });
        return this.json<{ dir: FolioPath; count: number }>(resp);
    }

    private async postDocOp(op: 'move' | 'copy' | 'delete', from: FolioPath, to?: FolioPath): Promise<FolioPath | void> {
        const resp = await fetch(`/folio/v1/${op}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ from, to }),
        });
        if (!resp.ok) {
            const err = (await resp.json().catch(() => ({}))) as { error?: string };
            throw new Error(err.error ?? `HTTP ${resp.status}`);
        }
        if (resp.status === 200) return ((await resp.json()) as { path: FolioPath }).path;
    }

    moveDoc(from: FolioPath, to: FolioPath): Promise<FolioPath> {
        return this.postDocOp('move', from, to) as Promise<FolioPath>;
    }

    copyDoc(from: FolioPath, to: FolioPath): Promise<FolioPath> {
        return this.postDocOp('copy', from, to) as Promise<FolioPath>;
    }

    deleteDoc(path: FolioPath): Promise<void> {
        return this.postDocOp('delete', path) as Promise<void>;
    }

    async search(query: string): Promise<FolioSearchItem[]> {
        const resp = await fetch(`/folio/v1/search?q=${encodeURIComponent(query)}`);
        return this.json<FolioSearchItem[]>(resp);
    }

    async index(path: FolioPath): Promise<FolioIndex> {
        const resp = await fetch(`/folio/v1/index?path=${encodeURIComponent(path)}`);
        return this.json<FolioIndex>(resp);
    }

    previewUrl(path: FolioPath): string {
        const segs = path.split('/').filter(Boolean).map(encodeURIComponent);
        return `/folio/v1/preview/${segs.join('/')}`;
    }

    async listWorkspaces(): Promise<{ items: FolioWorkspace[]; activeId: string }> {
        const resp = await fetch('/folio/v1/workspaces');
        return this.json<{ items: FolioWorkspace[]; activeId: string }>(resp);
    }

    async setWorkspace(id: string): Promise<void> {
        const resp = await fetch('/folio/v1/workspace', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
        });
        await this.void(resp);
    }

    async addWorkspace(name: string, dir: string): Promise<FolioWorkspace> {
        const resp = await fetch('/folio/v1/workspaces', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, dir }),
        });
        return this.json<FolioWorkspace>(resp);
    }

    async renameWorkspace(id: string, name: string): Promise<void> {
        const resp = await fetch('/folio/v1/workspaces', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, name }),
        });
        await this.void(resp);
    }

    async deleteWorkspace(id: string): Promise<void> {
        const resp = await fetch(`/folio/v1/workspaces?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        await this.void(resp);
    }
}
