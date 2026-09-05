import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getScalar, parseTags, setScalar, setTags, splitFrontmatter } from './frontmatter.ts';

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

test('setTags：有 frontmatter 时替换 tags 行，其余键保留', () => {
    const doc = '---\ntitle: t\ntags: [旧]\n---\n# 正文\n';
    assert.equal(setTags(doc, ['新', '标签']), '---\ntitle: t\ntags: [新, 标签]\n---\n\n# 正文\n');
});

test('setTags：吃掉旧 tags 的短横线续行', () => {
    const doc = '---\ntags:\n  - a\n  - b\ntitle: t\n---\n正文\n';
    assert.equal(setTags(doc, ['x']), '---\ntitle: t\ntags: [x]\n---\n\n正文\n');
});

test('setTags：没有 frontmatter 时新建一段', () => {
    assert.equal(setTags('# 标题\n', ['a']), '---\ntags: [a]\n---\n\n# 标题\n');
});

test('setTags：空数组整段摘除', () => {
    const doc = '---\ntags: [a]\ntitle: t\n---\n# 正文\n';
    assert.equal(setTags(doc, []), '---\ntitle: t\n---\n\n# 正文\n');
});

test('setScalar：写布尔键并保留其它键', () => {
    const doc = '---\ntags: [a]\ntitle: t\n---\n# 正文\n';
    assert.equal(setScalar(doc, 'favorite', true), '---\ntags: [a]\ntitle: t\nfavorite: true\n---\n\n# 正文\n');
});

test('setScalar：null 移除键', () => {
    const doc = '---\ntags: [a]\nfavorite: true\n---\n# 正文\n';
    assert.equal(setScalar(doc, 'favorite', null), '---\ntags: [a]\n---\n\n# 正文\n');
});

test('setScalar：没有 frontmatter 时新建', () => {
    assert.equal(setScalar('# 标\n', 'favorite', true), '---\nfavorite: true\n---\n\n# 标\n');
});

test('setScalar：写 title 不改正文 H1', () => {
    const doc = '---\ntags: [a]\n---\n# 正文标题\n';
    assert.equal(setScalar(doc, 'title', '新名'), '---\ntags: [a]\ntitle: 新名\n---\n\n# 正文标题\n');
});

test('getScalar：读 title，认引号', () => {
    assert.equal(getScalar('---\ntitle: 裸名\n---\n# H1\n', 'title'), '裸名');
    assert.equal(getScalar('---\ntitle: "Foo: Bar"\n---\n', 'title'), 'Foo: Bar');
    assert.equal(getScalar('# 无围栏\n', 'title'), null);
});
