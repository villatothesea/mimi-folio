/**
 * 侧栏（单元 5 起）：目录即分组——notes/、memos/ 及其子文件夹原样成组，
 * 不另做分组表、不做文件夹树（docs/计划.md 单元 5 纪律）。
 */
import type { FolioListItem } from '../host/types.ts';
import { fileName } from '../shared/docTitle.ts';
import { icon } from './icons';
import { applyTagColor } from './tagColors';

export type SidebarOptions = {
    activePath: string | null;
    onOpen: (path: string, button: HTMLButtonElement) => void;
    /** 点文件夹标题 = 选中该目录（bug4 2.2：只选中不过滤） */
    selectedDir?: string | null;
    onDirSelect?: (dir: string | null) => void;
    /** 拖拽移动文档（待评估 14） */
    onMove?: (from: string, toDir: string) => void;
    /** 文件夹右键菜单（bug5） */
    onFolderContext?: (dir: string, x: number, y: number) => void;
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

/** 折叠状态（模块级，会话内保持） */
const collapsedDirs = new Set<string>();

function parentDir(dir: string): string {
    const i = dir.lastIndexOf('/');
    return i < 0 ? '' : dir.slice(0, i);
}

function siblingDirs(files: FolioListItem[], dir: string): string[] {
    const parent = parentDir(dir);
    const node = (() => {
        let cur = buildTree(files);
        if (!parent) return cur;
        for (const seg of parent.split('/')) {
            const next = cur.children.get(seg);
            if (!next) return null;
            cur = next;
        }
        return cur;
    })();
    if (!node) return [dir];
    return [...node.children.values()].map((ch) => ch.dir);
}

/** 展开/折叠与 `dir` 同级的全部文件夹（不含孙级）。 */
export function setSiblingFoldersCollapsed(files: FolioListItem[], dir: string, collapse: boolean): void {
    for (const sib of siblingDirs(files, dir)) {
        if (collapse) collapsedDirs.add(sib);
        else collapsedDirs.delete(sib);
    }
}

/** 同级是否已经全开/全折，用来灰掉菜单项。 */
export function siblingFolderFoldState(files: FolioListItem[], dir: string): { allExpanded: boolean; allCollapsed: boolean } {
    const sibs = siblingDirs(files, dir);
    if (sibs.length === 0) return { allExpanded: true, allCollapsed: true };
    let collapsed = 0;
    for (const sib of sibs) if (collapsedDirs.has(sib)) collapsed += 1;
    return { allExpanded: collapsed === 0, allCollapsed: collapsed === sibs.length };
}

/**
 * 清单 = 文件夹树（bug4 2.1-2.6）：箭头/文件夹图标折叠，点名称只选中；
 * 子级有 1px 层级引导线；计数右对齐；星标行内显示，不设星标组；无横向滚动。
 */
export function renderSidebar(nav: HTMLElement, files: FolioListItem[], opts: SidebarOptions): void {
    nav.replaceChildren();
    renderTree(nav, buildTree(files), 0, opts);
    alignGuideLines(nav);
}

/** 只改这一枝 DOM，不走列目录接口。 */
function toggleFolder(row: HTMLElement, dir: DirNode, depth: number, opts: SidebarOptions): void {
    const collapse = !collapsedDirs.has(dir.dir);
    if (collapse) {
        collapsedDirs.add(dir.dir);
        const next = row.nextElementSibling;
        if (next?.classList.contains('tree-children')) next.remove();
    } else {
        collapsedDirs.delete(dir.dir);
        const children = document.createElement('div');
        children.className = 'tree-children';
        renderTree(children, dir, depth + 1, opts);
        row.after(children);
    }
    const collapsed = collapsedDirs.has(dir.dir);
    const toggle = row.querySelector<HTMLElement>('.folder-toggle');
    if (toggle) {
        toggle.innerHTML = icon(collapsed ? 'chevron-right' : 'chevron-down');
        toggle.title = collapsed ? '展开' : '折叠';
        toggle.setAttribute('aria-expanded', String(!collapsed));
    }
    const folderIcon = row.querySelector<HTMLElement>('.file-icon');
    if (folderIcon) folderIcon.title = collapsed ? '展开' : '折叠';
    const nav = row.closest('nav');
    if (nav instanceof HTMLElement) alignGuideLines(nav);
}

/** 渲染后对位（清单1 补充 2/3）：竖线钉到折叠三角中心；文件图标对齐同级文件夹图标。 */
function alignGuideLines(nav: HTMLElement): void {
    requestAnimationFrame(() => {
        for (const row of nav.querySelectorAll<HTMLElement>('.folder-row')) {
            // 竖线对位基准 = 折叠三角中心（不是文件夹图标）
            const svg = row.querySelector('.folder-toggle svg');
            const children = row.nextElementSibling as HTMLElement | null;
            if (!svg || !children?.classList.contains('tree-children')) continue;
            const svgRect = svg.getBoundingClientRect();
            const center = svgRect.left + svgRect.width / 2;
            children.style.setProperty('--line-o', `${Math.round(center - children.getBoundingClientRect().left)}px`);
        }
    });
}

function renderTree(host: HTMLElement, node: DirNode, depth: number, opts: SidebarOptions): void {
    for (const dir of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {
        host.append(renderFolderRow(dir, depth, opts));
        if (!collapsedDirs.has(dir.dir)) {
            const children = document.createElement('div');
            children.className = 'tree-children';
            renderTree(children, dir, depth + 1, opts);
            host.append(children);
        }
    }
    host.append(renderGroup(node.files, opts, depth));
}

/** 缩进只垫内容，行本身满宽，高亮才能贴侧栏左右。 */
function indentRow(row: HTMLElement, depth: number): void {
    row.style.paddingLeft = `calc(var(--folio-space-1) + var(--tree-step) * ${depth})`;
}

function renderFolderRow(dir: DirNode, depth: number, opts: SidebarOptions): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tree-row folder-row';
    indentRow(row, depth);

    const collapsed = collapsedDirs.has(dir.dir);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'icon-btn folder-toggle';
    toggle.innerHTML = icon(collapsed ? 'chevron-right' : 'chevron-down');
    toggle.title = collapsed ? '展开' : '折叠';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFolder(row, dir, depth, opts);
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-main';
    const count = dir.files.length + [...dir.children.values()].reduce((sum, ch) => sum + ch.files.length, 0);
    const ic = document.createElement('span');
    ic.className = 'file-icon';
    ic.innerHTML = icon('folders');
    ic.title = collapsed ? '展开' : '折叠';
    ic.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFolder(row, dir, depth, opts);
    });
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = dir.name;
    const tally = document.createElement('span');
    tally.className = 'folder-count';
    tally.textContent = String(count);
    button.append(ic, name, tally);
    button.title = dir.dir;
    button.dataset.dir = dir.dir;
    if (dir.dir === opts.selectedDir) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => opts.onDirSelect?.(dir.dir));
    row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        opts.onFolderContext?.(dir.dir, e.clientX, e.clientY);
    });

    // 拖文件到此文件夹 = 移动
    row.addEventListener('dragover', (e) => {
        e.preventDefault();
        row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drop-target');
        const from = e.dataTransfer?.getData('text/folio-path');
        if (from) opts.onMove?.(from, dir.dir);
    });

    row.append(toggle, button);
    return row;
}

