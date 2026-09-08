/**
 * 米米深链（docs/单篇路由-米米联动-实施计划.md）：入口 URL 的 ?doc=&anchor=。
 * 这里只放纯解析与匹配；落位编排（打开/滚动/进速记看法）在 main.ts。
 * doc 永远只在清单里匹配，不与盘上路径拼接——清单匹配即安全边界，天然防穿越。
 */

export type DeepLink = { doc: string | null; anchor: string | null };

/** 坏编码（如 %zz）经 URLSearchParams 解不出有效值，顶多匹配不上 → 默认流程。 */
export function parseDeepLink(search: string): DeepLink {
    const params = new URLSearchParams(search);
    const read = (key: string): string | null => {
        const value = params.get(key)?.trim();
        return value ? value : null;
    };
    return { doc: read('doc'), anchor: read('anchor') };
}

/** doc 参数 → 清单里的真实 path：先原样精确，再归一化 /↔\\（米米壳可能按 Windows 习惯拼反斜杠）。 */
export function matchDocPath(files: ReadonlyArray<{ path: string }>, doc: string): string | null {
    if (!doc) return null;
    const hit = files.find((f) => f.path === doc);
    if (hit) return hit.path;
    const target = doc.replaceAll('\\', '/');
    return files.find((f) => f.path.replaceAll('\\', '/') === target)?.path ?? null;
}

const normText = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * anchor 参数 → 标题下标：归一化空白后双向子串匹配，容忍模型转述与原文的轻微差异。
 * headings 与 muya getTOC() 同序（atx + setext），下标直接喂给 toc 的滚动。
 */
export function matchHeadingIndex(headings: ReadonlyArray<string | null | undefined>, anchor: string): number {
    const a = normText(anchor);
    if (!a) return -1;
    for (let i = 0; i < headings.length; i++) {
        const h = normText(headings[i] ?? '');
        if (!h) continue;
        if (h === a || h.includes(a) || a.includes(h)) return i;
    }
    return -1;
}
