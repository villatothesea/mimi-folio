/**
 * 剪贴板里的 markdown 源（GitHub Copy raw、.md 文件）应进正文，
 * 不要走 Muya 的 HTML 路径，也不要当附件落盘。
 */

const MD_NAME = /\.(md|markdown|mdx)$/i;
const MD_TYPE = /^(text\/markdown|text\/x-markdown)$/i;

export function isMarkdownFile(file: { name: string; type: string }): boolean {
    return MD_NAME.test(file.name) || MD_TYPE.test(file.type);
}

/** 像一篇 md 源，而不是网页/表格的 text/plain 回退。 */
export function looksLikeMarkdownSource(text: string): boolean {
    const t = text.replace(/^\uFEFF/, '');
    if (t.length < 8) return false;
    if (/^---[ \t]*\r?\n/m.test(t)) return true;
    if (/^#{1,6}[ \t]+\S/m.test(t)) return true;
    if (/^```[\w-]*[ \t]*\r?\n/m.test(t)) return true;
    return false;
}
