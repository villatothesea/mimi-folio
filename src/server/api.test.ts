import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { closeVaultWatcher } from './api.ts';
import { createAppServer } from './main.ts';

const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'folio-vault-'));
process.env.FOLIO_VAULT = vault;

await fs.mkdir(path.join(vault, 'notes'), { recursive: true });
await fs.mkdir(path.join(vault, 'memos'), { recursive: true });
await fs.writeFile(path.join(vault, 'notes', 'a.md'), '# A\r\n\r\nWindows 换行\r\n', 'utf8');
await fs.writeFile(
    path.join(vault, 'notes', 'tagged.md'),
    '---\ntags: [项目, 长文]\n---\n# 有标签的笔记\n',
    'utf8',
);
await fs.writeFile(
    path.join(vault, 'memos', 'm1.md'),
    '---\ntags: [速记]\ntitle: 一条速记\n---\n# 一条速记\n\n想到 [[tagged]]。\n',
    'utf8',
);
await fs.writeFile(path.join(vault, 'notes', 'orphan.md'), '链向 [[m1]]\n', 'utf8');
await fs.writeFile(
    path.join(vault, 'notes', 'named.md'),
    '---\ntitle: YAML标题\n---\n# 正文H1\n',
    'utf8',
);

// 单元 10：vault 外的真源文件
const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'folio-outside-'));
const outsideMd = path.join(outsideDir, '外部文档.md');
await fs.writeFile(outsideMd, '# 外部文档\n\n真源在 vault 外。\n', 'utf8');

const server = createAppServer();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

after(() => {
    closeVaultWatcher();
    void server.close();
});

describe('POST /folio/v1/presence|bye', () => {
    it('存活心跳与关页 beacon 都是 204 空体', async () => {
        for (const p of ['presence', 'bye']) {
            const res = await fetch(`${base}/folio/v1/${p}`, { method: 'POST' });
            assert.equal(res.status, 204);
            assert.equal(await res.text(), '');
        }
    });
});

describe('GET /folio/v1/*', () => {
    it('list 返回全部 md、标题、tags 与 kind', async () => {
        const res = await fetch(`${base}/folio/v1/list`);
        const files = (await res.json()) as {
            path: string;
            title: string;
            tags: string[];
            kind: string;
            mtimeMs?: number;
            markdown?: string;
        }[];
        assert.equal(files.length, 5);
        const tagged = files.find((f) => f.path === 'notes/tagged.md')!;
        assert.deepEqual(tagged.tags, ['项目', '长文']);
        assert.equal(tagged.kind, 'note');
        const memo = files.find((f) => f.path === 'memos/m1.md')!;
        assert.equal(memo.kind, 'memo');
        assert.equal(typeof memo.mtimeMs, 'number');
        assert.ok(memo.markdown?.includes('想到 [[tagged]]'));
        assert.equal(files.find((f) => f.path === 'notes/a.md')!.markdown, undefined);
        assert.equal(files.find((f) => f.path === 'notes/a.md')!.kind, 'note');
    });

    it('list?tag= 筛出含该标签的文件', async () => {
        const res = await fetch(`${base}/folio/v1/list?tag=${encodeURIComponent('项目')}`);
        const files = (await res.json()) as { path: string }[];
        assert.deepEqual(files.map((f) => f.path), ['notes/tagged.md']);
    });

    it('list?kind=memo 只给速记', async () => {
        const res = await fetch(`${base}/folio/v1/list?kind=memo`);
        const files = (await res.json()) as { path: string }[];
        assert.deepEqual(files.map((f) => f.path), ['memos/m1.md']);
    });

    it('list?dir= 只给该目录', async () => {
        const res = await fetch(`${base}/folio/v1/list?dir=memos`);
        const files = (await res.json()) as { path: string }[];
        assert.deepEqual(files.map((f) => f.path), ['memos/m1.md']);
    });

    it('标题就是文件名，不用 YAML title、不用正文 H1', async () => {
        const res = await fetch(`${base}/folio/v1/list`);
        const files = (await res.json()) as { path: string; title: string }[];
        assert.equal(files.find((f) => f.path === 'memos/m1.md')!.title, 'm1.md');
        assert.equal(files.find((f) => f.path === 'notes/named.md')!.title, 'named.md');
        assert.equal(files.find((f) => f.path === 'notes/orphan.md')!.title, 'orphan.md');
        assert.equal(files.find((f) => f.path === 'notes/tagged.md')!.title, 'tagged.md');
    });

    it('read 出来的是 LF（muya 只认 LF）', async () => {
        const res = await fetch(`${base}/folio/v1/doc?path=notes/a.md`);
        const doc = (await res.json()) as { markdown: string };
        assert.ok(!doc.markdown.includes('\r'));
        assert.ok(doc.markdown.includes('# A'));
    });

    it('read 不存在的文件 404', async () => {
        const res = await fetch(`${base}/folio/v1/doc?path=notes/none.md`);
        assert.equal(res.status, 404);
    });

    it('read 越界路径 400', async () => {
        for (const p of ['../package.json', '..%2Fpackage.json', 'notes\\\\..\\\\x.md', '']) {
            const res = await fetch(`${base}/folio/v1/doc?path=${encodeURIComponent(p)}`);
            assert.equal(res.status, 400, `path=${p}`);
        }
    });

    it('read 非 .md 400', async () => {
        const res = await fetch(`${base}/folio/v1/doc?path=notes/a.txt`);
        assert.equal(res.status, 400);
    });

    it('未知路由 404', async () => {
        const res = await fetch(`${base}/folio/v1/nothing`);
        assert.equal(res.status, 404);
    });
});

