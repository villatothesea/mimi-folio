/**
 * 独立模式小服务：磁盘上的 vault ↔ HTTP /folio/v1/*。
 * 路径与合入后 daemon 提供的一致（docs/计划.md §合入），合入只换实现不换接口。
 * 只放行 vault 内的 .md 与 attachments/；越界路径一律 4xx。
 */
import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

import type { FolioListItem, FolioListOpts } from '../host/types.ts';
import { splitFrontmatter } from '../shared/frontmatter.ts';
import { buildIndex, linksFor, type WikilinkIndex } from '../shared/wikilink.ts';

const PREFIX = '/folio/v1/';
const MD_RE = /\.md$/i;
const MAX_BODY = 10 * 1024 * 1024;

export function vaultRoot(): string {
    return process.env.FOLIO_VAULT ?? path.join(process.cwd(), 'vault');
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
    const { body } = splitFrontmatter(markdown);
    const heading = body.split('\n').find((line) => /^#{1,6}\s+\S/.test(line));
    if (heading) return heading.replace(/^#{1,6}\s+/, '').trim();
    return rel.replace(/\.md$/i, '');
}

function kindOf(rel: string): 'note' | 'memo' | undefined {
    if (rel === 'notes' || rel.startsWith('notes/')) return 'note';
    if (rel === 'memos' || rel.startsWith('memos/')) return 'memo';
    return undefined;
}

/**
 * 库外 md 链入 vault/links/（单元 10）。
 * 链接优先级：符号链接 → 同卷硬链接（Windows 无特权时的等价物，同 inode 仍是
 * 同一份正文）。两者都失败就抛错——**绝不拷贝正文当「入库」**。
 */
async function linkOutside(root: string, absSource: string): Promise<string> {
    if (!path.isAbsolute(absSource)) throw new Error('必须是绝对路径');
    const resolved = path.resolve(absSource);
    if (!MD_RE.test(resolved)) throw new Error('只链 .md 文件');
    if (!path.relative(root, resolved).startsWith('..')) {
        throw new Error('文件已在 vault 内，直接打开即可，不用链入');
    }
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isFile()) throw new Error('文件不存在');

    const linksDir = path.join(root, 'links');
    await fs.mkdir(linksDir, { recursive: true });
    const name = path.basename(resolved);
    const dest = path.join(linksDir, name);
    if (await fileExists(dest)) throw new Error(`links/${name} 已存在`);

    try {
        await fs.symlink(resolved, dest, 'file');
    } catch {
        // Windows 普通权限建不了符号链接；同卷硬链接是同一份磁盘数据（非拷贝）
        try {
            await fs.link(resolved, dest);
        } catch (err) {
            throw new Error(
                `建不了链接（${(err as NodeJS.ErrnoException).code}）：`
                + '符号链接需要开发者模式/管理员，硬链接需要与 vault 同一磁盘卷。'
                + '按规矩不拷贝正文，未做任何写入。',
            );
        }
    }
    return `links/${name}`;
}

async function listMarkdown(root: string, opts: FolioListOpts): Promise<FolioListItem[]> {
    const out: FolioListItem[] = [];
    async function walk(dir: string): Promise<void> {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(abs);
            // 符号链接（目录项不是 file/dir）也跟进去：links/ 的链入文档要出现在清单
            else if (entry.isSymbolicLink() && MD_RE.test(entry.name)) {
                const stat = await fs.stat(abs).catch(() => null);
                if (stat?.isFile()) {
                    const rel = path.relative(root, abs).split(path.sep).join('/');
                    const markdown = await fs.readFile(abs, 'utf8');
                    const { tags } = splitFrontmatter(markdown);
                    out.push({ path: rel, title: titleOf(rel, markdown), tags, linked: true });
                }
            } else if (entry.isFile() && MD_RE.test(entry.name)) {
                const rel = path.relative(root, abs).split(path.sep).join('/');
                const markdown = await fs.readFile(abs, 'utf8');
                const { frontmatter, tags } = splitFrontmatter(markdown);
                // 硬链接没有目录项标记，links/ 目录下的都算链入
                const linked = rel === 'links' || rel.startsWith('links/');
                out.push({
                    path: rel,
                    title: titleOf(rel, markdown),
                    tags,
                    kind: kindOf(rel),
                    linked: linked || undefined,
                    favorite: /^favorite\s*:\s*true/im.test(frontmatter) || undefined,
                });
            }
        }
    }
    await walk(root);
    let result = out;
    if (opts.dir) result = result.filter((f) => f.path.startsWith(`${opts.dir}/`));
    if (opts.tag) result = result.filter((f) => f.tags?.includes(opts.tag!));
    if (opts.kind) result = result.filter((f) => f.kind === opts.kind);
    return result.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
}

