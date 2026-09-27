/**
 * Tauri beforeDevCommand：独立端口 + 桌面构建标记，不影响日常 pnpm dev (5173)。
 */
import { spawn } from 'node:child_process';

import path from 'node:path';

import { repoRoot, toolBin } from './desktop-pnpm.mjs';

const root = repoRoot;
const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
const workspaces = path.join(home, '.folio-desktop', 'workspaces.json');

const env = {
    ...process.env,
    VITE_FOLIO_DESKTOP: '1',
    FOLIO_WORKSPACES: workspaces,
};

const child = spawn(
    process.execPath,
    [path.join(toolBin('vite/bin'), 'vite.js'), '--host', '127.0.0.1', '--port', '5174'],
    { cwd: root, stdio: 'inherit', env, shell: false },
);

child.on('exit', (code) => process.exit(code ?? 0));
