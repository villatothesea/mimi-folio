/**
 * 文档目录：第一行是文档标题（YAML title / 文件名），其后才是正文 H1–H6。
 * 标题行滚到页头；标题块数据仍来自 muya.getTOC()。
 */
import type { Muya } from '@muyajs/core';

/**
 * 目录只显示一行标题。文里的 `---` 横线常被当成 setext 二级标题，
 * 于是整段正文带着换行进目录，看起来像被撕成竖条。
 */
export function tocLabel(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const breaks = (trimmed.match(/\n/g) ?? []).length;
    if (breaks >= 2 || trimmed.length > 200) return null;
    return trimmed.replace(/\s+/g, ' ');
}

export function renderToc(el: HTMLElement, editor: Muya | null, docTitle?: string): void {
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
    const title = docTitle?.trim() ?? '';
    if (title) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toc-item toc-doc-title';
        button.dataset.kind = 'doc';
        button.textContent = title;
        button.title = title;
        button.addEventListener('click', () => {
            document.querySelector('#doc-head')?.scrollIntoView({ block: 'start' });
        });
        el.append(button);
    }
    const toc = editor.getTOC();
    if (!title && toc.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'toc-empty';
        empty.textContent = '无标题';
        el.append(empty);
        return;
    }
    toc.forEach((item, i) => {
        const label = tocLabel(item.content || '');
        if (!label) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toc-item';
        button.dataset.index = String(i);
        button.dataset.lvl = String(item.lvl);
        button.style.paddingLeft = `calc(var(--folio-space-2) + ${(item.lvl - 1) * 0.8}em)`;
        button.textContent = label;
        button.title = label;
        button.addEventListener('click', () => scrollToHeading(i));
        el.append(button);
    });
    highlightActive(el);
}

/** TOC 第 i 项 ↔ 文档里第 i 个标题块（atx + setext，与 getTOC 同一顺序）。 */
function headingEls(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('#editor-wrap .mu-atx-heading, #editor-wrap .mu-setext-heading')];
}

function scrollToHeading(index: number): void {
    const target = headingEls()[index];
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

/** 滚动位置高亮当前所在标题（最顶上可见的那个）；在所有 H1 之上则高亮文档标题行。 */
export function highlightActive(el: HTMLElement): void {
    const headings = headingEls();
    const atDocHead = headings.length === 0 || headings[0].getBoundingClientRect().top > 120;
    let headingIdx: number | null = null;
    if (!atDocHead) {
        headingIdx = 0;
        for (let i = 0; i < headings.length; i++) {
            if (headings[i].getBoundingClientRect().top <= 120) headingIdx = i;
        }
    }
    el.querySelectorAll<HTMLButtonElement>('.toc-item').forEach((button) => {
        const on = button.dataset.kind === 'doc'
            ? atDocHead
            : headingIdx !== null && button.dataset.index === String(headingIdx);
        if (on) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
    });
}
