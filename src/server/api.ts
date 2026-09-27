/**
 * 独立模式小服务：磁盘上的 vault ↔ HTTP /folio/v1/*。
 * 路径与合入后 daemon 提供的一致（docs/计划.md §合入），合入只换实现不换接口。
 * 只放行 vault 内的 .md 与 attachments/、pics/；越界路径一律 4xx。
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { FolioListItem, FolioListOpts } from '../host/types.ts';
import { displayTitle } from '../shared/docTitle.ts';
import { splitFrontmatter } from '../shared/frontmatter.ts';
import { withPreviewNav } from '../shared/htmlPreview.ts';
import { buildIndex, linksFor, type WikilinkIndex } from '../shared/wikilink.ts';
import {
    activateWorkspace,
    activeWorkspace,
    addWorkspace,
    parseWorkspaces,
    removeWorkspace,
    renameWorkspace,
    seedWorkspaces,
    type FolioWorkspaceState,
} from '../shared/workspaces.ts';

const PREFIX = '/folio/v1/';
const DOC_RE = /\.(md|html)$/i; // 外链含 html（待评估 9.3）
const MEDIA_DIRS = new Set(['attachments', 'pics']);
const MAX_BODY = 10 * 1024 * 1024;

let currentRoot = '';
let wsState: FolioWorkspaceState | null = null;

function defaultRoot(): string {
    return path.resolve(process.env.FOLIO_VAULT ?? path.join(process.cwd(), 'vault'));
}

export function vaultRoot(): string {
    return currentRoot || defaultRoot();
}

function workspacesFile(): string | null {
    if (process.env.FOLIO_WORKSPACES) return process.env.FOLIO_WORKSPACES;
    if (process.env.FOLIO_VAULT) return null;
    return path.join(os.homedir(), '.mimi-folio', 'workspaces.json');
}

async function ensureVaultDirs(dir: string): Promise<void> {
    await fs.mkdir(path.join(dir, 'notes'), { recursive: true });
    await fs.mkdir(path.join(dir, 'memos'), { recursive: true });
    await fs.mkdir(path.join(dir, 'attachments'), { recursive: true });
    await fs.mkdir(path.join(dir, 'pics'), { recursive: true });
}

async function persistWorkspaces(): Promise<void> {
    if (!wsState) return;
    const file = workspacesFile();
    if (!file) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(wsState, null, 2), 'utf8');
}

async function loadWorkspaces(): Promise<FolioWorkspaceState> {
    if (wsState) return wsState;
    if (!currentRoot) currentRoot = defaultRoot();
    const file = workspacesFile();
    if (file) {
        const raw = await fs.readFile(file, 'utf8').catch(() => '');
        const parsed = raw ? parseWorkspaces(raw) : null;
        if (parsed) {
            wsState = parsed;
            currentRoot = activeWorkspace(parsed).dir;
            return parsed;
        }
    }
    wsState = seedWorkspaces(currentRoot);
    await persistWorkspaces();
    return wsState;
}

async function applyWorkspace(next: FolioWorkspaceState): Promise<void> {
    wsState = next;
    const dir = activeWorkspace(next).dir;
    await ensureVaultDirs(dir);
    if (dir !== currentRoot) {
        closeVaultWatcher();
        currentRoot = dir;
    }
    await persistWorkspaces();
}

async function resolveWorkspaceDir(raw: string): Promise<string> {
    if (!path.isAbsolute(raw)) throw new Error('目录必须是绝对路径');
    const resolved = path.resolve(raw);
    const st = await fs.stat(resolved).catch(() => null);
    if (!st?.isDirectory()) throw new Error('目录不存在');
    return resolved;
}

/** vault 内的 posix 相对路径；带 .. 、绝对路径、反斜杠、空段一律拒收。 */
function safeRel(raw: string): string | null {
    if (!raw || raw.includes('\\') || raw.includes('\0')) return null;
    const segs = raw.split('/');
    if (segs.some((s) => !s || s === '.' || s === '..')) return null;
    return segs.join('/');
}

async function fileExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY) throw new Error('body 超过 10MB 上限');
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body?: unknown): void {
    res.statusCode = status;
    if (body !== undefined) {
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(body));
    } else {
        res.end();
    }
}

function fail(res: ServerResponse, status: number, message: string): boolean {
    send(res, status, { error: message });
    return true;
}

function titleOf(rel: string, markdown: string): string {
    return displayTitle(rel, markdown);
}

function kindOf(rel: string): 'note' | 'memo' | undefined {
    if (rel === 'notes' || rel.startsWith('notes/')) return 'note';
    if (rel === 'memos' || rel.startsWith('memos/')) return 'memo';
    return undefined;
}

const execFileP = promisify(execFile);
const ORIGIN_FILE = '.folio-origin';

function isOutsideVault(root: string, abs: string): boolean {
    const rel = path.relative(root, abs);
    return rel.startsWith('..') || path.isAbsolute(rel);
}

async function linkFileInto(srcFile: string, destFile: string): Promise<void> {
    if (await fileExists(destFile)) return;
    try {
        await fs.symlink(srcFile, destFile, 'file');
    } catch {
        try {
            await fs.link(srcFile, destFile);
        } catch (err) {
            throw new Error(
                `建不了链接（${(err as NodeJS.ErrnoException).code}）：`
                + '符号链接需要开发者模式/管理员，硬链接需要与 vault 同一磁盘卷。'
                + '按规矩不拷贝正文，未做任何写入。',
            );
        }
    }
}

/**
 * 库外 md 链入 vault/links/（单元 10）。
 * 链接优先级：符号链接 → 同卷硬链接（Windows 无特权时的等价物，同 inode 仍是
 * 同一份正文）。两者都失败就抛错——**绝不拷贝正文当「入库」**。
 */
