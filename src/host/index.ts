import { MimiHost } from './mimi';
import { StandaloneHost } from './standalone';
import { detectHostKind, type FolioHost } from './types';

export type { FolioDoc, FolioHost, FolioImage, FolioIndex, FolioListItem, FolioPath } from './types';
export { detectHostKind } from './types';
export { MimiHost } from './mimi';
export { StandaloneHost } from './standalone';

export function createHost(vaultDir: string): FolioHost {
    return detectHostKind() === 'mimi' ? new MimiHost() : new StandaloneHost(vaultDir);
}
