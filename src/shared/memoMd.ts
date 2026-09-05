/**
 * 速记短记：文件名日期、正文 #标签、清单勾选。
 * 标签真源仍是 frontmatter tags:；#标签只在保存时并入，不另起库。
 */
import { WIKILINK_RE, outgoingLinks } from './wikilink.ts';
import { setTags, splitFrontmatter } from './frontmatter.ts';

const DAY_RE = /^(\d{4}-\d{2}-\d{2})/;
const TASK_RE = /^(\s*[-*+]\s+)\[([ xX])\](\s?)(.*)$/;
const HASH_RE = /(^|[\s([{（【])#([^\s#]+)/g;

export function memoDayFromPath(path: string): string | null {
    const base = path.split('/').pop() ?? '';
    return DAY_RE.exec(base)?.[1] ?? null;
}

/** `YYYY-MM-DD-HH-MM-SS`。选了日历日就用那天 + 当前时分秒。 */
export function memoStamp(day?: string | null, now = new Date()): string {
    const datePart = day && /^\d{4}-\d{2}-\d{2}$/.test(day)
        ? day
        : now.toLocaleDateString('sv');
    const timePart = now
        .toLocaleTimeString('sv', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .replaceAll(':', '-');
    return `${datePart}-${timePart}`;
}

export function newMemoPath(day?: string | null, now = new Date()): string {
    return `memos/${memoStamp(day, now)}.md`;
}

function stripFence(body: string): string {
    return body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
}

function cleanTag(raw: string): string {
    return raw.replace(/[.,;:!?。，；：！？)\]】）]+$/u, '');
}

/** 正文里的 `#标签`（不是 ATX `# 标题`）。跳过代码块。 */
export function extractHashTags(markdown: string): string[] {
    const { body } = splitFrontmatter(markdown);
    const tags: string[] = [];
    HASH_RE.lastIndex = 0;
    for (const match of stripFence(body).matchAll(HASH_RE)) {
        const tag = cleanTag(match[2] ?? '');
        if (tag) tags.push(tag);
    }
    return [...new Set(tags)];
}

export function replaceBody(markdown: string, body: string): string {
    const { frontmatter } = splitFrontmatter(markdown);
    const trimmed = body.replace(/^\r?\n+/, '');
    if (!frontmatter) return trimmed;
    if (!trimmed) return `---\n${frontmatter}\n---\n`;
    return `---\n${frontmatter}\n---\n\n${trimmed}`;
}

/** 新建：正文里的 #标签写入 tags:。没有标签就不造空 frontmatter。 */
export function newMemoMarkdown(body: string): string {
    const text = body.replace(/\s+$/, '') + '\n';
    const tags = extractHashTags(text);
    return tags.length ? setTags(text, tags) : text;
}

/** 就地保存：保留原 tags:，并入正文新出现的 #标签。 */
export function saveMemoMarkdown(original: string, body: string): string {
    const replaced = replaceBody(original, body);
    const { tags } = splitFrontmatter(replaced);
    const merged = [...new Set([...tags, ...extractHashTags(replaced)])];
    return merged.length ? setTags(replaced, merged) : replaced;
}

export function toggleTaskAtLine(markdown: string, lineIndex: number): string {
    const { frontmatter, body } = splitFrontmatter(markdown);
    const lines = body.split('\n');
    const line = lines[lineIndex];
    if (line === undefined) return markdown;
    const match = TASK_RE.exec(line);
    if (!match) return markdown;
    const checked = match[2] !== ' ';
    lines[lineIndex] = `${match[1]}[${checked ? ' ' : 'x'}]${match[3]}${match[4]}`;
    const next = lines.join('\n');
    if (!frontmatter) return next;
    if (!next.replace(/^\r?\n+/, '')) return `---\n${frontmatter}\n---\n`;
    return `---\n${frontmatter}\n---\n${next.startsWith('\n') ? next : `\n${next}`}`;
}

export function hasWikilink(markdown: string): boolean {
    WIKILINK_RE.lastIndex = 0;
    return outgoingLinks(markdown).length > 0;
}

export function hasTask(markdown: string): boolean {
    return /^\s*[-*+]\s+\[[ xX]\]/m.test(splitFrontmatter(markdown).body);
}

export function hasCode(markdown: string): boolean {
    const { body } = splitFrontmatter(markdown);
    return /```/.test(body) || /`[^`]+`/.test(body);
}

export function bodySnippet(markdown: string, max = 80): string {
    const { body } = splitFrontmatter(markdown);
    for (const line of body.split('\n')) {
        const text = line.replace(/[#>*\-\[\]`]/g, '').trim();
        if (!text) continue;
        return text.length > max ? `${text.slice(0, max)}…` : text;
    }
    return '';
}

export function relativeTime(ms: number, now = Date.now()): string {
    const diff = Math.max(0, now - ms);
    if (diff < 45_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
    const days = Math.round(diff / 86_400_000);
    if (days === 1) return '昨天';
    if (days < 7) return `${days} 天前`;
    return new Date(ms).toLocaleDateString('sv');
}
