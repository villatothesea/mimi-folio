/**
 * wikilink（Foam 规则）：`[[目标]]` 按页名/相对路径解析到 vault 内一篇。
 * 解析顺序（取第一个命中，保证确定性）：
 *   1. 与路径精确相等（可带 .md）
 *   2. 文件名（不含扩展名）精确相等（大小写不敏感，Foam 语义）
 *   3. 路径包含该词（唯一命中才认，多个命中弃用）
 */

export const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/** 一篇 md 里出现的全部 wikilink 目标（去重，保留原文）。 */
export function outgoingLinks(markdown: string): string[] {
    const targets = new Set<string>();
    for (const match of markdown.matchAll(WIKILINK_RE)) {
        targets.add(match[1].trim());
    }
    return [...targets];
}

export type WikilinkIndex = {
    /** path -> 这篇链向的目标原文 */
    outgoing: Map<string, string[]>;
    /** path -> 全部已知页路径 */
    pages: Set<string>;
};

export function buildIndex(docs: Map<string, string>): WikilinkIndex {
    const index: WikilinkIndex = { outgoing: new Map(), pages: new Set() };
    for (const [path, markdown] of docs) {
        index.pages.add(path);
        index.outgoing.set(path, outgoingLinks(markdown));
    }
    return index;
}

function normalize(name: string): string {
    const withMd = name.endsWith('.md') ? name : `${name}.md`;
    return withMd.replaceAll('\\', '/').replace(/^\.?\//, '');
}

/** 解析一个 wikilink 目标到具体页；解析不了返回 null（点击时可新建）。 */
export function resolveLink(index: WikilinkIndex, target: string): string | null {
    const want = normalize(target);
    if (index.pages.has(want)) return want;

    const lower = want.toLowerCase();
    for (const page of index.pages) {
        if (page.toLowerCase() === lower) return page;
    }
    const base = want.replace(/\.md$/i, '').toLowerCase();
    const byBase = [...index.pages].filter((page) => page.replace(/\.md$/i, '').toLowerCase() === base);
    if (byBase.length === 1) return byBase[0];

    const byContain = [...index.pages].filter((page) => page.toLowerCase().includes(base));
    if (byContain.length === 1) return byContain[0];
    return null;
}

/** 出链与反链：出链解析到具体页；反链是所有链向该页的文件。 */
export function linksFor(index: WikilinkIndex, path: string): { outgoing: string[]; backlinks: string[] } {
    const outgoing = (index.outgoing.get(path) ?? [])
        .map((target) => resolveLink(index, target))
        .filter((p): p is string => p !== null && p !== path);
    const dedupedOutgoing = [...new Set(outgoing)];

    const backlinks: string[] = [];
    for (const [from, targets] of index.outgoing) {
        if (from === path) continue;
        for (const target of targets) {
            if (resolveLink(index, target) === path) {
                backlinks.push(from);
                break;
            }
        }
    }
    return { outgoing: dedupedOutgoing.sort(), backlinks: backlinks.sort() };
}
