/**
 * [[wikilink]] 交互（单元 7，Foam 规则 + SilverBullet 芯片）：
 *   - 点击 [[目标]] 文本附近 → 弹出页芯片（命中显示解析到的页；未命中显示「新建」）
 *   - Ctrl+点击 → 直接跳转
 *   - 目标不存在时一键在 notes/ 建页
 * muya 的内联渲染管线不开放自定义 token，芯片在宿主层做，md 里仍是字面 [[...]]。
 */
import { resolveLink, type WikilinkIndex } from '../shared/wikilink.ts';

export type WikilinkOptions = {
    /** 当前 vault 全部页路径（惰性取，列表会随刷新变化） */
    getPages: () => string[];
    /** 跳转到已存在的页 */
    onOpen: (path: string) => void;
    /** 新建页（点击未命中目标时） */
    onCreate: (path: string) => void;
};

const WIKILINK_G = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

function safePageName(target: string): string {
    return target.replaceAll('\\', '/').split('/').pop()!.replace(/\.md$/i, '');
}

/** 找到点击位置所在的 wikilink 目标；不在任何 [[..]] 内返回 null。 */
function wikilinkAt(doc: Document, clientX: number, clientY: number): string | null {
    const range = doc.caretRangeFromPoint?.(clientX, clientY);
    if (!range || !range.startContainer.textContent) return null;
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return null;
    const content = (node.parentElement as HTMLElement | null)?.closest<HTMLElement>('.mu-content');
    if (!content) return null;
    // 该文本节点在 content 全文中的偏移
    const walker = doc.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let base = 0;
    let current: Node | null;
    while ((current = walker.nextNode())) {
        if (current === node) break;
        base += (current.textContent ?? '').length;
    }
    const full = content.textContent ?? '';
    const caret = base + range.startOffset;
    WIKILINK_G.lastIndex = 0;
    for (const match of full.matchAll(WIKILINK_G)) {
        if (caret >= match.index && caret <= match.index + match[0].length) {
            return match[1].trim();
        }
    }
    return null;
}

export function attachWikilinkHandlers(wrap: HTMLElement, options: WikilinkOptions): void {
    let chip: HTMLDivElement | null = null;
    (window as unknown as { __wlProbe?: string[] }).__wlProbe = ['attached'];

    function hideChip(): void {
        chip?.remove();
        chip = null;
    }

    function showChip(target: string, x: number, y: number): void {
        hideChip();
        const index: WikilinkIndex = { outgoing: new Map(), pages: new Set(options.getPages()) };
        const resolved = resolveLink(index, target);
        chip = document.createElement('div');
        chip.className = 'wiki-chip';
        const label = document.createElement('span');
        label.textContent = resolved ? `→ ${resolved}` : `新建：${target}`;
        label.className = 'wiki-chip-label';
        chip.append(label);
        chip.addEventListener('click', () => {
            hideChip();
            if (resolved) options.onOpen(resolved);
            else options.onCreate(`notes/${safePageName(target)}.md`);
        });
        chip.style.left = `${Math.min(x + 8, window.innerWidth - 180)}px`;
        chip.style.top = `${y + 18}px`;
        document.body.append(chip);
    }

    wrap.addEventListener('click', (event) => {
        const mouse = event as MouseEvent;
        (window as unknown as { __wlProbe?: string[] }).__wlProbe?.push('click');
        hideChip();
        const target = wikilinkAt(document, mouse.clientX, mouse.clientY);
        (window as unknown as { __wlProbe?: string[] }).__wlProbe?.push(`target=${String(target)}`);
        if (!target) return;
        if (mouse.ctrlKey || mouse.metaKey) {
            const index: WikilinkIndex = { outgoing: new Map(), pages: new Set(options.getPages()) };
            const resolved = resolveLink(index, target);
            if (resolved) options.onOpen(resolved);
            else options.onCreate(`notes/${safePageName(target)}.md`);
            return;
        }
        showChip(target, mouse.clientX, mouse.clientY);
    });

    document.addEventListener('click', (event) => {
        if (chip && !chip.contains(event.target as Node) && !(event.target as HTMLElement).closest?.('#editor-wrap')) {
            hideChip();
        }
    });
}

/** 反链面板（单元 7）：能看见谁链过来；出链也一并给出，都可点击。 */
export function renderBacklinks(
    el: HTMLElement,
    index: { outgoing: string[]; backlinks: string[] },
    onOpen: (path: string) => void,
): void {
    el.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'bl-heading';
    heading.textContent = `链接 · 出链 ${index.outgoing.length} · 反链 ${index.backlinks.length}`;
    el.append(heading);

    const row = (label: string, paths: string[]) => {
        if (paths.length === 0) return;
        const group = document.createElement('span');
        group.className = 'bl-group';
        const tag = document.createElement('span');
        tag.className = 'bl-label';
        tag.textContent = label;
        group.append(tag);
        for (const p of paths) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'bl-chip';
            chip.textContent = p.replace(/\.md$/i, '');
            chip.title = p;
            chip.addEventListener('click', () => onOpen(p));
            group.append(chip);
        }
        el.append(group);
    };
    row('出链', index.outgoing);
    row('反链', index.backlinks);
}
