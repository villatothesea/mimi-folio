/**
 * 侧栏（单元 5 起）：目录即分组——notes/、memos/ 及其子文件夹原样成组，
 * 不另做分组表、不做文件夹树（docs/计划.md 单元 5 纪律）。
 */
import type { FolioListItem } from '../host/types.ts';
import { icon } from './icons';

export type SidebarOptions = {
    activePath: string | null;
    onOpen: (path: string, button: HTMLButtonElement) => void;
    /** 点文件夹 = 清单过滤进该目录（bug3.7） */
    onDir?: (dir: string) => void;
    /** 拖拽移动文档（待评估 14） */
    onMove?: (from: string, toDir: string) => void;
    /** 星标组（单元 13）：置顶单独一组 */
    favorites?: FolioListItem[];
};

/** 文档类型图标：外链 > 速记 > 笔记。 */
function fileIcon(file: FolioListItem): string {
    if (file.linked) return icon('link');
    return icon(file.kind === 'memo' ? 'bolt' : 'file-text');
}

type DirNode = { dir: string; name: string; children: Map<string, DirNode>; files: FolioListItem[] };

function buildTree(files: FolioListItem[]): DirNode {
    const root: DirNode = { dir: '', name: '', children: new Map(), files: [] };
    for (const file of files) {
        const segs = file.path.split('/');
        let node = root;
        for (let i = 0; i < segs.length - 1; i++) {
            const name = segs[i];
            if (!node.children.has(name)) {
                node.children.set(name, { dir: node.dir ? `${node.dir}/${name}` : name, name, children: new Map(), files: [] });
            }
            node = node.children.get(name)!;
        }
        node.files.push(file);
    }
    return root;
}

/**
 * 清单 = 文件夹树（bug3.7）：文件夹是全局的一等行（图标+名称+缩进），
 * 点文件夹进目录；文件行可拖到文件夹行移动。memos/notes 不再是分割文字。
 */
export function renderSidebar(nav: HTMLElement, files: FolioListItem[], opts: SidebarOptions): void {
    nav.replaceChildren();

    if (opts.favorites?.length) {
        nav.append(renderGroup('★ 星标', opts.favorites, opts, 0));
    }
    renderTree(nav, buildTree(files), 0, opts);
}

function renderTree(host: HTMLElement, node: DirNode, depth: number, opts: SidebarOptions): void {
    for (const dir of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {
        host.append(renderFolderRow(dir, depth, opts));
        renderTree(host, dir, depth + 1, opts);
    }
    host.append(renderGroup('', node.files, opts, depth));
}

function renderFolderRow(dir: DirNode, depth: number, opts: SidebarOptions): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'folder-row';
    button.style.marginLeft = `${depth * 0.9}em`;
    const count = dir.files.length + [...dir.children.values()].reduce((sum, ch) => sum + ch.files.length, 0);
    button.innerHTML = `${icon('folders')}<span class="file-name">${dir.name}</span><span class="folder-count">${count}</span>`;
    button.title = dir.dir;
    button.dataset.dir = dir.dir;
    button.addEventListener('click', () => opts.onDir?.(dir.dir));
    // 拖文件到此文件夹 = 移动（待评估 14）
    button.addEventListener('dragover', (e) => {
        e.preventDefault();
        button.classList.add('drop-target');
    });
    button.addEventListener('dragleave', () => button.classList.remove('drop-target'));
    button.addEventListener('drop', (e) => {
        e.preventDefault();
        button.classList.remove('drop-target');
        const from = e.dataTransfer?.getData('text/folio-path');
        if (from) opts.onMove?.(from, dir.dir);
    });
    return button;
}

function renderGroup(label: string, files: FolioListItem[], opts: SidebarOptions, depth: number): DocumentFragment {
    const frag = document.createDocumentFragment();
    if (label) {
        const heading = document.createElement('div');
        heading.className = 'side-group';
        heading.textContent = label;
        frag.append(heading);
    }
    for (const file of files) {
        const button = document.createElement('button');
        button.type = 'button';
        button.style.marginLeft = `${depth * 0.9}em`;
        button.draggable = true;
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
        button.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData('text/folio-path', file.path);
            e.dataTransfer!.effectAllowed = 'move';
        });
        frag.append(button);
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
        button.innerHTML = `<span class="file-icon">${fileIcon(file)}</span><span class="file-name">${file.title}</span>`;
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
