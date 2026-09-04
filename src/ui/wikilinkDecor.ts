/**
 * [[wikilink]] 可视化 + 自动补全（bug4 4.1/4.3）。
 * - 装饰：正文里的 [[目标]] 文本包成芯片（图标+着色），MutationObserver 幂等补挂
 * - 补全：菜单显示 H1，写入 `[[文件名]]` 或 `[[文件名|H1]]`（解析走文件名）
 */
import type { Muya } from '@muyajs/core';
import type { FolioListItem } from '../host/types';
import { fileName, fileStem } from '../shared/docTitle.ts';
import { icon } from './icons';

const WIKI_RE = /\[\[([^\][|]+)(?:\|([^\]]+))?\]\]/g;

/** 把段落里裸露的 [[..]] 文本包成芯片（不动 muya 的 vdom，只做展示层包裹）。 */
function decorate(wrap: HTMLElement): void {
    const walker = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
    const targets: Array<{ node: Text; match: RegExpExecArray }> = [];
    let cur: Node | null;
    while ((cur = walker.nextNode())) {
        const textNode = cur as Text;
        const text = textNode.nodeValue ?? '';
        if (!text.includes('[[')) continue;
        if ((cur.parentElement as HTMLElement)?.closest('.folio-wikilink')) continue;
        WIKI_RE.lastIndex = 0;
        const m = WIKI_RE.exec(text);
        if (m) targets.push({ node: textNode, match: m });
    }
    for (const { node, match } of targets) {
        const text = node.nodeValue ?? '';
        const at = match.index;
        const frag = document.createDocumentFragment();
        if (at > 0) frag.append(text.slice(0, at));
        const chip = document.createElement('span');
        chip.className = 'folio-wikilink';
        chip.setAttribute('data-raw', match[0]);
        const label = (match[2] ?? match[1]).trim();
        chip.innerHTML = icon('arrows-double-sw-ne');
        const lab = document.createElement('span');
        lab.className = 'folio-wikilink-text';
        lab.textContent = label;
        chip.append(lab);
        frag.append(chip);
        if (at + match[0].length < text.length) frag.append(text.slice(at + match[0].length));
        node.replaceWith(frag);
    }
}

export function attachWikilinkDecor(wrap: HTMLElement): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const obs = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => decorate(wrap), 150);
    });
    obs.observe(wrap, { childList: true, subtree: true, characterData: true });
}

type AcState = {
    active: boolean;
    query: string;
    index: number;
};

export type AutocompleteOptions = {
    getFiles: () => FolioListItem[];
    getEditor: () => Muya | null;
};

export function attachWikiAutocomplete(wrap: HTMLElement, opts: AutocompleteOptions): void {
    const state: AcState = { active: false, query: '', index: 0 };
    let pop: HTMLDivElement | null = null;

    function matches(): FolioListItem[] {
        const q = state.query.toLowerCase();
        return opts
            .getFiles()
            .filter((f) => !q || f.title.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
            .slice(0, 8);
    }

    function close(): void {
        pop?.remove();
        pop = null;
        state.active = false;
        state.query = '';
        state.index = 0;
    }

    function caretPoint(): { x: number; y: number } {
        const sel = window.getSelection();
        const range = sel?.getRangeAt(0);
        const rect = range?.getBoundingClientRect?.();
        return rect ? { x: rect.left, y: rect.bottom } : { x: innerWidth / 2, y: 120 };
    }

    function render(): void {
        const list = matches();
        pop?.remove();
        pop = document.createElement('div');
        pop.className = 'wiki-ac';
        if (list.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'wiki-ac-empty';
            empty.textContent = '无匹配文档';
            pop.append(empty);
        }
        list.forEach((file, i) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = i === state.index ? 'wiki-ac-row active' : 'wiki-ac-row';
            const label = document.createElement('span');
            label.className = 'wiki-ac-title';
            label.textContent = file.title;
            const dir = document.createElement('span');
            dir.className = 'wiki-ac-dir';
            dir.textContent = fileName(file.path);
            row.append(label, dir);
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                commit(file);
            });
            pop!.append(row);
        });
        const pt = caretPoint();
        pop.style.left = `${Math.min(pt.x + 8, innerWidth - 280)}px`;
        pop.style.top = `${Math.min(pt.y + 4, innerHeight - 240)}px`;
        document.body.append(pop);
    }

    function commit(file: FolioListItem): void {
        const editor = opts.getEditor();
        close();
        if (!editor) return;
        const typed = `[[${state.query}`;
        const stem = fileStem(file.path);
        const inner = file.title && file.title !== stem ? `${stem}|${file.title}` : stem;
        try {
            editor.replaceCurrentWordInlineUnsafe(typed, `[[${inner}]]`);
        } catch {
            // 边缘情况静默：手输 ]] 也能达成
        }
    }

    wrap.addEventListener('keydown', (event) => {
        if (!state.active) {
            if (event.key === '[' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                // 连续两个 [[ 才触发：检查光标前一个字符
                const sel = window.getSelection();
                const node = sel?.anchorNode;
                const offset = sel?.anchorOffset ?? 0;
                const prev = node?.nodeValue?.[offset - 1];
                if (prev === '[' && node?.parentElement?.closest('#editor-wrap')) {
                    state.active = true;
                    state.query = '';
                    state.index = 0;
                    setTimeout(render, 0);
                }
            }
            return;
        }
        if (event.key === 'Escape') {
            close();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const list = matches();
            if (list.length) {
                state.index = (state.index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
                render();
            }
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const list = matches();
            if (list[state.index]) commit(list[state.index]);
            else close();
            return;
        }
        if (event.key === ']') {
            close();
            return;
        }
        if (event.key === 'Backspace') {
            if (state.query.length > 0) {
                state.query = state.query.slice(0, -1);
                state.index = 0;
                setTimeout(render, 0);
            } else {
                close();
            }
            return;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            state.query += event.key;
            state.index = 0;
            setTimeout(render, 0);
        }
    });
}