async function linkOutside(root: string, absSource: string): Promise<string> {
    if (!path.isAbsolute(absSource)) throw new Error('必须是绝对路径');
    const resolved = path.resolve(absSource);
    if (!DOC_RE.test(resolved)) throw new Error('只链 .md/.html 文件');
    if (!isOutsideVault(root, resolved)) {
        throw new Error('文件已在 vault 内，直接打开即可，不用链入');
    }
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isFile()) throw new Error('文件不存在');

    const linksDir = path.join(root, 'links');
    await fs.mkdir(linksDir, { recursive: true });
    const name = path.basename(resolved);
    const dest = path.join(linksDir, name);
    if (await fileExists(dest)) throw new Error(`links/${name} 已存在`);

    await linkFileInto(resolved, dest);
    invalidate(root);
    return `links/${name}`;
}

const OPENABLE_RE = /\.(md|markdown|html?)$/i;

/**
 * 双击关联打开：把盘上任一 md/html 落成 vault 里可读写的相对路径。
 * 库内文件直接回相对路径；库外按 links/ 规矩链入——幂等：同一文件重复打开回同一条目，
 * 同名但指向别处的文件自动加 -2/-3 序号，断链占位腾名字复用。
 */
async function openExternalDoc(root: string, absSource: string): Promise<string> {
    if (!path.isAbsolute(absSource)) throw new Error('必须是绝对路径');
    const resolved = path.resolve(absSource);
    if (!OPENABLE_RE.test(resolved)) throw new Error('只开 .md/.markdown/.html 文件');
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isFile()) throw new Error('文件不存在');
    if (!isOutsideVault(root, resolved)) {
        const rel = path.relative(root, resolved).split(path.sep).join('/');
        if (!safeRel(rel)) throw new Error('路径非法');
        return rel;
    }
    const linksDir = path.join(root, 'links');
    await fs.mkdir(linksDir, { recursive: true });
    const ext = path.extname(resolved);
    const base = path.basename(resolved, ext);
    for (let i = 0; ; i++) {
        const name = i === 0 ? `${base}${ext}` : `${base}-${i}${ext}`;
        const dest = path.join(linksDir, name);
        if (await fs.lstat(dest).catch(() => null)) {
            // stat 跟随链接拿到真源：dev+ino 一致 = 同一文件（symlink/硬链都满足）→ 幂等回它
            const dst = await fs.stat(dest).catch(() => null);
            if (dst && dst.dev === stat.dev && dst.ino === stat.ino) return `links/${name}`;
            if (dst) continue; // 同名不同文件 → 下一个序号
            await fs.rm(dest, { force: true }); // 断链占位，腾出来复用
        }
        await linkFileInto(resolved, dest);
        invalidate(root);
        return `links/${name}`;
    }
}

/** ── 桌面壳：.md 默认程序关联（HKCU 写注册表，免管理员） ─────────── */

const PROG_ID = 'MimiFolio.md';
const ASSOC_EXTS = ['.md', '.markdown'] as const;

type FileAssoc = { supported: boolean; registered: boolean; isDefault: boolean; needsSettings?: boolean };

/** 桌面壳注入的主程序 exe 路径；没注入 = 独立/daemon 模式，不支持注册。 */
function appExe(): string | null {
    const exe = process.env.FOLIO_APP_EXE;
    return exe && path.isAbsolute(exe) ? exe : null;
}

async function regAdd(key: string, name: string | null, value: string): Promise<void> {
    const args = ['add', key, ...(name === null ? ['/ve'] : ['/v', name]), '/d', value, '/f'];
    await execFileP('reg', args);
}

/** 读某键的 REG_SZ 值；键不存在/不是 SZ 返回 null。name=null 读 (Default)。 */
async function regRead(key: string, name: string | null): Promise<string | null> {
    try {
        const { stdout } = await execFileP('reg', ['query', key, ...(name === null ? ['/ve'] : ['/v', name])]);
        const m = /REG_SZ\s+(.+)/.exec(stdout);
        return m?.[1]?.trim() ?? null;
    } catch {
        return null;
    }
}

/** .md 是否已归我们：Explorer 的 UserChoice 优先；没有就按 Classes\.md 默认值算。 */
async function fileAssocStatus(): Promise<FileAssoc> {
    const exe = appExe();
    if (process.platform !== 'win32' || !exe) {
        return { supported: false, registered: false, isDefault: false };
    }
    const openCmd = await regRead(`HKCU\\Software\\Classes\\${PROG_ID}\\shell\\open\\command`, null);
    const registered = openCmd !== null && openCmd.toLowerCase().includes(exe.toLowerCase());
    const userChoice = await regRead(
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\UserChoice',
        'ProgId',
    );
    const classesDefault = await regRead('HKCU\\Software\\Classes\\.md', null);
    const isDefault = userChoice !== null ? userChoice === PROG_ID : classesDefault === PROG_ID;
    return { supported: true, registered, isDefault };
}

/** HKCU 写 ProgID + 能力声明 + RegisteredApplications；写不进 Explorer 设置页就查不到我们。 */
async function registerFileAssoc(): Promise<void> {
    const exe = appExe();
    if (process.platform !== 'win32' || !exe) throw new Error('仅桌面版可用');
    const progKey = `HKCU\\Software\\Classes\\${PROG_ID}`;
    await regAdd(progKey, null, 'Markdown 文档');
    await regAdd(`${progKey}\\DefaultIcon`, null, `"${exe}",0`);
    await regAdd(`${progKey}\\shell\\open\\command`, null, `"${exe}" "%1"`);
    for (const ext of ASSOC_EXTS) {
        await regAdd(`HKCU\\Software\\Classes\\${ext}`, null, PROG_ID);
        await regAdd(`HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`, PROG_ID, '');
    }
    const cap = 'HKCU\\Software\\MimiFolio\\Capabilities';
    await regAdd(cap, 'ApplicationName', '米素 Folio');
    await regAdd(cap, 'ApplicationDescription', '本地 markdown 记忆库');
    for (const ext of ASSOC_EXTS) {
        await regAdd(`${cap}\\FileAssociations`, ext, PROG_ID);
    }
    await regAdd('HKCU\\Software\\RegisteredApplications', 'MimiFolio', 'SOFTWARE\\MimiFolio\\Capabilities');
    // Explorer 关联缓存刷新；老系统命令，失败不致命
    await execFileP('ie4uinit', ['-show']).catch(() => undefined);
}

