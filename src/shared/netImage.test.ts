import assert from 'node:assert/strict';
import test from 'node:test';

import { imageUrlsFromClipboard, imageUrlsFromHtml, isHttpUrl, isImageUrl } from './netImage.ts';

test('isHttpUrl 只放行 http(s)', () => {
    assert.equal(isHttpUrl('https://cdn.example/a.png'), true);
    assert.equal(isHttpUrl('http://127.0.0.1/x.jpg'), true);
    assert.equal(isHttpUrl('file:///tmp/a.png'), false);
    assert.equal(isHttpUrl('javascript:alert(1)'), false);
});

test('isImageUrl 要带图片扩展名', () => {
    assert.equal(isImageUrl('https://cdn.example/a.png'), true);
    assert.equal(isImageUrl('https://cdn.example/a.PNG?w=8'), true);
    assert.equal(isImageUrl('https://example.com/page'), false);
    assert.equal(isImageUrl('https://example.com/a.png extra'), false);
});

test('HTML 里抽出 https img src', () => {
    const html = '<div><img src="https://cdn.example/shot.webp" alt="x"><img src="https://cdn.example/shot.webp"></div>';
    assert.deepEqual(imageUrlsFromHtml(html), ['https://cdn.example/shot.webp']);
});

test('剪贴板优先 HTML 图，其次纯文本 URL', () => {
    const html = imageUrlsFromClipboard({
        getData: (t) => (t === 'text/html' ? '<img src="https://a.test/x.png">' : 'https://b.test/y.jpg'),
    });
    assert.deepEqual(html, ['https://a.test/x.png']);
    const plain = imageUrlsFromClipboard({
        getData: (t) => (t === 'text/plain' ? 'https://b.test/y.jpg' : ''),
    });
    assert.deepEqual(plain, ['https://b.test/y.jpg']);
});
