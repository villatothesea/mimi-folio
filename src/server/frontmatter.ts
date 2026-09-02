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