async function writeOrigin(destDir: string, srcDir: string): Promise<void> {
    await fs.writeFile(path.join(destDir, ORIGIN_FILE), `${srcDir}\n`, 'utf8');
}

async function readOrigin(destDir: string): Promise<string | null> {
    const raw = await fs.readFile(path.join(destDir, ORIGIN_FILE), 'utf8').catch(() => '');
    const line = raw.split(/\r?\n/).find((s) => s.trim());
    return line ? path.resolve(line.trim()) : null;
}

async function listHardlinkPeers(abs: string): Promise<string[]> {
    if (process.platform !== 'win32') return [];
    try {
        const { stdout } = await execFileP('fsutil', ['hardlink', 'list', abs], { timeout: 2000, windowsHide: true });
        return String(stdout)
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
    } catch {
        return [];
    }
}

function samePath(a: string, b: string): boolean {
    const x = path.resolve(a);
    const y = path.resolve(b);
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

async function inferSourceDir(destDir: string, root: string): Promise<string | null> {
    for (const name of await fs.readdir(destDir)) {
        if (name.startsWith('.') || !DOC_RE.test(name)) continue;
        const abs = path.join(destDir, name);
        const lst = await fs.lstat(abs).catch(() => null);
        if (!lst) continue;
        if (lst.isSymbolicLink()) {
            const target = await fs.readlink(abs);
            return path.dirname(path.resolve(destDir, target));
        }
        for (const peer of await listHardlinkPeers(abs)) {
            const resolved = path.resolve(peer);
            if (isOutsideVault(root, resolved)) return path.dirname(resolved);
        }
    }
    return null;
}

async function linkDirAt(srcDir: string, dest: string): Promise<void> {
    try {
        await fs.symlink(srcDir, dest, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
        await fs.symlink(srcDir, dest, 'dir');
    }
}

/** 目录联接优先；失败则逐文件链接并记下源路径。不拷贝正文。 */
async function attachOutsideDir(srcDir: string, dest: string): Promise<void> {
    try {
        await linkDirAt(srcDir, dest);
    } catch {
        await fs.mkdir(dest, { recursive: true });
        await writeOrigin(dest, srcDir);
        await syncDirFiles(srcDir, dest);
    }
}

async function collectDocs(dir: string, prefix: string): Promise<string[]> {
    const linked: string[] = [];
    async function walk(absDir: string, rel: string): Promise<void> {
        for (const name of await fs.readdir(absDir).catch(() => [] as string[])) {
            if (name.startsWith('.')) continue;
            const abs = path.join(absDir, name);
            const child = `${rel}/${name}`;
            const st = await fs.stat(abs).catch(() => null);
            if (st?.isDirectory()) await walk(abs, child);
            else if (st?.isFile() && DOC_RE.test(name)) linked.push(child);
        }
    }
    await walk(dir, prefix);
    return linked;
}

function isTopLinkDir(rel: string): boolean {
    const segs = rel.split('/');
    return segs.length === 2 && segs[0] === 'links' && Boolean(segs[1]);
}

async function emptyLinkedDir(dest: string): Promise<void> {
    for (const name of await fs.readdir(dest)) {
        const abs = path.join(dest, name);
        const lst = await fs.lstat(abs);
        if (lst.isSymbolicLink()) await fs.unlink(abs);
        else if (lst.isDirectory()) {
            await emptyLinkedDir(abs);
            await fs.rmdir(abs);
        } else {
            await fs.unlink(abs);
        }
    }
}

/** 拆掉 vault 里的外链文件夹槽。联接只摘槽，绝不走进源目录删文件。 */
async function detachLinkedDir(dest: string, root: string): Promise<void> {
    const lst = await fs.lstat(dest);
    const outside = await outsideDirTarget(dest, root);
    if (outside || lst.isSymbolicLink()) {
        await fs.unlink(dest);
        return;
    }
    await emptyLinkedDir(dest);
    await fs.rmdir(dest);
}

async function resolveOutsideDir(root: string, srcDir: string): Promise<string> {
    const resolved = path.resolve(srcDir);
    if (!isOutsideVault(root, resolved)) throw new Error('文件夹已在 vault 内');
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) throw new Error('文件夹不存在');
    return resolved;
}

async function relinkFolderDir(root: string, vaultRel: string, srcDir: string): Promise<string[]> {
    if (!isTopLinkDir(vaultRel)) throw new Error('只能更换顶层外链文件夹的路径');
    const dest = path.join(root, ...vaultRel.split('/'));
    if (!await fileExists(dest)) throw new Error(`${vaultRel} 不存在`);
    const oldSrc = await outsideDirTarget(dest, root)
        ?? await readOrigin(dest)
        ?? await inferSourceDir(dest, root);
    if (oldSrc) {
        unwatchOutside(oldSrc);
        sourceFp.delete(oldSrc);
    }
    await detachLinkedDir(dest, root);
    await attachOutsideDir(srcDir, dest);
    watchOutside(srcDir, root);
    invalidate(root);
    return collectDocs(dest, vaultRel);
}

/** 系统选文件夹窗（独立模式）。取消回 null。 */
async function pickFolderNative(): Promise<string | null> {
    if (process.platform === 'win32') {
        const scriptPath = path.join(os.tmpdir(), `folio-pick-${process.pid}-${Date.now()}.ps1`);
        const script = [
            '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
            'function Get-FolioFolder {',
            '  try {',
            '    $shell = New-Object -ComObject Shell.Application',
            '    $folder = $shell.BrowseForFolder(0, "选择工作区目录", 0x0041, 0)',
            '    if ($null -ne $folder) { return [string]$folder.Self.Path }',
            '  } catch { }',
            '  Add-Type -AssemblyName System.Windows.Forms',
            '  [System.Windows.Forms.Application]::EnableVisualStyles()',
            '  $hostForm = New-Object System.Windows.Forms.Form',
            '  $hostForm.TopMost = $true',
            '  $hostForm.ShowInTaskbar = $false',
            '  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
            '  $dialog.Description = "选择工作区目录"',
            '  $dialog.ShowNewFolderButton = $true',
            '  if ($dialog.ShowDialog($hostForm) -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.SelectedPath }',
            '  return ""',
            '}',
            '$path = Get-FolioFolder',
            'if ($path) { Write-Output $path }',
        ].join('\n');
        await fs.writeFile(scriptPath, `\uFEFF${script}`, 'utf8');
        try {
            const { stdout } = await execFileP(
                'powershell.exe',
                ['-STA', '-NoProfile', '-File', scriptPath],
                { timeout: 10 * 60 * 1000, windowsHide: false },
            );
            const line = String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop() ?? '';
            return line || null;
        } finally {
            await fs.unlink(scriptPath).catch(() => undefined);
        }
    }
    if (process.platform === 'darwin') {
        try {
            const { stdout } = await execFileP('osascript', ['-e', 'POSIX path of (choose folder)'], {
                timeout: 10 * 60 * 1000,
            });
            return String(stdout).trim().replace(/\/$/, '') || null;
        } catch {
            return null;
        }
    }
    try {
        const { stdout } = await execFileP('zenity', ['--file-selection', '--directory', '--title=选择文件夹'], {
            timeout: 10 * 60 * 1000,
        });
        return String(stdout).trim() || null;
    } catch {
        try {
            const { stdout } = await execFileP('kdialog', ['--getexistingdirectory', '.', '选择文件夹'], {
                timeout: 10 * 60 * 1000,
            });
            return String(stdout).trim() || null;
        } catch {
            throw new Error('打不开系统选文件夹窗');
        }
    }
}

/** 逐文件补链（目录联接失败时）：源里新 md 在 dest 建链接，不拷贝。 */
async function syncDirFiles(srcDir: string, destDir: string): Promise<boolean> {
    let added = false;
    const names = await fs.readdir(srcDir).catch(() => [] as string[]);
    for (const name of names) {
        if (name.startsWith('.')) continue;
        const src = path.join(srcDir, name);
        const dest = path.join(destDir, name);
        const st = await fs.stat(src).catch(() => null);
        if (!st) continue;
        if (st.isDirectory()) {
            if (!await fileExists(dest)) await fs.mkdir(dest, { recursive: true });
            if (await syncDirFiles(src, dest)) added = true;
            continue;
        }
        if (!st.isFile() || !DOC_RE.test(name)) continue;
        if (await fileExists(dest)) continue;
        try {
            await linkFileInto(src, dest);
            added = true;
        } catch {
            // 单文件失败跳过
        }
    }
    return added;
}

async function fingerprintDocs(dir: string): Promise<string> {
    const rows: string[] = [];
    async function walk(d: string, prefix: string): Promise<void> {
        for (const name of await fs.readdir(d).catch(() => [] as string[])) {
            if (name.startsWith('.')) continue;
            const abs = path.join(d, name);
            const st = await fs.stat(abs).catch(() => null);
            if (st?.isDirectory()) {
                await walk(abs, `${prefix}${name}/`);
            } else if (st?.isFile() && DOC_RE.test(name)) {
                rows.push(`${prefix}${name}:${st.mtimeMs}`);
            }
        }
    }
    await walk(dir, '');
    return rows.sort().join('|');
}

/** dest 若解析到 vault 外的目录，就是目录联接/符号链接（不要往源里写 .folio-origin）。 */
async function outsideDirTarget(dest: string, root: string): Promise<string | null> {
    const real = await fs.realpath(dest).catch(() => dest);
    return isOutsideVault(root, real) ? real : null;
}

/** 已链入的文件夹：补上源目录里新出现的 md（不拷贝），并盯着源目录。 */
async function syncLinkedFolders(root: string): Promise<void> {
    const linksDir = path.join(root, 'links');
    if (!await fileExists(linksDir)) return;
    let changed = false;
    for (const name of await fs.readdir(linksDir)) {
        if (name.startsWith('.')) continue;
        const dest = path.join(linksDir, name);
        const lst = await fs.lstat(dest).catch(() => null);
        if (!lst) continue;
        const destStat = await fs.stat(dest).catch(() => null);
        if (!destStat?.isDirectory()) continue;
        const junctionSrc = await outsideDirTarget(dest, root);
        let srcDir: string | null = junctionSrc;
        if (!srcDir && lst.isDirectory()) {
            srcDir = await readOrigin(dest) ?? await inferSourceDir(dest, root);
            if (srcDir && isOutsideVault(root, srcDir)) {
                const prev = await readOrigin(dest);
                if (!prev || !samePath(prev, srcDir)) await writeOrigin(dest, srcDir);
            }
        }
        if (!srcDir || !isOutsideVault(root, srcDir)) continue;
        watchOutside(srcDir, root);
        if (!junctionSrc && lst.isDirectory()) {
            if (await syncDirFiles(srcDir, dest)) changed = true;
        }
        const fp = await fingerprintDocs(srcDir);
        const prevFp = sourceFp.get(srcDir);
        if (prevFp !== undefined && prevFp !== fp) changed = true;
        sourceFp.set(srcDir, fp);
    }
    if (changed) invalidate(root);
}

/**
 * vault 索引缓存（米米建议 3）：list/search/wikilink 共用一棵内存索引，
 * 本服务写穿失效，fs.watch 兜底外部改动（合入后这层迁给 daemon 常驻）。
 */
type VaultCache = {
    list: FolioListItem[];
    contents: Map<string, string>;
    mtimes: Map<string, number>;
};
const cacheByRoot = new Map<string, VaultCache>();
let watcher: FSWatcher | null = null;
let watchedRoot = '';
const extraWatchers = new Map<string, FSWatcher>();
const sourceFp = new Map<string, string>();

function invalidate(root: string): void {
    cacheByRoot.delete(root);
}

function watchOutside(dir: string, root: string): void {
    const key = path.resolve(dir);
    if (extraWatchers.has(key)) return;
    try {
        const w = fsWatch(key, { recursive: true }, () => invalidate(root));
        w.on('error', () => {
            extraWatchers.delete(key);
            w.close();
        });
        extraWatchers.set(key, w);
    } catch {
        // 源目录盯不住也不挡 list；下次 loadVault 还会再补链
    }
}

function unwatchOutside(dir: string): void {
    const key = path.resolve(dir);
    const w = extraWatchers.get(key);
    if (!w) return;
    w.close();
    extraWatchers.delete(key);
}

/** 关闭常驻 watcher（测试收尾/进程退出用）。 */
export function closeVaultWatcher(): void {
    watcher?.close();
    watcher = null;
    watchedRoot = '';
    for (const w of extraWatchers.values()) w.close();
    extraWatchers.clear();
    sourceFp.clear();
}

function ensureWatcher(root: string): void {
    if (watchedRoot === root && watcher) return;
    watcher?.close();
    watchedRoot = root;
    watcher = fsWatch(root, { recursive: true }, () => invalidate(root));
    watcher.on('error', () => invalidate(root));
}

async function loadVault(root: string): Promise<VaultCache> {
    ensureWatcher(root);
    await syncLinkedFolders(root);
    const cached = cacheByRoot.get(root);
    if (cached) return cached;

    const list: FolioListItem[] = [];
    const contents = new Map<string, string>();
    const mtimes = new Map<string, number>();
    const seen = new Set<string>();
    const dirs: string[] = [];
    async function walk(dir: string): Promise<void> {
        const real = await fs.realpath(dir).catch(() => dir);
        if (seen.has(real)) return;
        seen.add(real);
        const atRoot = path.relative(root, dir) === '';
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            const abs = path.join(dir, entry.name);
            const rel = path.relative(root, abs).split(path.sep).join('/');
            if (atRoot && MEDIA_DIRS.has(entry.name)) continue;
            if (entry.isDirectory() || entry.isSymbolicLink()) {
                const st = await fs.stat(abs).catch(() => null);
                if (st?.isDirectory()) {
                    if (rel) dirs.push(rel);
                    await walk(abs);
                    continue;
                }
            }
            const isMdFile = entry.isFile() && DOC_RE.test(entry.name);
            const isMdLink = entry.isSymbolicLink() && DOC_RE.test(entry.name);
            if (!isMdFile && !isMdLink) continue;
            const stat = await fs.stat(abs).catch(() => null);
            if (!stat?.isFile()) continue;
            const markdown = (await fs.readFile(abs, 'utf8')).replace(/\r\n?/g, '\n');
            contents.set(rel, markdown);
            mtimes.set(rel, stat.mtimeMs);
            const { frontmatter, tags } = splitFrontmatter(markdown);
            const kind = kindOf(rel);
            list.push({
                path: rel,
                title: titleOf(rel, markdown),
                tags,
                kind,
                linked: (rel === 'links' || rel.startsWith('links/')) || undefined,
                favorite: /^favorite\s*:\s*true/im.test(frontmatter) || undefined,
                mtimeMs: stat.mtimeMs,
                ctimeMs: stat.birthtimeMs,
                markdown: kind === 'memo' ? markdown : undefined,
            });
        }
    }
    await walk(root);
    for (const d of dirs) {
        if (MEDIA_DIRS.has(d.split('/')[0]!)) continue;
        if (list.some((f) => f.path === d || f.path.startsWith(`${d}/`))) continue;
        list.push({
            path: d,
            title: path.posix.basename(d),
            folder: true,
            kind: kindOf(d),
            linked: (d === 'links' || d.startsWith('links/')) || undefined,
        });
    }
    const cache: VaultCache = { list, contents, mtimes };
    cacheByRoot.set(root, cache);
    return cache;
}

