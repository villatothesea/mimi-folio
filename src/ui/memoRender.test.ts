import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderMemoLite } from './memoRender.ts';

test('转义 HTML，不把文件名渲出来', () => {
    const html = renderMemoLite('---\ntags: [a]\n---\n\n<script>x</script> 与 `code`\n');
    assert.equal(html.includes('<script>'), false);
    assert.equal(html.includes('&lt;script&gt;'), true);
    assert.equal(html.includes('.md'), false);
    assert.equal(html.includes('<code>code</code>'), true);
});

test('清单、#tag、wikilink', () => {
    const html = renderMemoLite('- [ ] 做完 [[tagged|笔记]] #灵感\n');
    assert.match(html, /type="checkbox"/);
    assert.match(html, /data-wiki="tagged"/);
    assert.match(html, />笔记</);
    assert.match(html, /data-tag="灵感"/);
});

test('本机附件图才渲 img', () => {
    const html = renderMemoLite('![](attachments/a.png) 和 ![x](https://evil/x.png)\n');
    assert.match(html, /src="\/attachments\/a.png"/);
    assert.equal(/<img[^>]*evil/.test(html), false);
    assert.match(html, /https:\/\/evil\/x.png/);
});
