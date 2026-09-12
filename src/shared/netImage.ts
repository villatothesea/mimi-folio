/**
 * 剪贴板里的网络图片地址：网页「复制图片」常带 HTML <img src="https://…">，
 * 或「复制图片地址」一条 URL（很多 CDN 没有 .png 后缀）。
 */

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)(\?|#|$)/i;
const IMG_FMT_Q = /(?:^|[?&#])(?:format|wx_fmt|fm|type|ext|imageType)=((?:png|jpe?g|gif|webp|svg|bmp|avif|ico))/i;
const IMG_HOST = /(^|\.)(qpic\.cn|qlogo\.cn|zhimg\.com|sinaimg\.cn|hdslb\.com|byteimg\.com|douyinpic\.com|googleusercontent\.com|twimg\.com|pinimg\.com|imgur\.com)$/i;
const IMG_TAG_SRC = /<img\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
const HREF_SRC = /<a\b[^>]*?\bhref\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
const MD_IMG = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/;

export function isHttpUrl(raw: string): boolean {
    try {
        const u = new URL(raw.trim());
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

function decodeHtmlUrl(raw: string): string {
    return raw.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function unwrapUrl(raw: string): string {
    let t = decodeHtmlUrl(raw.trim());
    if ((t.startsWith('<') && t.endsWith('>')) || (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        t = t.slice(1, -1).trim();
    }
    const md = MD_IMG.exec(t);
    if (md) return md[1];
    return t;
}

/** 纯文本像一条图片 URL。无 .png 后缀时看查询参数和常见图床域名。 */
export function isImageUrl(raw: string): boolean {
    const t = unwrapUrl(raw);
    if (!isHttpUrl(t) || /\s/.test(t)) return false;
    try {
        const u = new URL(t);
        if (IMG_EXT.test(u.pathname)) return true;
        if (IMG_FMT_Q.test(u.search) || IMG_FMT_Q.test(u.hash)) return true;
        if (IMG_HOST.test(u.hostname)) return true;
        if (/mmbiz_(jpg|jpeg|png|gif|webp)/i.test(u.pathname)) return true;
        return false;
    } catch {
        return false;
    }
}

function collect(html: string, re: RegExp, onlyImages: boolean): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
        const url = decodeHtmlUrl(m[1]);
        if (!isHttpUrl(url) || seen.has(url)) continue;
        if (onlyImages && !isImageUrl(url)) continue;
        seen.add(url);
        out.push(url);
        if (out.length >= 5) break;
    }
    return out;
}

export function imageUrlsFromHtml(html: string): string[] {
    const imgs = collect(html, IMG_TAG_SRC, false);
    if (imgs.length > 0) return imgs;
    return collect(html, HREF_SRC, true);
}

export function imageUrlsFromClipboard(dt: { getData(type: string): string }): string[] {
    const html = dt.getData('text/html');
    const fromHtml = html ? imageUrlsFromHtml(html) : [];
    if (fromHtml.length > 0) return fromHtml;
    const text = unwrapUrl(dt.getData('text/plain'));
    if (isImageUrl(text)) return [text];
    const listed = dt.getData('text/uri-list');
    if (listed) {
        for (const line of listed.split(/\r?\n/)) {
            if (!line || line.startsWith('#')) continue;
            const url = unwrapUrl(line);
            if (isImageUrl(url)) return [url];
        }
    }
    return [];
}
