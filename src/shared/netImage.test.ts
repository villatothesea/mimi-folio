import assert from 'node:assert/strict';
import test from 'node:test';

import { imageUrlsFromClipboard, imageUrlsFromHtml, isHttpUrl, isImageUrl } from './netImage.ts';

test('isHttpUrl 只放行 http(s)', () => {
    assert.equal(isHttpUrl('https://cdn.example/a.png'), true);
    assert.equal(isHttpUrl('http://127.0.0.1/x.jpg'), true);
    assert.equal(isHttpUrl('file:///tmp/a.png'), false);
    assert.equal(isHttpUrl('javascript:alert(1)'), false);
});

test('isImageUrl 认扩展名、查询参数和常见图床', () => {
    assert.equal(isImageUrl('https://cdn.example/a.png'), true);
    assert.equal(isImageUrl('https://cdn.example/a.PNG?w=8'), true);
    assert.equal(isImageUrl('https://mmbiz.qpic.cn/mmbiz_jpg/xxx/640?wx_fmt=jpeg'), true);
    assert.equal(isImageUrl('https://pbs.twimg.com/media/abc?format=jpg&name=large'), true);
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
    const addr = imageUrlsFromClipboard({
        getData: (t) => (t === 'text/html' ? '<a href="https://mmbiz.qpic.cn/sz_mmbiz_png/x/640?wx_fmt=png">x</a>' : ''),
    });
    assert.equal(addr[0]?.includes('qpic.cn'), true);
});
