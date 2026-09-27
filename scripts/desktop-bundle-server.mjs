import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'desktop', 'src-tauri', 'resources', 'folio-server.cjs');

await esbuild.build({
    entryPoints: [path.join(root, 'src', 'server', 'desktop-sidecar.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: out,
    packages: 'external',
    target: 'node22',
});

console.log(`folio server bundle → ${out}`);
