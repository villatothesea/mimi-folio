/**
 * 两条线，不许混：
 * - 文件名 = 操作系统里那份文件的 basename（含 .md）。只来自路径，不是 H1，不是 YAML title。
 * - 显示标题 = 正文第一个标题。标题栏、清单、搜索用这个；没有标题才在清单里露出文件名。
 * 改标题只改 H1；改文件名才是 fs rename / move。frontmatter title: 两边都不参与。
 */
import { splitFrontmatter } from './frontmatter.ts';

const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;

function linesOf(text: string): string[] {
    return text.split(/\r?\n/);
}

/** 操作系统文件名，含扩展名。`links/docs/计划.md` → `计划.md` */
export function fileName(rel: string): string {
    return rel.replaceAll('\\', '/').split('/').pop() ?? rel;
}

/** 去扩展名的文件名，只给 wikilink 解析用（Foam：按文件名命中）。 */
export function fileStem(rel: string): string {
    return fileName(rel).replace(/\.md$/i, '');
}

export function firstHeading(markdown: string): string | null {
    const { body } = splitFrontmatter(markdown);
    for (const line of linesOf(body)) {
        const m = line.match(HEADING_RE);
        if (m && m[2].trim()) return m[2].trim();
    }
    return null;
}

/** 清单/搜索：有 H1 用 H1；没有则露出真文件名（含 .md），避免看起来像标题。 */
export function displayTitle(rel: string, markdown: string): string {
    return firstHeading(markdown) ?? fileName(rel);
}

/** 改第一个标题的文字，保留原级别；没有标题则在正文开头插 H1。不碰文件名、不写 title:。 */
export function setFirstHeading(markdown: string, text: string): string {
    const title = text.trim();
    if (!title) return markdown;
    const { frontmatter, body } = splitFrontmatter(markdown);
    const lines = linesOf(body);
    const i = lines.findIndex((line) => HEADING_RE.test(line));
    if (i >= 0) {
        const hashes = lines[i].match(HEADING_RE)![1];
        lines[i] = `${hashes} ${title}`;
    } else {
        const prefix = lines.length === 1 && lines[0] === '' ? [] : [''];
        lines.unshift(`# ${title}`, ...prefix);
    }
    const nextBody = lines.join('\n');
    return frontmatter ? `---\n${frontmatter}\n---\n${nextBody}` : nextBody;
}