describe('PUT /folio/v1/doc', () => {
    it('写入并落盘（含新建子目录）', async () => {
        const res = await fetch(`${base}/folio/v1/doc`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'notes/sub/new.md', markdown: '# 新\n' }),
        });
        assert.equal(res.status, 204);
        assert.equal(await fs.readFile(path.join(vault, 'notes', 'sub', 'new.md'), 'utf8'), '# 新\n');
    });

    it('body 非法 400', async () => {
        const res = await fetch(`${base}/folio/v1/doc`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: '{bad json',
        });
        assert.equal(res.status, 400);
    });

    it('写非 .md 400', async () => {
        const res = await fetch(`${base}/folio/v1/doc`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'notes/x.exe', markdown: 'MZ' }),
        });
        assert.equal(res.status, 400);
    });
});

describe('GET /folio/v1/index', () => {
    it('出链解析到具体页，反链能看见谁链过来', async () => {
        const res = await fetch(`${base}/folio/v1/index?path=${encodeURIComponent('memos/m1.md')}`);
        const index = (await res.json()) as { outgoing: string[]; backlinks: string[] };
        assert.deepEqual(index.outgoing, ['notes/tagged.md']);
        assert.deepEqual(index.backlinks, ['notes/orphan.md']);
    });

    it('按文件名解析跨目录链接', async () => {
        const res = await fetch(`${base}/folio/v1/index?path=${encodeURIComponent('notes/orphan.md')}`);
        const index = (await res.json()) as { outgoing: string[]; backlinks: string[] };
        assert.deepEqual(index.outgoing, ['memos/m1.md']);
        assert.deepEqual(index.backlinks, []);
    });

    it('index 缺 path 400', async () => {
        const res = await fetch(`${base}/folio/v1/index`);
        assert.equal(res.status, 400);
    });
});