function renderGroup(files: FolioListItem[], opts: SidebarOptions, _depth: number): DocumentFragment {
    const frag = document.createDocumentFragment();
    for (const file of files) {
        const row = document.createElement('div');
        row.className = 'tree-row';
        indentRow(row, _depth);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'row-main';
        button.draggable = true;
        const ic = document.createElement('span');
        ic.className = 'file-icon';
        ic.innerHTML = fileIcon(file);
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = fileName(file.path);
        button.append(ic, name);
        // bug4 2.6：星标行内靠右，不设星标组
        if (file.favorite) {
            const star = document.createElement('span');
            star.className = 'row-star';
            star.textContent = '★';
            star.title = '已收藏';
            button.append(star);
        }
        button.title = file.path;
        button.dataset.path = file.path;
        if (!opts.selectedDir && file.path === opts.activePath) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => opts.onOpen(file.path, button));
        button.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData('text/folio-path', file.path);
            e.dataTransfer!.effectAllowed = 'move';
        });
        row.append(button);
        frag.append(row);
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
 * 速记时间线：日期分组头 + 卡片。卡片 = 标题 + 彩色标签（# 名）。
 * 仍是同一座 vault 的看法，不是嵌 memos。
 */
export function renderMemoTimeline(
    nav: HTMLElement,
    files: FolioListItem[],
    opts: SidebarOptions,
): void {
    nav.replaceChildren();
    const sorted = [...files].sort((a, b) => b.path.localeCompare(a.path, 'zh'));

    let lastDay = '';
    for (const file of sorted) {
        const day = /^\d{4}-\d{2}-\d{2}/.exec(file.path.split('/').pop() ?? '')?.[0] ?? '';
        if (day && day !== lastDay) {
            lastDay = day;
            const head = document.createElement('div');
            head.className = 'memo-day';
            head.textContent = day;
            nav.append(head);
        }

        const card = document.createElement('div');
        card.className = 'memo-card';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'memo-open';
        button.innerHTML = `<span class="file-icon">${fileIcon(file)}</span><span class="file-name">${fileName(file.path)}</span>`;
        button.title = file.path;
        button.dataset.path = file.path;
        if (file.path === opts.activePath) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => opts.onOpen(file.path, button));
        card.append(button);

        const tags = document.createElement('div');
        tags.className = 'memo-tags';
        for (const tag of file.tags ?? []) {
            const chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.textContent = `# ${tag}`;
            applyTagColor(chip, tag);
            tags.append(chip);
        }
        card.append(tags);

        nav.append(card);
    }
    if (sorted.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'side-group';
        empty.textContent = 'memos/ 还没有速记';
        nav.append(empty);
    }
}
