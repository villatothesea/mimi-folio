/**
 * 链接播视频（单元 9）：粘贴 YouTube / B 站等白名单链接，页内出播放器。
 * 播放器内嵌在正文流里（挂在该段落块内，宽度随正文列宽），md 里只存链接本身；
 * 白名单外的链接一律不理，任意 iframe 进不了盘（DOMPurify 本就会剥 iframe）。
 */

export type VideoLink = {
    provider: 'youtube' | 'bilibili';
    id: string;
    /** 页面里的原始链接（md 存的就是它） */
    source: string;
    /** 页内播放器地址 */
    embed: string;
};

const YOUTUBE_RE = /https?:\/\/(?:www\.youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})[^\s]*/g;
const BILIBILI_RE = /https?:\/\/www\.bilibili\.com\/video\/(BV\w+)/g;

export function extractVideoLinks(markdown: string): VideoLink[] {
    const seen = new Map<string, VideoLink>();
    for (const match of markdown.matchAll(YOUTUBE_RE)) {
        const id = match[1];
        const source = match[0];
        const key = `youtube:${id}`;
        if (!seen.has(key)) {
            seen.set(key, { provider: 'youtube', id, source, embed: `https://www.youtube-nocookie.com/embed/${id}` });
        }
    }
    for (const match of markdown.matchAll(BILIBILI_RE)) {
        const id = match[1];
        const source = match[0];
        const key = `bilibili:${id}`;
        if (!seen.has(key)) {
            seen.set(key, {
                provider: 'bilibili',
                id,
                source,
                embed: `https://player.bilibili.com/player.html?bvid=${id}&autoplay=0&danmaku=0`,
            });
        }
    }
    return [...seen.values()];
}

/** 段落里如果有且只有一个白名单视频链接，返回它；否则 null。 */
function soleVideoLink(paragraph: Element): VideoLink | null {
    const text = (paragraph.textContent ?? '').trim();
    if (!text) return null;
    const links = extractVideoLinks(text);
    if (links.length !== 1) return null;
    // 尾斜杠归一化后再比对（B 站链接常带 / 结尾）
    const normalize = (s: string) => s.replace(/\/+$/, '');
    return normalize(text) === normalize(links[0].source) ? links[0] : null;
}

/**
 * 正文流装饰器：段落文本恰为一个白名单链接时，在段落块内挂播放器。
 * muya 的块级重渲染会重建子节点，靠 MutationObserver 幂等补挂。
 */
export function attachInlineEmbeds(wrap: HTMLElement): void {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function scan(): void {
        const seen = new Set<Element>();
        for (const paragraph of wrap.querySelectorAll<HTMLElement>('.mu-paragraph')) {
            const link = soleVideoLink(paragraph);
            if (!link) continue;
            seen.add(paragraph);
            let frame = paragraph.querySelector<HTMLIFrameElement>('iframe.folio-video');
            if (!frame) {
                frame = document.createElement('iframe');
                frame.className = 'folio-video';
                frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
                frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
                frame.setAttribute('allow', 'fullscreen; encrypted-media; picture-in-picture');
                frame.contentEditable = 'false';
                paragraph.append(frame);
            }
            const want = new URL(link.embed, location.href).href;
            if (frame.src !== want) frame.src = want;
        }
        // 段落不再是纯链接 → 摘掉播放器
        for (const frame of wrap.querySelectorAll('iframe.folio-video')) {
            const owner = frame.closest('.mu-paragraph');
            if (!owner || !seen.has(owner)) frame.remove();
        }
    }

    const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(scan, 250);
    });
    observer.observe(wrap, { childList: true, subtree: true, characterData: true });
}