async function listMarkdown(root: string, opts: FolioListOpts): Promise<FolioListItem[]> {
    const { list } = await loadVault(root);
    let result = list.map((f) => ({ ...f }));
    if (opts.dir) result = result.filter((f) => f.path.startsWith(`${opts.dir}/`));
    if (opts.tag) result = result.filter((f) => !f.folder && f.tags?.includes(opts.tag!));
    if (opts.kind) result = result.filter((f) => !f.folder && f.kind === opts.kind);
    return result.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
}

/** 全 vault 的 wikilink 索引：出链/反链都在这一棵树上算（iwe 算法合入后归 daemon）。 */
async function buildWikilinkIndex(root: string): Promise<WikilinkIndex> {
    const { contents } = await loadVault(root);
    return buildIndex(contents);
}

/** 附件名只留安全字符；重名时塞时间戳，不覆盖。 */
async function saveIntoDir(root: string, folder: 'attachments' | 'pics', bytes: Buffer, hint: string): Promise<string> {
    const base = path.posix.basename(hint.replaceAll('\\', '/'));
    const stem = base.replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || (folder === 'pics' ? 'pic' : 'file');
    const ext = (base.match(/\.[^.]*$/)?.[0] ?? '.bin').slice(0, 16);
    const dir = path.join(root, folder);
    await fs.mkdir(dir, { recursive: true });
    let name = `${stem}${ext}`;
    for (let i = 0; await fileExists(path.join(dir, name)); i++) {
        name = `${stem}-${Date.now()}-${i}${ext}`;
    }
    await fs.writeFile(path.join(dir, name), bytes);
    return `${folder}/${name}`;
}

