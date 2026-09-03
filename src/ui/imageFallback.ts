/**
 * 行内媒体兜底（浏览器宿主层）：
 * 1. 相对路径图片：muya 沿用桌面规则把 src 转成 file://（依赖 window.DIRNAME），
 *    纯浏览器必然失败——补同源 <img>；md 里的相对路径原样保留（权威是文件）。
 * 2. 音视频 raw-html：muya 重建元素时丢 controls 属性，Chromium UA 样式
 *    audio:not([controls]) 是 display:none!important，必须补回属性才能显示。
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

        for (const el of wrap.querySelectorAll<HTMLAudioElement | HTMLVideoElement>('audio.mu-raw-html, video.mu-raw-html')) {
            if (!el.hasAttribute('controls')) el.setAttribute('controls', '');
        }
    }

    const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(apply, 120);
    });
    observer.observe(wrap, { childList: true, subtree: true });
}
