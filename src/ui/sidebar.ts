/**
 * 侧栏（单元 5 起）：目录即分组——notes/、memos/ 及其子文件夹原样成组，
 * 不另做分组表、不做文件夹树（docs/计划.md 单元 5 纪律）。
 */
import type { FolioListItem } from '../host/types.ts';

export type SidebarOptions = {
    activePath: string | null;
    onOpen: (path: string, button: HTMLButtonElement) => void;
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
    const dirs = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'zh'));

    for (const dir of dirs) {
        const heading = document.createElement('div');
        heading.className = 'side-group';
        heading.textContent = dir || 'vault';
        nav.append(heading);

        for (const file of groups.get(dir)!) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = file.title;
            button.title = file.path;
            button.dataset.path = file.path;
            if (file.path === opts.activePath) button.setAttribute('aria-current', 'true');
            button.addEventListener('click', () => opts.onOpen(file.path, button));
            nav.append(button);
        }
    }
}

export function markCurrent(nav: HTMLElement, path: string | null): void {
    nav.querySelectorAll('button').forEach((button) => {
        if (button.dataset.path === path) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
    });
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
        chip.addEventListener('click', () => onToggle(tag));
        bar.append(chip);
    }
}
