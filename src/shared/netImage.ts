/**
 * 剪贴板里的网络图片地址：网页「复制图片」常带 HTML <img src="https://…">，
 * 或纯文本一条带扩展名的图片 URL。落盘走宿主 saveRemoteImage → vault/pics/。
 */

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)(\?|#|$)/i;
const IMG_TAG_SRC = /<img\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi;

export function isHttpUrl(raw: string): boolean {
    try {
        const u = new URL(raw.trim());
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

/** 纯文本像一条图片 URL（带扩展名）；无扩展的走 HTML <img>，避免把普通网页链当下图。 */
export function isImageUrl(raw: string): boolean {
    const t = raw.trim();
    if (!isHttpUrl(t) || /\s/.test(t)) return false;
    try {
        return IMG_EXT.test(new URL(t).pathname);
    } catch {
        return false;
    }
}

export function imageUrlsFromHtml(html: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    IMG_TAG_SRC.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMG_TAG_SRC.exec(html)) !== null) {
        const url = m[1];
        if (!isHttpUrl(url) || seen.has(url)) continue;
        seen.add(url);
        out.push(url);
        if (out.length >= 5) break;
    }
    return out;
}

export function imageUrlsFromClipboard(dt: { getData(type: string): string }): string[] {
    const html = dt.getData('text/html');
    const fromHtml = html ? imageUrlsFromHtml(html) : [];
    if (fromHtml.length > 0) return fromHtml;
    const text = dt.getData('text/plain').trim();
    if (isImageUrl(text)) return [text];
    const listed = dt.getData('text/uri-list');
    if (listed) {
        for (const line of listed.split(/\r?\n/)) {
            if (!line || line.startsWith('#')) continue;
            if (isImageUrl(line)) return [line.trim()];
        }
    }
    return [];
}
