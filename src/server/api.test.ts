import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

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
    '---\ntags: [速记]\n---\n# 一条速记\n',
    'utf8',
);

const server = createAppServer();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

after(() => void server.close());

describe('GET /folio/v1/*', () => {
    it('list 返回全部 md、标题、tags 与 kind', async () => {
        const res = await fetch(`${base}/folio/v1/list`);
        const files = (await res.json()) as { path: string; title: string; tags: string[]; kind: string }[];
        assert.equal(files.length, 3);
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

    it('标题取自 frontmatter 之后的正文', async () => {
        const res = await fetch(`${base}/folio/v1/list`);
        const files = (await res.json()) as { path: string; title: string }[];
        assert.equal(files.find((f) => f.path === 'memos/m1.md')!.title, '一条速记');
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