describe('库外链入（单元 10）', () => {
    it('链入后 list 标 linked，read 直达原文', async () => {
        const res = await fetch(`${base}/folio/v1/link`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: outsideMd }),
        });
        assert.equal(res.status, 200);
        const { path: rel } = (await res.json()) as { path: string };
        assert.equal(rel, 'links/外部文档.md');

        const list = (await (await fetch(`${base}/folio/v1/list`)).json()) as { path: string; linked?: boolean }[];
        const item = list.find((f) => f.path === rel)!;
        assert.equal(item.linked, true);

        const doc = (await (await fetch(`${base}/folio/v1/doc?path=${encodeURIComponent(rel)}`)).json()) as { markdown: string };
        assert.ok(doc.markdown.includes('真源在 vault 外'));
    });

    it('write 穿透回原文件（盘上无第二份正文）', async () => {
        const put = await fetch(`${base}/folio/v1/doc`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'links/外部文档.md', markdown: '# 外部文档\n\n改过了。\n' }),
        });
        assert.equal(put.status, 204);
        // 原文件（vault 外路径）被同步修改
        assert.equal(await fs.readFile(outsideMd, 'utf8'), '# 外部文档\n\n改过了。\n');
    });

    it('失败不落拷贝：不存在的源 400 且 links/ 不多文件', async () => {
        const before = await fs.readdir(path.join(vault, 'links'));
        const res = await fetch(`${base}/folio/v1/link`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: path.join(outsideDir, '没有这个.md') }),
        });
        assert.equal(res.status, 400);
        const after = await fs.readdir(path.join(vault, 'links'));
        assert.deepEqual(after, before);
    });

    it('vault 内的文件拒绝链入', async () => {
        const res = await fetch(`${base}/folio/v1/link`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: path.join(vault, 'notes', 'a.md') }),
        });
        assert.equal(res.status, 400);
    });

    it('文件夹链入后，源目录新 md 自动出现在 list，写回真源、不拷贝', async () => {
        const src = await fs.mkdtemp(path.join(os.tmpdir(), 'folio-folder-'));
        await fs.writeFile(path.join(src, '先有.md'), '# 先有\n', 'utf8');
        const res = await fetch(`${base}/folio/v1/folderlink`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: src }),
        });
        assert.equal(res.status, 200, await res.text());
        const dirName = path.basename(src);
        const first = (await (await fetch(`${base}/folio/v1/list`)).json()) as { path: string; linked?: boolean }[];
        const existing = first.find((f) => f.path === `links/${dirName}/先有.md`);
        assert.ok(existing, '链入时应列出已有 md');
        assert.equal(existing!.linked, true);

        await fs.mkdir(path.join(src, '子夹'));
        await fs.writeFile(path.join(src, '后加.md'), '# 后加\n真源\n', 'utf8');
        await fs.writeFile(path.join(src, '子夹', '深.md'), '# 深\n', 'utf8');

        const next = (await (await fetch(`${base}/folio/v1/list`)).json()) as { path: string }[];
        assert.ok(next.some((f) => f.path === `links/${dirName}/后加.md`), '源目录新文件应进清单');
        assert.ok(next.some((f) => f.path === `links/${dirName}/子夹/深.md`), '源目录子文件夹新文件应进清单');

        const put = await fetch(`${base}/folio/v1/doc`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: `links/${dirName}/后加.md`, markdown: '# 后加\n改过\n' }),
        });
        assert.equal(put.status, 204);
        assert.equal(await fs.readFile(path.join(src, '后加.md'), 'utf8'), '# 后加\n改过\n');
        assert.equal(
            await fs.access(path.join(src, '.folio-origin')).then(() => true, () => false),
            false,
            '不得把 .folio-origin 写进源文件夹',
        );
    });

    it('更换外链文件夹路径后 list 换成新源，写回新真源、不拷贝', async () => {
        const srcA = await fs.mkdtemp(path.join(os.tmpdir(), 'folio-relink-a-'));
        const srcB = await fs.mkdtemp(path.join(os.tmpdir(), 'folio-relink-b-'));
        await fs.writeFile(path.join(srcA, '甲.md'), '# 甲\n', 'utf8');
        await fs.writeFile(path.join(srcB, '乙.md'), '# 乙\n真源B\n', 'utf8');
        const linked = await fetch(`${base}/folio/v1/folderlink`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: srcA }),
        });
        assert.equal(linked.status, 200, await linked.text());
        const dir = `links/${path.basename(srcA)}`;
        const res = await fetch(`${base}/folio/v1/folderrelink`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dir, source: srcB }),
        });
        assert.equal(res.status, 200, await res.text());
        const list = (await (await fetch(`${base}/folio/v1/list`)).json()) as { path: string }[];
        assert.ok(list.some((f) => f.path === `${dir}/乙.md`), '应列出新源里的 md');
        assert.ok(!list.some((f) => f.path === `${dir}/甲.md`), '旧源文件不应再出现');
        const put = await fetch(`${base}/folio/v1/doc`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: `${dir}/乙.md`, markdown: '# 乙\n改过B\n' }),
        });
        assert.equal(put.status, 204);
        assert.equal(await fs.readFile(path.join(srcB, '乙.md'), 'utf8'), '# 乙\n改过B\n');
        assert.equal(await fs.readFile(path.join(srcA, '甲.md'), 'utf8'), '# 甲\n');
        assert.equal(
            await fs.access(path.join(srcB, '.folio-origin')).then(() => true, () => false),
            false,
            '不得把 .folio-origin 写进新源',
        );
    });
});

