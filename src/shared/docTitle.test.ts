import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    displayTitle,
    fileName,
    fileStem,
    firstHeading,
    newNoteMarkdown,
    renamedPath,
    setDisplayTitle,
    setFirstHeading,
    yamlTitle,
} from './docTitle.ts';

test('fileName 是路径最后一段，含扩展名，不是标题', () => {
    assert.equal(fileName('links/docs/计划.md'), '计划.md');
    assert.equal(fileStem('links/docs/计划.md'), '计划');
});

test('renamedPath 只改文件名、保留扩展名，再写 .md 不会叠', () => {
    assert.equal(renamedPath('notes/a.md', '新名'), 'notes/新名.md');
    assert.equal(renamedPath('notes/a.md', '新名.md'), 'notes/新名.md');
    assert.equal(renamedPath('notes/a.md', 'a'), null);
    assert.equal(renamedPath('notes/a.md', '  '), null);
    assert.equal(renamedPath('links/x.html', '改'), 'links/改.html');
});

test('yamlTitle 读 frontmatter title，忽略正文 H1', () => {
    const doc = '---\ntitle: YAML名\n---\n# 施工 · 会场\n\n## 下一节\n';
    assert.equal(yamlTitle(doc), 'YAML名');
    assert.equal(firstHeading(doc), '施工 · 会场');
});

test('firstHeading 认 CRLF', () => {
    assert.equal(firstHeading('# 施工 · 会场\r\n\r\n正文\r\n'), '施工 · 会场');
});

test('没有 YAML title 时 displayTitle 露出真文件名，不用 H1', () => {
    assert.equal(displayTitle('notes/orphan.md', '一段没有标题的正文\n'), 'orphan.md');
    assert.equal(displayTitle('notes/has-h1.md', '# 正文H1\n'), 'has-h1.md');
});

test('有 YAML title 时 displayTitle 用它，不用 H1 也不用文件名', () => {
    const doc = '---\ntitle: YAML名\n---\n# 真正的H1\n';
    assert.equal(displayTitle('links/docs/计划.md', doc), 'YAML名');
});

test('setDisplayTitle 写 title: 不改正文 H1', () => {
    const doc = '---\ntags: [a]\n---\n# 正文标题\n';
    assert.equal(setDisplayTitle(doc, '新名'), '---\ntags: [a]\ntitle: 新名\n---\n\n# 正文标题\n');
});

test('setDisplayTitle 标题含冒号时加引号', () => {
    const next = setDisplayTitle('# 正文\n', 'Foo: Bar');
    assert.equal(yamlTitle(next), 'Foo: Bar');
    assert.match(next, /title: "Foo: Bar"/);
    assert.match(next, /# 正文/);
    assert.match(next, /---\n\n# 正文/);
});

test('newNoteMarkdown 只有 title:，没有 H1', () => {
    const doc = newNoteMarkdown('未命名笔记');
    assert.equal(yamlTitle(doc), '未命名笔记');
    assert.equal(firstHeading(doc), null);
    assert.equal(doc, '---\ntitle: 未命名笔记\n---\n');
});

test('setFirstHeading 改 H1 文字、保留级别、不写 title:', () => {
    const doc = '---\ntags: [a]\n---\n## 旧名\n\n正文\n';
    assert.equal(setFirstHeading(doc, '新名'), '---\ntags: [a]\n---\n## 新名\n\n正文\n');
});

test('setFirstHeading 没有标题时在开头插入 H1', () => {
    assert.equal(setFirstHeading('只有正文\n', '新篇'), '# 新篇\n\n只有正文\n');
});
