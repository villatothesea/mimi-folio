/**
 * 文档目录（单元 12）：中区右上角悬浮窗，H1–H6 缩进树。
 * 数据 muya.getTOC()（顺序 = 文档顺序）；点击滚到对应标题；滚动时高亮所在节。
 */
import type { Muya } from '@muyajs/core';

export function renderToc(el: HTMLElement, editor: Muya | null): void {
    // 只清条目，保留宿主层挂在 #toc-list 里的其它节点
    for (const child of [...el.children]) {
        if (child.classList.contains('toc-item') || child.classList.contains('toc-empty')) child.remove();
    }
    if (!editor) {
        const empty = document.createElement('div');
        empty.className = 'toc-empty';
        empty.textContent = '未打开';
        el.append(empty);
        return;
    }
    const toc = editor.getTOC();
    if (toc.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'toc-empty';
        empty.textContent = '无标题';
        el.append(empty);
        return;
    }
    toc.forEach((item, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toc-item';
        button.dataset.index = String(i);
        button.dataset.lvl = String(item.lvl);
        button.style.paddingLeft = `calc(var(--folio-space-2) + ${(item.lvl - 1) * 0.8}em)`;
        button.textContent = item.content || '(空标题)';
        button.title = item.content;
        button.addEventListener('click', () => scrollToHeading(i));
        el.append(button);
    });
    highlightActive(el);
}

/** TOC 第 i 项 ↔ 文档里第 i 个标题块（两边都按文档顺序）。 */
function scrollToHeading(index: number): void {
    const headings = document.querySelectorAll<HTMLElement>('#editor-wrap .mu-atx-heading');
    const target = headings[index];
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    // 落一个光标过去（点击序列走 muya 的 click 处理）
    const content = target.querySelector<HTMLElement>('.mu-content') ?? target;
    const rect = content.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: rect.x + 8, clientY: rect.y + 8, button: 0 };
    content.dispatchEvent(new MouseEvent('mousedown', opts));
    content.dispatchEvent(new MouseEvent('mouseup', opts));
    content.dispatchEvent(new MouseEvent('click', opts));
}

/** 滚动位置高亮当前所在标题（最顶上可见的那个）。 */
export function highlightActive(el: HTMLElement): void {
    const headings = [...document.querySelectorAll<HTMLElement>('#editor-wrap .mu-atx-heading')];
    if (headings.length === 0) return;
    let active = 0;
    for (let i = 0; i < headings.length; i++) {
        if (headings[i].getBoundingClientRect().top <= 120) active = i;
    }
    el.querySelectorAll<HTMLButtonElement>('.toc-item').forEach((button) => {
        if (button.dataset.index === String(active)) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
    });
}