/** 全 vault 的 wikilink 索引：出链/反链都在这一棵树上算（iwe 算法合入后归 daemon）。 */
async function buildWikilinkIndex(root: string): Promise<WikilinkIndex> {
    const docs = new Map<string, string>();
    async function walk(dir: string): Promise<void> {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(abs);
            else if (entry.isFile() && MD_RE.test(entry.name)) {
                const rel = path.relative(root, abs).split(path.sep).join('/');
                docs.set(rel, await fs.readFile(abs, 'utf8'));
            }
        }
    }
    await walk(root);
    return buildIndex(docs);
}

/** 附件名只留安全字符；重名时塞时间戳，不覆盖。 */
async function saveAttachment(root: string, bytes: Buffer, hint: string): Promise<string> {
    const base = path.posix.basename(hint.replaceAll('\\', '/'));
    const stem = base.replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'file';
    const ext = (base.match(/\.[^.]*$/)?.[0] ?? '.bin').slice(0, 16);
    const dir = path.join(root, 'attachments');
    await fs.mkdir(dir, { recursive: true });
    let name = `${stem}${ext}`;
    for (let i = 0; await fileExists(path.join(dir, name)); i++) {
        name = `${stem}-${Date.now()}-${i}${ext}`;
    }
    await fs.writeFile(path.join(dir, name), bytes);
    return `attachments/${name}`;
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

/**
 * GET /attachments/<name>：把 vault 附件端给 <img>/<video>/<audio>。
 * md 里存的是相对路径，页面根就是 vault 根；合入后 daemon 按同样规则端。
 */
export async function serveAttachment(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const raw = req.url ?? '';
    if (req.method !== 'GET' || !raw.startsWith('/attachments/')) return false;
    const name = decodeURIComponent(raw.slice('/attachments/'.length).split('?')[0]);
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..') || name.startsWith('.')) {
        fail(res, 400, '附件名非法');
        return true;
    }
    try {
        const abs = path.join(vaultRoot(), 'attachments', name);
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
    const root = vaultRoot();

    try {
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
            if (!MD_RE.test(p)) return fail(res, 400, '只读 .md');
            const raw = await fs.readFile(path.join(root, p), 'utf8');
            // muya 的 lexer 只认 LF；Windows 盘上的 CRLF 在读出层统一掉，写回也是 LF
            send(res, 200, { path: p, markdown: raw.replace(/\r\n?/g, '\n') });
            return true;
        }

        if (req.method === 'PUT' && pathname === 'doc') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { path?: string; markdown?: string };
            const p = safeRel(body.path ?? '');
            if (!p || !MD_RE.test(p) || typeof body.markdown !== 'string') {
                return fail(res, 400, '需要 {path: *.md, markdown}');
            }
            const abs = path.join(root, p);
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, body.markdown, 'utf8');
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
            const results: FolioListItem[] = [];
            for (const item of await listMarkdown(root, {})) {
                const markdown = await fs.readFile(path.join(root, item.path), 'utf8');
                const hit = markdown.toLowerCase().indexOf(needle);
                if (hit === -1) continue;
                const lines = markdown.split('\n');
                const lineNo = markdown.slice(0, hit).split('\n').length - 1;
                results.push({ ...item, snippet: `…${(lines[lineNo] ?? '').trim().slice(0, 60)}` });
                if (results.length >= 50) break;
            }
            send(res, 200, results);
            return true;
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

        return fail(res, 404, `未知路由 ${req.method} /folio/v1/${pathname}`);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400;
        return fail(res, code, err instanceof Error ? err.message : String(err));
    }
}
