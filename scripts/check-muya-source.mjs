// Locks the linked @muyajs/core source tree: SHA-256 of every file under its
// src/ plus its package.json, compared against patches/muya-source.lock.json.
// `pnpm build` runs this so a silent upstream re-sync / accidental edit of the
// link dependency fails loudly instead of drifting the build.
//
// After an intentional muya change: `pnpm lock:muya` to re-baseline, and if the
// change is a fix worth keeping, drop a patch under patches/ (see patches/README).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(repoRoot, 'patches', 'muya-source.lock.json');

const dep = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    .dependencies?.['@muyajs/core'];

if (!dep?.startsWith('link:')) {
    // Resolved from npm instead of a local tree — nothing to lock here.
    console.log(`@muyajs/core is ${dep ?? 'missing'} (not link:), skipping source lock`);
    process.exit(0);
}

const muyaRoot = join(repoRoot, dep.slice('link:'.length));
if (!existsSync(join(muyaRoot, 'package.json'))) {
    console.error(`@muyajs/core link target missing: ${muyaRoot}`);
    process.exit(1);
}

function hashFile(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function collect(dir, base, out = {}) {
    for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        if (statSync(p).isDirectory())
            collect(p, base, out);
        else
            out[relative(base, p).replaceAll('\\', '/')] = hashFile(p);
    }
    return out;
}

const files = collect(join(muyaRoot, 'src'), muyaRoot);
files['package.json'] = hashFile(join(muyaRoot, 'package.json'));

const pkg = JSON.parse(readFileSync(join(muyaRoot, 'package.json'), 'utf8'));
const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex');
const manifest = { name: pkg.name, version: pkg.version, digest, files };

if (process.argv.includes('--write')) {
    writeFileSync(lockPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`muya lock written: ${digest.slice(0, 12)} (${Object.keys(files).length} files)`);
    process.exit(0);
}

if (!existsSync(lockPath)) {
    console.error('patches/muya-source.lock.json missing — run: pnpm lock:muya');
    process.exit(1);
}

const expected = JSON.parse(readFileSync(lockPath, 'utf8'));
const changed = [];
for (const [path, hash] of Object.entries(files)) {
    if (expected.files[path] !== hash)
        changed.push(path);
}
for (const path of Object.keys(expected.files)) {
    if (!(path in files))
        changed.push(`${path} (deleted)`);
}

if (changed.length > 0) {
    console.error(`@muyajs/core source drifted — ${changed.length} file(s) differ from lock:`);
    for (const path of changed.slice(0, 20))
        console.error(`  ${path}`);
    if (changed.length > 20)
        console.error(`  …and ${changed.length - 20} more`);
    console.error('有意修改 muya 源码时：pnpm lock:muya 重置锁，并把改动留档到 patches/');
    process.exit(1);
}

console.log(`@muyajs/core locked OK: ${digest.slice(0, 12)} (${Object.keys(files).length} files)`);