describe('全文搜索（单元 13/验收批）', () => {
    it('正文多处命中给多条 match，start 指向行内偏移', async () => {
        await fs.writeFile(
            path.join(vault, 'notes', 's.md'),
            '# 甲文\n\n第一处甲烷在这里。\n无关行。\n又一处甲烷。\n',
            'utf8',
        );
        const res = await fetch(`${base}/folio/v1/search?q=${encodeURIComponent('甲烷')}`);
        const results = (await res.json()) as { path: string; matches: { text: string; start: number }[] }[];
        const hit = results.find((r) => r.path === 'notes/s.md')!;
        assert.equal(hit.matches.length, 2);
        assert.equal(hit.matches[0].text.indexOf('甲烷'), hit.matches[0].start);
    });

    it('文件名命中排第一', async () => {
        const res = await fetch(`${base}/folio/v1/search?q=${encodeURIComponent('m1')}`);
        const results = (await res.json()) as { path: string; title: string; matches: { text: string }[] }[];
        const memo = results.find((r) => r.path === 'memos/m1.md')!;
        assert.equal(memo.title, 'm1.md');
        assert.equal(memo.matches[0].text, 'm1.md');
    });

    it('空查询返回空数组', async () => {
        const res = await fetch(`${base}/folio/v1/search`);
        assert.deepEqual(await res.json(), []);
    });
});

