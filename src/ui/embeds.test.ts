import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractVideoLinks } from './embeds.ts';

test('识别 YouTube 标准链接', () => {
    const links = extractVideoLinks('看这个 https://www.youtube.com/watch?v=dQw4w9WgXcQ 啊');
    assert.equal(links.length, 1);
    assert.equal(links[0].provider, 'youtube');
    assert.equal(links[0].id, 'dQw4w9WgXcQ');
    assert.equal(links[0].embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
});

test('识别 youtu.be 短链与 shorts', () => {
    const links = extractVideoLinks('https://youtu.be/dQw4w9WgXcQ\nhttps://www.youtube.com/shorts/abc123XYZ_-');
    assert.deepEqual(links.map((l) => l.id).sort(), ['abc123XYZ_-', 'dQw4w9WgXcQ']);
});

test('识别 B 站 BV 号', () => {
    const links = extractVideoLinks('https://www.bilibili.com/video/BV1GJ411x7h7/?p=1');
    assert.equal(links.length, 1);
    assert.equal(links[0].provider, 'bilibili');
    assert.match(links[0].embed, /bvid=BV1GJ411x7h7/);
    assert.match(links[0].embed, /autoplay=0/);
});

test('白名单外的链接一律不理', () => {
    const links = extractVideoLinks(
        [
            'https://vimeo.com/123456',
            'https://evil.example.com/watch?v=dQw4w9WgXcQ',
            'https://www.youtube.com/embed?x=1',
            'http://localhost:5173/folio/v1/list',
        ].join('\n'),
    );
    assert.deepEqual(links, []);
});

test('同一链接去重，md 里只存链接', () => {
    const links = extractVideoLinks('https://youtu.be/dQw4w9WgXcQ\n再次 https://youtu.be/dQw4w9WgXcQ');
    assert.equal(links.length, 1);
    // extract 只读原文，不改写链接
    assert.ok(links[0].source.startsWith('https://youtu.be/'));
});
