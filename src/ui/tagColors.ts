/**
 * 标签颜色（单元 13 验收反馈）：色板在 tokens.css（--folio-tag-0..7），
 * 这里只做索引——默认按标签名散列，用户选过就存 localStorage（视图偏好，
 * 不进 md；内容分类仍只有目录 + frontmatter）。
 */
const KEY = 'folio-tag-colors';

export const TAG_COLOR_COUNT = 8;

function storedMap(): Record<string, unknown> {
    try {
        return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    } catch {
        return {};
    }
}

export function tagColorIndex(tag: string): number {
    const raw = storedMap()[tag];
    const stored = typeof raw === 'number' ? raw : Number.NaN;
    if (Number.isInteger(stored) && stored >= 0 && stored < TAG_COLOR_COUNT) return stored;
    let hash = 0;
    for (const ch of tag) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
    return hash % TAG_COLOR_COUNT;
}

export function setTagColor(tag: string, index: number | null): void {
    const map = storedMap();
    if (index === null) delete map[tag];
    else map[tag] = index;
    localStorage.setItem(KEY, JSON.stringify(map));
}

/** 应用到芯片上：元素吃 --tag-c；自定义 HEX 直落，默认走色板索引。 */
export function applyTagColor(el: HTMLElement, tag: string): void {
    const stored = storedMap()[tag];
    if (typeof stored === 'string' && String(stored).startsWith('#')) el.style.setProperty('--tag-c', String(stored));
    else el.style.setProperty('--tag-c', `var(--folio-tag-${tagColorIndex(tag)})`);
}