async function saveAttachment(root: string, bytes: Buffer, hint: string): Promise<string> {
    return saveIntoDir(root, 'attachments', bytes, hint);
}

function sniffImageExt(bytes: Buffer): string | null {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return '.png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg';
    if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return '.gif';
    if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return '.webp';
    const head = bytes.toString('utf8', 0, Math.min(256, bytes.length));
    if (/<svg[\s>]/i.test(head)) return '.svg';
    return null;
}

function imageExtOf(urlPath: string, ctype: string, bytes: Buffer): string {
    const sniffed = sniffImageExt(bytes);
    if (sniffed) return sniffed;
    const fromPath = urlPath.match(/\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i)?.[0]?.toLowerCase();
    if (fromPath) return fromPath === '.jpeg' ? '.jpg' : fromPath;
    if (/png/i.test(ctype)) return '.png';
    if (/jpe?g/i.test(ctype)) return '.jpg';
    if (/gif/i.test(ctype)) return '.gif';
    if (/webp/i.test(ctype)) return '.webp';
    if (/svg/i.test(ctype)) return '.svg';
    return '.png';
}

const PIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** 用户粘贴触发的拉取；不是后台出网。只 http(s)，落盘 pics/。 */
async function saveRemotePic(root: string, urlRaw: string): Promise<string> {
    let url: URL;
    try {
        url = new URL(urlRaw);
    } catch {
        throw new Error('图片地址非法');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持 http(s) 图片');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    let res: Response;
    try {
        res = await fetch(url, {
            signal: ac.signal,
            redirect: 'follow',
            headers: {
                accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'user-agent': PIC_UA,
                referer: `${url.origin}/`,
            },
        });
    } catch (err) {
        throw new Error(ac.signal.aborted ? '下载超时' : `下载失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BODY) throw new Error('图片过大');
    if (buf.length === 0) throw new Error('空文件');
    const ctype = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    const sniffed = sniffImageExt(buf);
    if (!sniffed && ctype && !/^(image\/|application\/octet-stream$)/i.test(ctype)) throw new Error('不是图片');
    const ext = imageExtOf(url.pathname, ctype, buf);
    let hint = path.posix.basename(url.pathname) || `pic${ext}`;
    if (!/\.[^.]+$/.test(hint)) hint += ext;
    return saveIntoDir(root, 'pics', buf, hint);
}

const ATTACH_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.pdf': 'application/pdf',
};

const PREVIEW_MIME: Record<string, string> = {
    ...ATTACH_MIME,
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
};

function previewRel(pathname: string): string | null {
    if (!pathname.startsWith('preview/')) return null;
    const rest = pathname.slice('preview/'.length);
    if (!rest) return null;
    try {
        const segs = rest.split('/').map((s) => decodeURIComponent(s));
        return safeRel(segs.join('/'));
    } catch {
        return null;
    }
}

/**
 * GET /attachments/<name> 与 GET /pics/<name>：把 vault 媒体端给 <img>/<video>/<audio>。
 * md 里存的是相对路径，页面根就是 vault 根；合入后 daemon 按同样规则端。
 */
export async function serveAttachment(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const raw = req.url ?? '';
    if (req.method !== 'GET') return false;
    const prefix = raw.startsWith('/attachments/') ? '/attachments/' : raw.startsWith('/pics/') ? '/pics/' : '';
    if (!prefix) return false;
    const folder = prefix === '/pics/' ? 'pics' : 'attachments';
    const name = decodeURIComponent(raw.slice(prefix.length).split('?')[0]);
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..') || name.startsWith('.')) {
        fail(res, 400, folder === 'pics' ? '图片名非法' : '附件名非法');
        return true;
    }
    try {
        const abs = path.join(vaultRoot(), folder, name);
        res.setHeader('content-type', ATTACH_MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
        res.end(await fs.readFile(abs));
        return true;
    } catch {
        return false; // 交给调用方走 404
    }
}

/**
 * 统一入口：匹配 /folio/v1/* 就处理并回 true，否则回 false 由调用方走静态/下一个中间件。
 * dev 由 vite 中间件调，独立整服由 src/server/main.ts 调，合入后 daemon 按同一契约实现。
 */
export async function handleFolioApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const raw = req.url ?? '';
    if (!raw.startsWith(PREFIX)) return false;
    const [pathname, search = ''] = raw.slice(PREFIX.length).split('?');
    const query = new URLSearchParams(search);
    await loadWorkspaces();
    const root = vaultRoot();

    try {
        if (req.method === 'GET' && pathname === 'root') {
            send(res, 200, { root });
            return true;
        }

        if (req.method === 'GET' && pathname === 'workspaces') {
            send(res, 200, await loadWorkspaces());
            return true;
        }

        if (req.method === 'POST' && pathname === 'workspace') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { id?: string };
            if (typeof body.id !== 'string') return fail(res, 400, '需要 {id}');
            const next = activateWorkspace(await loadWorkspaces(), body.id);
            await applyWorkspace(next);
            send(res, 204);
            return true;
        }

        if (req.method === 'POST' && pathname === 'workspaces') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { name?: string; dir?: string };
            if (typeof body.name !== 'string' || typeof body.dir !== 'string') {
                return fail(res, 400, '需要 {name, dir}');
            }
            const dir = await resolveWorkspaceDir(body.dir);
            const name = body.name.trim() || path.basename(dir);
            const next = addWorkspace(await loadWorkspaces(), name, dir, crypto.randomUUID());
            await applyWorkspace(next);
            send(res, 200, activeWorkspace(next));
            return true;
        }

        if (req.method === 'PATCH' && pathname === 'workspaces') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { id?: string; name?: string };
            if (typeof body.id !== 'string' || typeof body.name !== 'string') {
                return fail(res, 400, '需要 {id, name}');
            }
            const next = renameWorkspace(await loadWorkspaces(), body.id, body.name);
            await applyWorkspace(next);
            send(res, 204);
            return true;
        }

        if (req.method === 'DELETE' && pathname === 'workspaces') {
            const id = query.get('id') ?? '';
            if (!id) return fail(res, 400, '需要 id');
            const next = removeWorkspace(await loadWorkspaces(), id);
            await applyWorkspace(next);
            send(res, 204);
            return true;
        }

        if (req.method === 'GET' && pathname.startsWith('preview/')) {
            const rel = previewRel(pathname);
            if (!rel) return fail(res, 400, 'path 非法');
            const abs = path.join(root, rel);
            const st = await fs.stat(abs).catch(() => null);
            if (!st?.isFile()) return fail(res, 404, '不存在');
            const ext = path.extname(abs).toLowerCase();
            res.statusCode = 200;
            res.setHeader('content-type', PREVIEW_MIME[ext] ?? 'application/octet-stream');
            res.setHeader('x-content-type-options', 'nosniff');
            if (ext === '.html' || ext === '.htm') {
                // 不禁脚本：开关在 iframe sandbox。script-src none 会盖掉「默认允许脚本」。
                res.setHeader('content-security-policy', "object-src 'none'");
                const html = await fs.readFile(abs, 'utf8');
                res.end(withPreviewNav(html));
                return true;
            }
            res.end(await fs.readFile(abs));
            return true;
        }

        if (req.method === 'GET' && pathname === 'list') {
            const opts: FolioListOpts = {};
            const dir = query.get('dir');
            const tag = query.get('tag');
            const kind = query.get('kind');
            if (dir) opts.dir = dir;
            if (tag) opts.tag = tag;
            if (kind === 'note' || kind === 'memo') opts.kind = kind;
            send(res, 200, await listMarkdown(root, opts));
            return true;
        }

        if (req.method === 'GET' && pathname === 'doc') {
            const p = safeRel(query.get('path') ?? '');
            if (!p) return fail(res, 400, 'path 非法');
            if (!DOC_RE.test(p)) return fail(res, 400, '只读 .md/.html');
            const abs = path.join(root, p);
            const raw = await fs.readFile(abs, 'utf8');
            const stat = await fs.stat(abs);
            // muya 的 lexer 只认 LF；Windows 盘上的 CRLF 在读出层统一掉，写回也是 LF。
            // mtimeMs 供 PUT If-Match 做写回冲突保护（米米建议 2）。
            send(res, 200, { path: p, markdown: raw.replace(/\r\n?/g, '\n'), mtimeMs: stat.mtimeMs, ctimeMs: stat.birthtimeMs });
            return true;
        }

        if (req.method === 'PUT' && pathname === 'doc') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { path?: string; markdown?: string };
            const p = safeRel(body.path ?? '');
            if (!p || !DOC_RE.test(p) || typeof body.markdown !== 'string') {
                return fail(res, 400, '需要 {path: *.md, markdown}');
            }
            const abs = path.join(root, p);
            const currentStat = await fs.stat(abs).catch(() => null);
            const ifMatch = req.headers['if-match'];
            // If-Match 不匹配 → 409，绝不静默盖掉别处的修改（米米建议 2）
            if (ifMatch && currentStat && String(currentStat.mtimeMs) !== String(ifMatch)) {
                return fail(res, 409, '文件已在别处被修改（conflict）');
            }
            // 落盘前留最近一份快照（米米建议 5）：<名>.md.bak，不带 .md 结尾不进清单
            if (currentStat) await fs.copyFile(abs, `${abs}.bak`).catch(() => undefined);
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, body.markdown, 'utf8');
            invalidate(root);
            send(res, 204);
            return true;
        }

        // ---- 文档管理（验收清单 14：移动/复制/删除）----
        if (req.method === 'POST' && (pathname === 'move' || pathname === 'copy' || pathname === 'delete')) {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { from?: string; to?: string };
            // 目录与文档通吃（bug5：文件夹右键菜单）：from/to 允许目录（无扩展名）
            const from = safeRel(body.from ?? '');
            if (!from) return fail(res, 400, 'from 非法');
            const fromAbs = path.join(root, from);
            const fromStat = await fs.stat(fromAbs).catch(() => null);
            if (!fromStat) return fail(res, 400, '源不存在');
            if (pathname === 'delete') {
                await fs.rm(fromAbs, { recursive: true, force: true });
                await fs.rm(`${fromAbs}.bak`, { force: true }).catch(() => undefined);
                invalidate(root);
                send(res, 204);
                return true;
            }
            const to = safeRel(body.to ?? '');
            if (!to) return fail(res, 400, 'to 非法');
            const toAbs = path.join(root, to);
            if (await fileExists(toAbs)) return fail(res, 400, '目标已存在');
            await fs.mkdir(path.dirname(toAbs), { recursive: true });
            if (pathname === 'move') await fs.rename(fromAbs, toAbs);
            else if (fromStat.isDirectory()) {
                // 目录递归拷贝
                const copyDir = async (src: string, dest: string): Promise<void> => {
                    await fs.mkdir(dest, { recursive: true });
                    for (const entry of await fs.readdir(src, { withFileTypes: true })) {
                        if (entry.isDirectory()) await copyDir(path.join(src, entry.name), path.join(dest, entry.name));
                        else if (entry.isFile()) await fs.copyFile(path.join(src, entry.name), path.join(dest, entry.name));
                    }
                };
                await copyDir(fromAbs, toAbs);
            } else await fs.copyFile(fromAbs, toAbs);
            invalidate(root);
            send(res, 200, { path: to });
            return true;
        }

        if (req.method === 'POST' && pathname === 'mkdir') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { path?: string };
            const p = safeRel(body.path ?? '');
            if (!p) return fail(res, 400, 'path 非法');
            if (DOC_RE.test(p)) return fail(res, 400, '那是文档路径');
            if (p.split('/').some((s) => s.startsWith('.'))) return fail(res, 400, 'path 非法');
            if (MEDIA_DIRS.has(p.split('/')[0]!)) return fail(res, 400, '不能在附件目录建文件夹');
            const abs = path.join(root, p);
            const st = await fs.stat(abs).catch(() => null);
            if (st?.isFile()) return fail(res, 400, '该路径已是文件');
            if (!st) await fs.mkdir(abs, { recursive: true });
            invalidate(root);
            send(res, 204);
            return true;
        }

        if (req.method === 'GET' && pathname === 'search') {
            const q = (query.get('q') ?? '').trim();
            if (!q) {
                send(res, 200, []);
                return true;
            }
            const needle = q.toLowerCase();
            const { list, contents } = await loadVault(root);
            const results: (FolioListItem & { matches: { text: string; start: number }[] })[] = [];
            for (const item of list) {
                if (item.folder) continue;
                const markdown = contents.get(item.path) ?? '';
                const matches: { text: string; start: number }[] = [];
                const titleHit = item.title.toLowerCase().indexOf(needle);
                if (titleHit >= 0) matches.push({ text: item.title, start: titleHit });
                const lower = markdown.toLowerCase();
                let from = 0;
                while (matches.length < 5) {
                    const idx = lower.indexOf(needle, from);
                    if (idx === -1) break;
                    const lineNo = markdown.slice(0, idx).split('\n').length - 1;
                    const line = (markdown.split('\n')[lineNo] ?? '').trim();
                    const start = Math.max(0, line.toLowerCase().indexOf(needle));
                    matches.push({ text: line.slice(0, 80), start });
                    from = idx + needle.length;
                }
                if (matches.length > 0) results.push({ ...item, matches });
                if (results.length >= 30) break;
            }
            send(res, 200, results);
            return true;
        }

        // 米素页存活心跳：daemon 由此点亮/熄灭米米顶栏按钮；独立模式没有
        // 按钮，收下回 204 即可（与 daemon 端 folio.rs 同形）。
        if (req.method === 'POST' && (pathname === 'presence' || pathname === 'bye')) {
            send(res, 204);
            return true;
        }

        // 系统选文件夹窗（独立模式；合入后由宿主原生对话框提供）
        if (req.method === 'POST' && pathname === 'pick-folder') {
            try {
                const picked = await pickFolderNative();
                if (!picked) {
                    res.statusCode = 204;
                    res.end();
                    return true;
                }
                send(res, 200, { path: picked });
                return true;
            } catch (err) {
                return fail(res, 400, err instanceof Error ? err.message : String(err));
            }
        }

        // 文件夹整体链入：优先目录联接（源里新文件自动可见）；不行再逐文件链接并记下源路径
        if (req.method === 'POST' && pathname === 'folderlink') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { source?: string };
            if (typeof body.source !== 'string' || !path.isAbsolute(body.source)) {
                return fail(res, 400, '需要 {source: 文件夹绝对路径}');
            }
            try {
                const srcDir = await resolveOutsideDir(root, body.source);
                const destDir = path.join(root, 'links', path.basename(srcDir));
                if (await fileExists(destDir)) return fail(res, 400, `links/${path.basename(srcDir)} 已存在`);
                await fs.mkdir(path.join(root, 'links'), { recursive: true });
                await attachOutsideDir(srcDir, destDir);
                watchOutside(srcDir, root);
                const prefix = `links/${path.basename(srcDir)}`;
                const linked = await collectDocs(destDir, prefix);
                invalidate(root);
                send(res, 200, { dir: prefix, count: linked.length, files: linked });
                return true;
            } catch (err) {
                return fail(res, 400, err instanceof Error ? err.message : String(err));
            }
        }

        if (req.method === 'POST' && pathname === 'folderrelink') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { dir?: string; source?: string };
            const rel = typeof body.dir === 'string' ? safeRel(body.dir) : null;
            if (!rel || typeof body.source !== 'string' || !path.isAbsolute(body.source)) {
                return fail(res, 400, '需要 {dir: links/名称, source: 文件夹绝对路径}');
            }
            try {
                const srcDir = await resolveOutsideDir(root, body.source);
                const files = await relinkFolderDir(root, rel, srcDir);
                send(res, 200, { dir: rel, count: files.length, files });
                return true;
            } catch (err) {
                return fail(res, 400, err instanceof Error ? err.message : String(err));
            }
        }

        if (req.method === 'POST' && pathname === 'link') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { source?: string };
            if (typeof body.source !== 'string') return fail(res, 400, '需要 {source: 绝对路径}');
            try {
                const rel = await linkOutside(root, body.source);
                send(res, 200, { path: rel });
                return true;
            } catch (err) {
                return fail(res, 400, err instanceof Error ? err.message : String(err));
            }
        }

        // 桌面壳传入的文件路径（双击 .md 启动）：库内原样回，库外按 links/ 规矩链入（幂等）
        if (req.method === 'POST' && pathname === 'open-external') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { path?: string };
            if (typeof body.path !== 'string') return fail(res, 400, '需要 {path: 绝对路径}');
            try {
                send(res, 200, { path: await openExternalDoc(root, body.path) });
            } catch (err) {
                return fail(res, 400, err instanceof Error ? err.message : String(err));
            }
            return true;
        }

        // .md/.markdown 默认程序关联：GET 探状态，POST 写 HKCU 注册
        if (pathname === 'file-assoc') {
            if (req.method === 'GET') {
                send(res, 200, await fileAssocStatus());
                return true;
            }
            if (req.method === 'POST') {
                try {
                    await registerFileAssoc();
                    const status = await fileAssocStatus();
                    const needsSettings = status.registered && !status.isDefault;
                    if (needsSettings) {
                        // 已有别家 UserChoice：Windows 只允许在设置页改默认，直接帮用户开到那页
                        await execFileP('cmd', ['/c', 'start', '', 'ms-settings:defaultapps']).catch(() => undefined);
                    }
                    send(res, 200, { ...status, needsSettings });
                } catch (err) {
                    return fail(res, 400, err instanceof Error ? err.message : String(err));
                }
                return true;
            }
        }

        if (req.method === 'GET' && pathname === 'index') {
            const p = safeRel(query.get('path') ?? '');
            if (!p) return fail(res, 400, 'path 非法');
            const index = await buildWikilinkIndex(root);
            send(res, 200, linksFor(index, p));
            return true;
        }

        if (req.method === 'POST' && (pathname === 'image' || pathname === 'file')) {
            const bytes = await readBody(req);
            let hint = String(req.headers['x-folio-hint'] ?? 'file.bin');
            try {
                hint = decodeURIComponent(hint);
            } catch {
                // 客户端没编码也能落盘
            }
            const src = await saveAttachment(root, bytes, hint);
            send(res, 200, { src });
            return true;
        }

        if (req.method === 'POST' && pathname === 'pic') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { url?: string };
            if (typeof body.url !== 'string' || !body.url.trim()) return fail(res, 400, '需要 {url}');
            const src = await saveRemotePic(root, body.url.trim());
            send(res, 200, { src });
            return true;
        }

        return fail(res, 404, `未知路由 ${req.method} /folio/v1/${pathname}`);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400;
        return fail(res, code, err instanceof Error ? err.message : String(err));
    }
}
