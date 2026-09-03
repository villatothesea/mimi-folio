/**
 * frontmatter 里 tags 的极简解析。只认 `tags:` 一个键，三种写法都收：
 *   tags: [a, b]   /   tags: a, b   /   tags:\n  - a\n  - b
 * 其它键原样跳过。这不是通用 YAML——分类只落在 md 里，不需要第二个库格式。
 */
export function parseTags(frontmatter: string): string[] {
    const lines = frontmatter.split('\n');
    const tags: string[] = [];
    let inTags = false;
    for (const line of lines) {
        const inline = line.match(/^tags\s*:\s*(.*)$/i);
        if (inline) {
            inTags = true;
            const body = inline[1].trim();
            for (const item of splitList(body)) tags.push(item);
            continue;
        }
        if (inTags) {
            if (/^\s+-\s*(.+)$/.test(line)) {
                tags.push(line.replace(/^\s+-\s*/, '').trim().replace(/^['"]|['"]$/g, ''));
            } else if (/^\S/.test(line)) {
                inTags = false;
            }
        }
    }
    return dedupe(tags.filter(Boolean));
}

function splitList(body: string): string[] {
    if (!body) return [];
    const inner = body.replace(/^\[/, '').replace(/\]$/, '');
    return inner
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
}

function dedupe(items: string[]): string[] {
    return [...new Set(items)];
}

/** 拆出文档开头的 frontmatter（--- 围栏），返回正文与 tags。没有 frontmatter 就原样返回。 */
export function splitFrontmatter(markdown: string): { frontmatter: string; body: string; tags: string[] } {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return { frontmatter: '', body: markdown, tags: [] };
    return { frontmatter: match[1], body: markdown.slice(match[0].length), tags: parseTags(match[1]) };
}

/** 把 tags 写回 frontmatter（其余键原样保留）；tags 为空则整段摘除。 */
export function setTags(markdown: string, tags: string[]): string {
    const { frontmatter, body } = splitFrontmatter(markdown);
    const tagsLine = tags.length ? `tags: [${tags.join(', ')}]` : '';
    // splitFrontmatter 的正则已吞掉闭合 --- 后的一个换行，body 直接续上即可
    if (!frontmatter) {
        return tagsLine ? `---\n${tagsLine}\n---\n${body}` : markdown;
    }
    const kept: string[] = [];
    let skippingList = false;
    for (const line of frontmatter.split('\n')) {
        if (/^tags\s*:/i.test(line)) {
            skippingList = true;
            continue;
        }
        if (skippingList && /^\s+-\s/.test(line)) continue; // tags 的短横线续行
        skippingList = false;
        kept.push(line);
    }
    if (tagsLine) kept.unshift(tagsLine);
    return `---\n${kept.join('\n')}\n---\n${body}`;
}
