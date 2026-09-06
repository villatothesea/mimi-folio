import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isMarkdownFile, looksLikeMarkdownSource } from './markdownPaste.ts';

test('认 .md / .markdown 文件，不认图', () => {
    assert.equal(isMarkdownFile({ name: 'a.md', type: '' }), true);
    assert.equal(isMarkdownFile({ name: 'a.markdown', type: 'text/plain' }), true);
    assert.equal(isMarkdownFile({ name: 'a.bin', type: 'text/markdown' }), true);
    assert.equal(isMarkdownFile({ name: 'a.png', type: 'image/png' }), false);
});

test('YAML 围栏、标题、代码块算 md 源', () => {
    assert.equal(looksLikeMarkdownSource('---\ntitle: t\n---\n\n# hi\n'), true);
    assert.equal(looksLikeMarkdownSource('[EN]\n\n# 从 Copy-on-Write 到 Mailbox\n\n正文\n'), true);
    assert.equal(looksLikeMarkdownSource('```ts\nconst x = 1;\n```\n'), true);
    assert.equal(looksLikeMarkdownSource('hello'), false);
    assert.equal(looksLikeMarkdownSource('col1\tcol2\na\tb\n'), false);
});
