/**
 * 三条线，不许混：
 * - 文件名 = 操作系统 basename（含 .md）。wikilink 身份。改名才是 fs rename / move。
 * - 文档标题 = YAML `title:`（Jekyll / Hugo / Pandoc / Eleventy 同一套）。清单、标题栏、底栏、目录第一行用这个。
 * - 正文标题 = ATX `#`–`######`，只是正文结构。不当文档标题，改标题不改 H1。
 */
import { getScalar, setScalar, splitFrontmatter } from './frontmatter.ts';

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

/** frontmatter `title:`。没有或空白视为未设。 */
export function yamlTitle(markdown: string): string | null {
    const value = getScalar(markdown, 'title')?.trim();
    return value || null;
}

export function firstHeading(markdown: string): string | null {
    const { body } = splitFrontmatter(markdown);
    for (const line of linesOf(body)) {
        const m = line.match(HEADING_RE);
        if (m && m[2].trim()) return m[2].trim();
    }
    return null;
}

/** 清单/搜索/底栏/目录第一行：有 YAML title 用它；否则露出真文件名。不读 H1。 */
export function displayTitle(rel: string, markdown: string): string {
    return yamlTitle(markdown) ?? fileName(rel);
}

/** 只写 YAML title:，不改正文标题、不改文件名。 */
export function setDisplayTitle(markdown: string, text: string): string {
    const title = text.trim();
    if (!title) return markdown;
    return setScalar(markdown, 'title', title);
}

/** 新建笔记的种子：只有 title:，正文空着。 */
export function newNoteMarkdown(title = '未命名笔记'): string {
    return setDisplayTitle('', title);
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
