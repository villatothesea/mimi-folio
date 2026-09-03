/**
 * 全局搜索面板（验收批）：Ctrl+F 弹出，页面中上方居中，下方浅灰蒙层。
 * 结果行 = [类型图标] 笔记标题（大）+ 命中上下文（小，<mark> 高亮）。
 * 键盘：↑↓ 选择、回车打开、Esc 关闭。
 */
import type { FolioListItem, FolioSearchItem } from '../host/types';
import { icon } from './icons';

export type SearchPaletteOptions = {
    search: (query: string) => Promise<FolioSearchItem[]>;
    onOpen: (path: string) => void;
    /** 全部文件（标签行数据，bug4 4.5） */
    getFiles: () => FolioListItem[];
};

function escapeHtml(text: string): string {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function itemIcon(item: FolioSearchItem): string {
    if (item.linked) return icon('link');
    return icon(item.kind === 'memo' ? 'memo' : 'note');
}

export function attachSearchPalette(opts: SearchPaletteOptions): { show: () => void } {
    const overlay = document.createElement('div');
    overlay.id = 'search-overlay';
    overlay.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'search-panel';

    const inputWrap = document.createElement('div');
    inputWrap.className = 'search-input-wrap';
    inputWrap.innerHTML = icon('search');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '搜索笔记、正文…';
    input.className = 'search-input';
    inputWrap.append(input);
    panel.append(inputWrap);

    // 标签行（bug4 4.5）：全库标签平铺、A-Z 排序、点击即搜
    const tagsRow = document.createElement('div');
    tagsRow.className = 'search-tags';
    panel.append(tagsRow);

    function renderTags(): void {
        const tags = new Set<string>();
        for (const file of opts.getFiles()) for (const tag of file.tags ?? []) tags.add(tag);
        tagsRow.replaceChildren(
            ...[...tags].sort((a, b) => a.localeCompare(b, 'en'))
                .map((tag) => {
                    const chip = document.createElement('button');
                    chip.type = 'button';
                    chip.className = 'tag-chip';
                    chip.textContent = tag;
                    chip.addEventListener('click', () => {
                        input.value = tag;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                    return chip;
                }),
        );
    }
    renderTags();

    const list = document.createElement('div');
    list.className = 'search-list';
    panel.append(list);

    overlay.append(panel);
    document.body.append(overlay);

    let results: FolioSearchItem[] = [];
    let active = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function renderList(query: string): void {
        list.replaceChildren();
        active = Math.min(active, Math.max(results.length - 1, 0));
        results.forEach((item, i) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = i === active ? 'search-row active' : 'search-row';
            const iconSpan = document.createElement('span');
            iconSpan.className = 'search-icon';
            iconSpan.innerHTML = itemIcon(item);
            const texts = document.createElement('span');
            texts.className = 'search-texts';
            const title = document.createElement('span');
            title.className = 'search-title';
            title.textContent = item.title;
            const snippet = document.createElement('span');
            snippet.className = 'search-snippet';
            const m = item.matches[0];
            if (m && query) {
                const hit = m.text.slice(m.start, m.start + query.length);
                snippet.innerHTML =
                    `${escapeHtml(m.text.slice(0, m.start))}<mark>${escapeHtml(hit)}</mark>${escapeHtml(m.text.slice(m.start + query.length))}`;
            } else {
                snippet.textContent = m?.text ?? '';
            }
            texts.append(title, snippet);
            row.append(iconSpan, texts);
            row.addEventListener('click', () => {
                hide();
                opts.onOpen(item.path);
            });
            list.append(row);
        });
        if (results.length === 0 && query) {
            const empty = document.createElement('div');
            empty.className = 'search-empty';
            empty.textContent = '没有命中';
            list.append(empty);
        }
    }

    function hide(): void {
        overlay.hidden = true;
    }

    function show(): void {
        overlay.hidden = false;
        input.focus();
        input.select();
    }

    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const q = input.value.trim();
            if (!q) {
                results = [];
                renderList('');
                return;
            }
            try {
                results = await opts.search(q);
            } catch {
                results = [];
            }
            active = 0;
            renderList(q);
        }, 200);
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hide();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (results.length === 0) return;
            active = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
            renderList(input.value.trim());
            return;
        }
        if (event.key === 'Enter' && results[active]) {
            hide();
            opts.onOpen(results[active].path);
        }
    });

    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) hide();
    });

    return { show };
}
