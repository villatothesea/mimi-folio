/**
 * Tauri beforeBuildCommand：打 dist（带 VITE_FOLIO_DESKTOP）并 esbuild + pkg 服务端。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { repoRoot, toolBin } from './desktop-pnpm.mjs';

function run(cmd, args, env = {}) {
    const r = spawnSync(cmd, args, {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, ...env },
        shell: false,
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
}

const lite = process.argv.includes('--lite');

run(process.execPath, [path.join(toolBin('typescript/lib'), 'tsc.js'), '-p', repoRoot]);
run(process.execPath, [path.join(toolBin('vite/bin'), 'vite.js'), 'build'], { VITE_FOLIO_DESKTOP: '1' });
run(process.execPath, [path.join(repoRoot, 'scripts', 'desktop-bundle-server.mjs')]);
if (!lite)
    run(process.execPath, [path.join(repoRoot, 'scripts', 'desktop-pkg-server.mjs')]);
run(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'desktop-pack-runtime.mjs'), ...(lite ? ['--lite'] : [])],
);
