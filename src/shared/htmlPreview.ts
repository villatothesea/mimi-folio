/**
 * 网页预览看法：.html 不当 markdown 进 Muya。
 * iframe src 用路径形式，好让页面里的相对 css/图解析到同目录。
 */

export const HTML_PREVIEW_SCRIPTS_KEY = 'folio-html-scripts';

export function isHtmlPath(path: string): boolean {
    return /\.html?$/i.test(path);
}

/** `/folio/v1/preview/links/页.html`，每段单独编码。 */
export function previewSrc(rel: string, base = ''): string {
    const segs = rel.replaceAll('\\', '/').split('/').filter(Boolean).map(encodeURIComponent);
    return `${base}/folio/v1/preview/${segs.join('/')}`;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** 未存过或非 `'0'` → 开。只认显式关掉。 */
export function htmlPreviewScriptsEnabled(store?: Store | null): boolean {
    try {
        const s = store ?? (typeof localStorage === 'undefined' ? null : localStorage);
        if (!s) return true;
        return s.getItem(HTML_PREVIEW_SCRIPTS_KEY) !== '0';
    } catch {
        return true;
    }
}

export function setHtmlPreviewScriptsEnabled(on: boolean, store?: Store | null): void {
    const s = store ?? localStorage;
    s.setItem(HTML_PREVIEW_SCRIPTS_KEY, on ? '1' : '0');
}

/**
 * 始终带 sandbox（空值仍隔离：无脚本、无同源、无表单）。
 * 开脚本也不给 allow-same-origin，页面摸不到米素 DOM / 接口。
 */
export function htmlPreviewSandbox(allowScripts: boolean): string {
    return allowScripts ? 'allow-scripts' : '';
}
