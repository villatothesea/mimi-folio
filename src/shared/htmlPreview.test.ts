import assert from 'node:assert/strict';
import { test } from 'node:test';

import { htmlPreviewSandbox, htmlPreviewScriptsEnabled, isHtmlPath, previewSrc, setHtmlPreviewScriptsEnabled } from './htmlPreview.ts';

test('认 .html / .htm，不认 md', () => {
    assert.equal(isHtmlPath('links/页.html'), true);
    assert.equal(isHtmlPath('notes/a.HTM'), true);
    assert.equal(isHtmlPath('notes/a.md'), false);
});

test('预览 URL 按段编码，相对资源才跟得上目录', () => {
    assert.equal(previewSrc('links/docs/页.html'), '/folio/v1/preview/links/docs/%E9%A1%B5.html');
});

test('脚本开关未存过则默认开，只有 0 关掉', () => {
    const mem = new Map<string, string>();
    const store = {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => { mem.set(k, v); },
    };
    assert.equal(htmlPreviewScriptsEnabled(store), true);
    setHtmlPreviewScriptsEnabled(false, store);
    assert.equal(htmlPreviewScriptsEnabled(store), false);
    setHtmlPreviewScriptsEnabled(true, store);
    assert.equal(htmlPreviewScriptsEnabled(store), true);
});

test('sandbox 开脚本是 allow-scripts，关掉仍保留空 sandbox', () => {
    assert.equal(htmlPreviewSandbox(true), 'allow-scripts');
    assert.equal(htmlPreviewSandbox(false), '');
});