describe('文档管理（验收清单 14）', () => {
    it('move 移动文件（含跨目录），缓存同步失效', async () => {
        const res = await fetch(`${base}/folio/v1/move`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ from: 'notes/orphan.md', to: 'memos/orphan.md' }),
        });
        assert.equal(res.status, 200);
        const list = (await (await fetch(`${base}/folio/v1/list`)).json()) as { path: string }[];
        assert.ok(!list.some((f) => f.path === 'notes/orphan.md'));
        assert.ok(list.some((f) => f.path === 'memos/orphan.md'));
    });

    it('copy 复制副本，目标已存在 400', async () => {
        const res = await fetch(`${base}/folio/v1/copy`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ from: 'memos/orphan.md', to: 'memos/orphan-1.md' }),
        });
        assert.equal(res.status, 200);
        const again = await fetch(`${base}/folio/v1/copy`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ from: 'memos/orphan.md', to: 'memos/orphan-1.md' }),
        });
        assert.equal(again.status, 400);
    });

    it('delete 删除文件与 .bak', async () => {
        const res = await fetch(`${base}/folio/v1/delete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ from: 'memos/orphan-1.md' }),
        });
        assert.equal(res.status, 204);
        const list = (await (await fetch(`${base}/folio/v1/list`)).json()) as { path: string }[];
        assert.ok(!list.some((f) => f.path === 'memos/orphan-1.md'));
    });
});

describe('写回保护（米米建议 2/3/5）', () => {
    it('read 带 mtimeMs；PUT If-Match 不匹配 409 且不落盘', async () => {
        const doc = (await (await fetch(`${base}/folio/v1/doc?path=${encodeURIComponent('notes/a.md')}`)).json()) as { mtimeMs: number };
        assert.equal(typeof doc.mtimeMs, 'number');
        const res = await fetch(`${base}/folio/v1/doc`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', 'if-match': String(doc.mtimeMs - 5000) },
            body: JSON.stringify({ path: 'notes/a.md', markdown: '# 被盖掉' }),
        });
        assert.equal(res.status, 409);
        const after = (await (await fetch(`${base}/folio/v1/doc?path=${encodeURIComponent('notes/a.md')}`)).json()) as { markdown: string };
        assert.ok(!after.markdown.includes('被盖掉'));
    });

    it('PUT 落盘前留 .bak 快照（含旧内容，不进清单）', async () => {
        const res = await fetch(`${base}/folio/v1/doc`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'notes/a.md', markdown: '# A 新版\n' }),
        });
        assert.equal(res.status, 204);
        const bak = await fs.readFile(path.join(vault, 'notes', 'a.md.bak'), 'utf8');
        assert.ok(!bak.includes('新版'));
        const list = (await (await fetch(`${base}/folio/v1/list`)).json()) as { path: string }[];
        assert.ok(!list.some((f) => f.path.endsWith('.bak')));
    });

    it('写穿失效索引：PUT 后 search 能搜到新内容', async () => {
        await fetch(`${base}/folio/v1/doc`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'notes/a.md', markdown: '# A\n\n索引失效哨兵词。\n' }),
        });
        const res = await fetch(`${base}/folio/v1/search?q=${encodeURIComponent('哨兵词')}`);
        const results = (await res.json()) as { path: string }[];
        assert.ok(results.some((r) => r.path === 'notes/a.md'));
    });
});

describe('附件（saveImage/saveFile）', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);

    it('POST image 落盘并回相对路径', async () => {
        const res = await fetch(`${base}/folio/v1/image`, {
            method: 'POST',
            headers: { 'x-folio-hint': encodeURIComponent('截图.png'), 'content-type': 'application/octet-stream' },
            body: png,
        });
        const { src } = (await res.json()) as { src: string };
        assert.match(src, /^attachments\//);
        const onDisk = await fs.readFile(path.join(vault, 'attachments', path.basename(src)));
        assert.deepEqual([...onDisk], [...png]);
    });

    it('POST file 与 image 等价', async () => {
        const res = await fetch(`${base}/folio/v1/file`, {
            method: 'POST',
            headers: { 'x-folio-hint': encodeURIComponent('audio 语音.wav'), 'content-type': 'application/octet-stream' },
            body: Buffer.from('RIFF....WAVE'),
        });
        const { src } = (await res.json()) as { src: string };
        assert.match(src, /^attachments\/audio_/);
    });

    it('重名附件不覆盖', async () => {
        const first = await fetch(`${base}/folio/v1/image`, {
            method: 'POST', headers: { 'x-folio-hint': 'same.png' }, body: png,
        });
        const second = await fetch(`${base}/folio/v1/image`, {
            method: 'POST', headers: { 'x-folio-hint': 'same.png' }, body: png,
        });
        const a = (await first.json()) as { src: string };
        const b = (await second.json()) as { src: string };
        assert.notEqual(a.src, b.src);
    });

    it('GET /attachments/<name> 端文件且带 mime', async () => {
        await fs.writeFile(path.join(vault, 'attachments', 'clip.mp4'), Buffer.from('0000ftyp'));
        const res = await fetch(`${base}/attachments/clip.mp4`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'video/mp4');
    });

    it('GET /attachments 越界 400', async () => {
        const res = await fetch(`${base}/attachments/..%2F..%2Fpackage.json`);
        assert.equal(res.status, 400);
    });
});

describe('网络图片 pics/', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);

    it('POST pic 拉取 http 图并落盘 pics/', async () => {
        await fs.mkdir(path.join(vault, 'attachments'), { recursive: true });
        await fs.writeFile(path.join(vault, 'attachments', 'src.png'), png);
        const res = await fetch(`${base}/folio/v1/pic`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: `${base}/attachments/src.png` }),
        });
        assert.equal(res.status, 200);
        const { src } = (await res.json()) as { src: string };
        assert.match(src, /^pics\/src\.png$/);
        const onDisk = await fs.readFile(path.join(vault, 'pics', path.basename(src)));
        assert.deepEqual([...onDisk], [...png]);
    });

    it('GET /pics/<name> 端文件', async () => {
        await fs.mkdir(path.join(vault, 'pics'), { recursive: true });
        await fs.writeFile(path.join(vault, 'pics', 'web.webp'), Buffer.from('RIFF....WEBP'));
        const res = await fetch(`${base}/pics/web.webp`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'image/webp');
    });

    it('POST pic 拒绝非 http(s)', async () => {
        const res = await fetch(`${base}/folio/v1/pic`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: 'file:///tmp/a.png' }),
        });
        assert.equal(res.status, 400);
    });

    it('GET /pics 越界 400', async () => {
        const res = await fetch(`${base}/pics/..%2F..%2Fpackage.json`);
        assert.equal(res.status, 400);
    });
});

describe('GET /folio/v1/preview/*', () => {
    it('端 html 为网页，相对 css 跟目录走；CSP 不禁脚本（开关在 iframe sandbox）', async () => {
        const dir = path.join(vault, 'notes', 'site');
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'index.html'), '<h1>预览</h1><link rel="stylesheet" href="a.css">', 'utf8');
        await fs.writeFile(path.join(dir, 'a.css'), 'h1{color:black}', 'utf8');
        const page = await fetch(`${base}/folio/v1/preview/notes/site/index.html`);
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-type') ?? '', /text\/html/);
        assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
        const csp = page.headers.get('content-security-policy') ?? '';
        assert.match(csp, /object-src 'none'/);
        assert.doesNotMatch(csp, /script-src 'none'/);
        const html = await page.text();
        assert.match(html, /<h1>预览<\/h1>/);
        assert.match(html, /data-folio-preview-nav/);
        const css = await fetch(`${base}/folio/v1/preview/notes/site/a.css`);
        assert.equal(css.status, 200);
        assert.match(css.headers.get('content-type') ?? '', /text\/css/);
        assert.equal(await css.text(), 'h1{color:black}');
    });

    it('预览越界 400', async () => {
        const res = await fetch(`${base}/folio/v1/preview/..%2F..%2Fpackage.json`);
        assert.equal(res.status, 400);
    });
});

describe('工作区（切换 vault 根，不写进 md）', () => {
    it('默认至少有当前 vault；新建后 list 换成新区，切回原区', async () => {
        const listed = await fetch(`${base}/folio/v1/workspaces`);
        const before = (await listed.json()) as { items: { id: string; dir: string }[]; activeId: string };
        assert.ok(before.items.length >= 1);
        const origin = before.activeId;

        const other = await fs.mkdtemp(path.join(os.tmpdir(), 'folio-ws-'));
        await fs.mkdir(path.join(other, 'notes'), { recursive: true });
        await fs.writeFile(path.join(other, 'notes', 'only-here.md'), '# 只在新区\n', 'utf8');

        const created = await fetch(`${base}/folio/v1/workspaces`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: '编程', dir: other }),
        });
        assert.equal(created.status, 200);
        const item = (await created.json()) as { id: string; name: string };
        assert.equal(item.name, '编程');

        const files = (await (await fetch(`${base}/folio/v1/list`)).json()) as { path: string }[];
        assert.ok(files.some((f) => f.path === 'notes/only-here.md'));
        assert.ok(!files.some((f) => f.path === 'notes/a.md'));

        const back = await fetch(`${base}/folio/v1/workspace`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: origin }),
        });
        assert.equal(back.status, 204);
        const restored = (await (await fetch(`${base}/folio/v1/list`)).json()) as { path: string }[];
        assert.ok(restored.some((f) => f.path === 'notes/a.md'));

        const del = await fetch(`${base}/folio/v1/workspaces?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        assert.equal(del.status, 204);
    });
});
