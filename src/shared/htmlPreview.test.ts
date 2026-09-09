import assert from 'node:assert/strict';
import { test } from 'node:test';

import { folioEntryToken, htmlPreviewSandbox, htmlPreviewScriptsEnabled, isHtmlPath, previewFrameHref, previewSrc, setHtmlPreviewScriptsEnabled, withPreviewNav } from './htmlPreview.ts';

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

test('sandbox 始终给同源好跳锚点；开脚本再加 allow-scripts', () => {
    assert.equal(htmlPreviewSandbox(true), 'allow-scripts allow-same-origin');
    assert.equal(htmlPreviewSandbox(false), 'allow-same-origin');
});

test('预览 iframe 与父页拆开 loopback 主机', () => {
    assert.equal(
        previewFrameHref('/folio/v1/preview/links/a.html', 'http://127.0.0.1:5173'),
        'http://localhost:5173/folio/v1/preview/links/a.html',
    );
    assert.equal(
        previewFrameHref('/folio/v1/preview/links/a.html', 'http://localhost:5173'),
        'http://127.0.0.1:5173/folio/v1/preview/links/a.html',
    );
    assert.equal(
        previewFrameHref('http://localhost:5173/folio/v1/preview/a.html', 'http://127.0.0.1:5173'),
        'http://localhost:5173/folio/v1/preview/a.html',
    );
});

test('合入米米时 loopback 换位须带入口 token', () => {
    assert.equal(
        previewFrameHref('/folio/v1/preview/a.html', 'http://127.0.0.1:64203', { token: 'abc' }),
        'http://localhost:64203/folio/v1/preview/a.html?token=abc',
    );
    assert.equal(
        previewFrameHref('/folio/v1/preview/a.html#s2', 'http://127.0.0.1:64203', { token: 'abc' }),
        'http://localhost:64203/folio/v1/preview/a.html?token=abc#s2',
    );
    assert.equal(folioEntryToken('?token=t1&host=mimi'), 't1');
});

test('预览副本插入锚点滚动脚本，不改传入串的原文件语义', () => {
    const src = '<body><a href="#s2">二</a></body>';
    const out = withPreviewNav(src);
    assert.match(out, /data-folio-preview-nav/);
    assert.match(out, /scrollBehavior/);
    assert.equal(withPreviewNav(out), out);
    assert.match(out, /<a href="#s2">二<\/a>/);
});
