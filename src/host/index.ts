import { MimiHost } from './mimi.ts';
import { StandaloneHost } from './standalone.ts';
import { detectHostKind, type FolioHost } from './types.ts';

export type { FolioDoc, FolioHost, FolioImage, FolioIndex, FolioListItem, FolioPath } from './types.ts';
export { detectHostKind } from './types.ts';
export { MimiHost } from './mimi.ts';
export { StandaloneHost } from './standalone.ts';

/** 页面唯一入口：拿 host，编辑器只认 FolioHost，不关心底下是磁盘还是 daemon。 */
export function createHost(): FolioHost {
    return detectHostKind() === 'mimi' ? new MimiHost() : new StandaloneHost();
}
