/**
 * 侧栏（单元 5 起）：目录即分组——notes/、memos/ 及其子文件夹原样成组，
 * 不另做分组表、不做文件夹树（docs/计划.md 单元 5 纪律）。
 */
import type { FolioListItem } from '../host/types.ts';
import { icon } from './icons';

/** 文档类型图标：外链 > 速记 > 笔记。 */
function fileIcon(file: FolioListItem): string {
    if (file.linked) return icon('link');
    return icon(file.kind === 'memo' ? 'bolt' : 'file-text');
}

export type SidebarOptions = {
    activePath: string | null;
    onOpen: (path: string, button: HTMLButtonElement) => void;
    /** 星标组（单元 13）：置顶单独一组 */
    favorites?: FolioListItem[];
};

export function renderSidebar(nav: HTMLElement, files: FolioListItem[], opts: SidebarOptions): void {
    nav.replaceChildren();

    const groups = new Map<string, FolioListItem[]>();
    for (const file of files) {
        const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
        const list = groups.get(dir) ?? [];
        list.push(file);
        groups.set(dir, list);
    }
    // 星标组插在最前（组名固定 ★）
    if (opts.favorites?.length) {
        groups.delete('');
        const rest = [...groups.entries()];
        nav.append(renderGroup('★ 星标', opts.favorites, opts));
        for (const [dir, list] of rest) nav.append(renderGroup(dir || 'vault', list, opts));
        return;
    }
    for (const dir of [...groups.keys()].sort((a, b) => a.localeCompare(b, 'zh'))) {
        nav.append(renderGroup(dir || 'vault', groups.get(dir)!, opts));
    }
}

function renderGroup(label: string, files: FolioListItem[], opts: SidebarOptions): DocumentFragment {
    const frag = document.createDocumentFragment();
    const heading = document.createElement('div');
    heading.className = 'side-group';
    heading.textContent = label;
    frag.append(heading);

    for (const file of files) {
        const button = document.createElement('button');
        button.type = 'button';
        const ic = document.createElement('span');
        ic.className = 'file-icon';
        ic.innerHTML = fileIcon(file);
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = file.title;
        button.append(ic, name);
        if (file.linked) {
            const badge = document.createElement('span');
            badge.className = 'linked-badge';
            badge.textContent = '⌗';
            badge.title = '库外链入文档，读写回原文件';
            button.append(badge);
        }
        button.title = file.path;
        button.dataset.path = file.path;
        if (file.path === opts.activePath) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => opts.onOpen(file.path, button));
        frag.append(button);
        // 搜索命中给一行上下文副标题（单元 13）
        if (file.snippet) {
            const snippet = document.createElement('div');
            snippet.className = 'file-snippet';
            snippet.textContent = file.snippet;
            frag.append(snippet);
        }
    }
    return frag;
}

export function markCurrent(nav: HTMLElement, path: string | null): void {
    nav.querySelectorAll('button').forEach((button) => {
        if (button.dataset.path === path) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
    });
}

/**
 * 速记时间线（单元 8）：memos/ 按文件名倒序（约定文件名带日期前缀），
 * 标题旁挂标签。是同一座 vault 的一种看法，不是嵌 memos。
 */
export function renderMemoTimeline(
    nav: HTMLElement,
    files: FolioListItem[],
    opts: SidebarOptions,
): void {
    nav.replaceChildren();
    const sorted = [...files].sort((a, b) => b.path.localeCompare(a.path, 'zh'));
    for (const file of sorted) {
        const row = document.createElement('div');
        row.className = 'memo-row';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'memo-open';
        button.textContent = file.title;
        button.title = file.path;
        button.dataset.path = file.path;
        if (file.path === opts.activePath) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => opts.onOpen(file.path, button));
        row.append(button);

        const tags = document.createElement('span');
        tags.className = 'memo-tags';
        tags.textContent = file.tags?.length ? file.tags.join(' · ') : '';
        row.append(tags);

        nav.append(row);
    }
    if (sorted.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'side-group';
        empty.textContent = 'memos/ 还没有速记';
        nav.append(empty);
    }
}
/**
 * 标签条（单元 6）：frontmatter tags 的并集，点一个筛一层；一条可多标签。
 * 数据来自 host.list() 的 tags 字段，不搞 [[标签页]]（AGENTS.md 不做清单）。
 */
export function renderTagBar(
    bar: HTMLElement,
    files: FolioListItem[],
    activeTag: string | null,
    onToggle: (tag: string) => void,
    applyColor?: (el: HTMLElement, tag: string) => void,
): void {
    const tags = new Set<string>();
    for (const file of files) for (const tag of file.tags ?? []) tags.add(tag);

    bar.replaceChildren();
    if (tags.size === 0) return;

    for (const tag of [...tags].sort((a, b) => a.localeCompare(b, 'zh'))) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag-chip';
        chip.textContent = tag;
        chip.dataset.tag = tag;
        if (tag === activeTag) chip.setAttribute('aria-pressed', 'true');
        applyColor?.(chip, tag);
        chip.addEventListener('click', () => onToggle(tag));
        bar.append(chip);
    }
}
