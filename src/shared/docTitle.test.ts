import assert from 'node:assert/strict';
import { test } from 'node:test';

import { displayTitle, fileName, fileStem, firstHeading, setFirstHeading } from './docTitle.ts';

test('fileName 是路径最后一段，含扩展名，不是标题', () => {
    assert.equal(fileName('links/docs/计划.md'), '计划.md');
    assert.equal(fileStem('links/docs/计划.md'), '计划');
});

test('firstHeading 取正文第一个标题，忽略 frontmatter title', () => {
    const doc = '---\ntitle: YAML名\n---\n# 施工 · 会场\n\n## 下一节\n';
    assert.equal(firstHeading(doc), '施工 · 会场');
});

test('firstHeading 认 CRLF', () => {
    assert.equal(firstHeading('# 施工 · 会场\r\n\r\n正文\r\n'), '施工 · 会场');
});

test('没有标题时 displayTitle 露出真文件名', () => {
    assert.equal(displayTitle('notes/orphan.md', '一段没有标题的正文\n'), 'orphan.md');
});

test('有标题时 displayTitle 用 H1 不用 YAML title 也不用文件名', () => {
    const doc = '---\ntitle: YAML名\n---\n# 真正的H1\n';
    assert.equal(displayTitle('links/docs/计划.md', doc), '真正的H1');
});

test('setFirstHeading 改 H1 文字、保留级别、不写 title:', () => {
    const doc = '---\ntags: [a]\n---\n## 旧名\n\n正文\n';
    assert.equal(setFirstHeading(doc, '新名'), '---\ntags: [a]\n---\n## 新名\n\n正文\n');
});

test('setFirstHeading 没有标题时在开头插入 H1', () => {
    assert.equal(setFirstHeading('只有正文\n', '新篇'), '# 新篇\n\n只有正文\n');
});
