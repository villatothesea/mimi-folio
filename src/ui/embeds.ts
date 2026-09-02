/**
 * 链接播视频（单元 9）：粘贴 YouTube / B 站等白名单链接，页内出播放器。
 * md 里只存链接本身；白名单外的链接一律不理，任意 iframe 进不了盘
 * （DOMPurify 本就会剥 iframe，这里也不再新增）。
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

/** 渲染器：链接集合没变就不动 DOM（避免打字时播放器反复重载）。 */
export function renderEmbeds(
    el: HTMLElement,
    links: VideoLink[],
    createIframe: (link: VideoLink) => HTMLIFrameElement,
): void {
    const key = links.map((l) => `${l.provider}:${l.id}`).join('|');
    if (el.dataset.embedKey === key) return;
    el.dataset.embedKey = key;
    el.replaceChildren();

    const heading = document.createElement('div');
    heading.className = 'bl-heading';
    heading.textContent = links.length ? `链接视频 · ${links.length}` : '链接视频';
    el.append(heading);

    for (const link of links) {
        const frame = createIframe(link);
        frame.className = 'embed-frame';
        frame.title = `${link.provider} ${link.id}`;
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
        el.append(frame);
    }
}
