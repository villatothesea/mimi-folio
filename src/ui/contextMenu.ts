/**
 * 自定义右键菜单（验收清单 4/14）：接管 contextmenu。
 * 左栏文档菜单（重命名/移动/复制/副本/路径/米米预留/删除）与中区段落菜单
 * （上方插入/下方插入/改为/删除）都在这层，muya 与浏览器原生菜单一律屏蔽。
 */
import { icon } from './icons';

export type MenuItem = {
    ic?: string;
    label?: string;
    danger?: boolean;
    disabled?: boolean;
    sep?: boolean;
    /** 二级菜单（hover 展开） */
    children?: Array<{ label: string; run: () => void }>;
    run?: () => void;
};

let open: HTMLDivElement | null = null;

function close(): void {
    open?.remove();
    open = null;
}

export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
    close();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    for (const item of items) {
        if (item.sep) {
            const sep = document.createElement('div');
            sep.className = 'ctx-sep';
            menu.append(sep);
            continue;
        }
        const row = document.createElement('button');
        row.type = 'button';
        if (item.danger) row.classList.add('danger');
        if (item.disabled) row.disabled = true;
        row.innerHTML = `${item.ic ? icon(item.ic) : '<span class="ctx-ic-none"></span>'}<span class="ctx-label">${item.label}</span>${item.children ? icon('chevron-right') : ''}`;
        if (item.children) {
            row.classList.add('ctx-has-sub');
            const sub = document.createElement('div');
            sub.className = 'ctx-sub';
            for (const child of item.children) {
                const subRow = document.createElement('button');
                subRow.type = 'button';
                subRow.textContent = child.label;
                subRow.addEventListener('click', () => {
                    close();
                    child.run();
                });
                sub.append(subRow);
            }
            row.append(sub);
        } else if (!item.disabled) {
            row.addEventListener('click', () => {
                close();
                item.run?.();
            });
        }
        menu.append(row);
    }
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
    open = menu;
}

/** 屏蔽浏览器原生右键（编辑器内的图片/链接等也不出原生菜单）。 */
export function blockNativeContextMenu(scope: HTMLElement): void {
    scope.addEventListener('contextmenu', (event) => event.preventDefault());
}

document.addEventListener('mousedown', (event) => {
    if (open && !open.contains(event.target as Node)) close();
});
window.addEventListener('blur', close);
