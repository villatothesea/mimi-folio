/**
 * 两条线，不许混：
 * - 文件名 = 操作系统 basename（含 .md）。左栏、页顶大标题、搜索、底栏、目录第一行都用它。改名才是 fs rename / move。
 * - 正文标题 = ATX `#`–`######`，只是正文结构。不当文档标题，改文件名不改 H1。
 * YAML `title:` 若文件里已有就原样留着，界面不读、不写、不当第二套名字。
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

/** 重命名输入框：剥掉最后一个扩展名（.md / .html 都剥）。 */
export function fileNameStem(rel: string): string {
    return fileName(rel).replace(/\.[^.]+$/, '');
}

/**
 * 重命名目标路径：只改 stem，原扩展名保留。
 * 输入里若又写了原扩展名会剥掉，避免 `foo.md.md`。非法字符换成 `_`。
 * 空名或没改返回 null。
 */
export function renamedPath(from: string, typed: string): string | null {
    const posix = from.replaceAll('\\', '/');
    const name = fileName(posix);
    const ext = /\.[^.]+$/.exec(name)?.[0] ?? '';
    let stem = typed.trim().replace(/[\\/:*?"<>|]/g, '_');
    if (ext && stem.toLowerCase().endsWith(ext.toLowerCase())) {
        stem = stem.slice(0, -ext.length);
    }
    stem = stem.replace(/\.+$/g, '').trim();
    if (!stem) return null;
    const slash = posix.lastIndexOf('/');
    const dir = slash >= 0 ? posix.slice(0, slash + 1) : '';
    const dest = `${dir}${stem}${ext}`;
    return dest === posix ? null : dest;
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

/** 文档标题 = 文件名。不读 YAML title:、不读 H1。 */
export function displayTitle(rel: string, _markdown?: string): string {
    return fileName(rel);
}

/** 只写 YAML title:，不改正文标题、不改文件名。界面不用这条线。 */
export function setDisplayTitle(markdown: string, text: string): string {
    const title = text.trim();
    if (!title) return markdown;
    return setScalar(markdown, 'title', title);
}

/** 新建笔记：空正文。标题就是文件名，不写 title:。 */
export function newNoteMarkdown(_title?: string): string {
    return '';
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
