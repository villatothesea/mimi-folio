import type { FolioAttachment, FolioDoc, FolioHost, FolioImage, FolioIndex, FolioListItem, FolioListOpts, FolioPath } from './types';

/**
 * 合入米米时填实：打 daemon 的 /folio/v1/*。
 * 现在调用即抛，防止独立开发误走到空实现还以为存上了。
 */
export class MimiHost implements FolioHost {
    async read(_path: FolioPath): Promise<FolioDoc> {
        throw new Error('MimiHost：合入前未接 daemon');
    }

    async write(_path: FolioPath, _markdown: string): Promise<void> {
        throw new Error('MimiHost：合入前未接 daemon');
    }

    async list(_opts: FolioListOpts = {}): Promise<FolioListItem[]> {
        throw new Error('MimiHost：合入前未接 daemon');
    }

    async saveImage(_bytes: Uint8Array, _hint: string): Promise<FolioImage> {
        throw new Error('MimiHost：合入前未接 daemon');
    }

    async saveFile(_bytes: Uint8Array, _hint: string): Promise<FolioAttachment> {
        throw new Error('MimiHost：合入前未接 daemon');
    }

    async linkOutside(_absSource: string): Promise<FolioPath> {
        throw new Error('MimiHost：合入前未接 daemon');
    }

    async index(_path: FolioPath): Promise<FolioIndex> {
        throw new Error('MimiHost：合入前未接 daemon');
    }
}
