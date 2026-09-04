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
    '---\ntags: [速记]\n---\n# 一条速记\n\n想到 [[tagged]]。\n',
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

describe('GET /folio/v1/*', () => {
    it('list 返回全部 md、标题、tags 与 kind', async () => {
        const res = await fetch(`${base}/folio/v1/list`);
        const files = (await res.json()) as { path: string; title: string; tags: string[]; kind: string }[];
        assert.equal(files.length, 5);
        const tagged = files.find((f) => f.path === 'notes/tagged.md')!;
        assert.deepEqual(tagged.tags, ['项目', '长文']);
        assert.equal(tagged.kind, 'note');
        const memo = files.find((f) => f.path === 'memos/m1.md')!;
        assert.equal(memo.kind, 'memo');
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

    it('标题取自正文第一个标题，不用 YAML title、不用文件名', async () => {
        const res = await fetch(`${base}/folio/v1/list`);
        const files = (await res.json()) as { path: string; title: string }[];
        assert.equal(files.find((f) => f.path === 'memos/m1.md')!.title, '一条速记');
        assert.equal(files.find((f) => f.path === 'notes/named.md')!.title, '正文H1');
        assert.equal(files.find((f) => f.path === 'notes/orphan.md')!.title, 'orphan.md');
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

    it('标题命中排第一', async () => {
        const res = await fetch(`${base}/folio/v1/search?q=${encodeURIComponent('速记')}`);
        const results = (await res.json()) as { title: string; matches: { text: string }[] }[];
        const memo = results.find((r) => r.title === '一条速记')!;
        assert.equal(memo.matches[0].text, '一条速记');
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
