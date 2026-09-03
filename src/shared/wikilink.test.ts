import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildIndex, linksFor, outgoingLinks, resolveLink } from './wikilink.ts';

const DOCS = new Map([
    ['notes/欢迎.md', '# 欢迎\n见 [[示例速记]] 和 [[notes/长文]]。重复 [[示例速记]]。'],
    ['memos/示例速记.md', '一条 [[欢迎]]'],
    ['notes/长文.md', '长文内容，无链接'],
    ['notes/孤儿链接.md', '链向 [[不存在的页]]'],
]);

test('outgoingLinks：去重、只认 [[]] 语法', () => {
    assert.deepEqual(outgoingLinks(DOCS.get('notes/欢迎.md')!), ['示例速记', 'notes/长文']);
});

test('outgoingLinks：别名写法 [[目标|文字]] 取目标', () => {
    assert.deepEqual(outgoingLinks('看 [[notes/长文|那篇长文]] 就行'), ['notes/长文']);
});

test('resolveLink：按文件名（大小写不敏感）命中', () => {
    const index = buildIndex(DOCS);
    assert.equal(resolveLink(index, '示例速记'), 'memos/示例速记.md');
    assert.equal(resolveLink(index, '欢迎'), 'notes/欢迎.md');
});

test('resolveLink：路径精确命中（带不带 .md 都行）', () => {
    const index = buildIndex(DOCS);
    assert.equal(resolveLink(index, 'notes/长文.md'), 'notes/长文.md');
    assert.equal(resolveLink(index, 'notes/长文'), 'notes/长文.md');
});

test('resolveLink：解析不了给 null', () => {
    const index = buildIndex(DOCS);
    assert.equal(resolveLink(index, '不存在的页'), null);
});

test('linksFor：出链解析到页、自链剔除', () => {
    const index = buildIndex(DOCS);
    assert.deepEqual(linksFor(index, 'notes/欢迎.md').outgoing, ['memos/示例速记.md', 'notes/长文.md']);
});

test('linksFor：反链能看到谁链过来', () => {
    const index = buildIndex(DOCS);
    assert.deepEqual(linksFor(index, 'notes/欢迎.md').backlinks, ['memos/示例速记.md']);
    assert.deepEqual(linksFor(index, 'memos/示例速记.md').backlinks, ['notes/欢迎.md']);
    assert.deepEqual(linksFor(index, 'notes/长文.md').backlinks, ['notes/欢迎.md']);
});
