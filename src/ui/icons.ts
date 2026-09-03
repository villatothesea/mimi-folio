/**
 * 内联图标（单元 13 验收批）：currentColor 描边、无写死色，尺寸随字号（1em）。
 * viewBox 24 / stroke 1.5，对齐 AGENTS.md 视觉纪律。
 */
export type IconName =
    | 'all'
    | 'note'
    | 'memo'
    | 'link'
    | 'folder'
    | 'search'
    | 'close'
    | 'plus-note'
    | 'plus-memo'
    | 'plus-folder'
    | 'logo';

const PATHS: Record<IconName, string> = {
    // 全部：三层叠
    all: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    // 笔记：文档
    note: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>',
    // 速记：闪电
    memo: '<path d="M13 3L5 14h5l-1 7 8-11h-5l1-7z"/>',
    // 外链：链环
    link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 10-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 105.7 5.7l1.2-1.2"/>',
    folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    'plus-note': '<path d="M7 3h7l4 4v12H7z"/><path d="M14 3v4h4"/><path d="M12 11v6M9 14h6"/>',
    'plus-memo': '<path d="M13 2L5 13h5l-1 8 8-11h-5l1-8z"/>',
    'plus-folder': '<path d="M3 6h6l2 2h10v11H3z"/><path d="M15 11v6M12 14h6"/>',
    logo: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8h8M12 8v8M8.5 16h7"/>',
};

export function icon(name: IconName): string {
    return `<svg class="folio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}
