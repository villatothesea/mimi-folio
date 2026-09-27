import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function toolBin(name) {
    return path.join(repoRoot, 'node_modules', name);
}
