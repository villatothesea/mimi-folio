import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTags, splitFrontmatter } from './frontmatter.ts';

test('tags: 行内数组写法', () => {
    assert.deepEqual(parseTags('title: x\ntags: [项目, 长文]\n'), ['项目', '长文']);
});

test('tags: 逗号分隔写法', () => {
    assert.deepEqual(parseTags('tags: a, b , c'), ['a', 'b', 'c']);
});

test('tags: 短横线列表写法', () => {
    assert.deepEqual(parseTags('tags:\n  - 项目\n  - 速记\ntitle: y\n'), ['项目', '速记']);
});

test('引号与重复清理', () => {
    assert.deepEqual(parseTags('tags: ["a", \'b\', a]'), ['a', 'b']);
});

test('没有 tags 键就给空', () => {
    assert.deepEqual(parseTags('title: x\nstatus: done\n'), []);
});

test('splitFrontmatter：有围栏时拆出 tags 与正文', () => {
    const doc = '---\ntags: [a, b]\ntitle: t\n---\n# 正文\n';
    const split = splitFrontmatter(doc);
    assert.deepEqual(split.tags, ['a', 'b']);
    assert.equal(split.body, '# 正文\n');
    assert.equal(split.frontmatter, 'tags: [a, b]\ntitle: t');
});

test('splitFrontmatter：没有围栏原样返回', () => {
    const doc = '# 没有frontmatter\n';
    const split = splitFrontmatter(doc);
    assert.deepEqual(split.tags, []);
    assert.equal(split.body, doc);
});

test('splitFrontmatter：正文里出现 --- 不算围栏', () => {
    const doc = '前言\n---\ntags: [x]\n---\n';
    const split = splitFrontmatter(doc);
    assert.deepEqual(split.tags, []);
});
