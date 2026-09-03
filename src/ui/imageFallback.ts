/**
 * 相对路径图片的浏览器兜底：muya 沿用桌面规则，把带扩展名的相对图片 src
 * 转成 file://（依赖 window.DIRNAME），在纯浏览器里必然失败。
 * 这里给失败态补同源 <img>；md 里的相对路径原样保留（权威是文件）。
 * 成功加载（http/data src）的图片 muya 自己会渲染，不动。
 */
export function attachImageFallback(wrap: HTMLElement): void {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function apply(): void {
        for (const span of wrap.querySelectorAll<HTMLSpanElement>('span.mu-inline-image[data-raw]')) {
            if (span.dataset.folioFixed === '1') continue;
            // muya 自己渲染成功时会有非兜底的 <img>，不动它
            if ([...span.querySelectorAll('img')].some((i) => !i.classList.contains('folio-inline-img'))) {
                continue;
            }
            const match = (span.dataset.raw ?? '').match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
            if (!match) continue;
            const src = match[2].trim();
            if (/^(https?:|data:|file:)/i.test(src)) continue;
            const img = document.createElement('img');
            img.className = 'folio-inline-img';
            img.alt = match[1];
            img.addEventListener('load', () => span.classList.add('folio-img-fixed'));
            img.addEventListener('error', () => {
                img.remove();
                delete span.dataset.folioFixed; // 真不存在则回到 muya 的失败态
            });
            img.src = new URL(src, location.href).href;
            span.append(img);
            span.dataset.folioFixed = '1';
        }
    }

    const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(apply, 120);
    });
    observer.observe(wrap, { childList: true, subtree: true });
}
