/**
 * 顶栏居中工具栏（验收清单 11）：muya format/updateParagraph 的图标壳。
 * mousedown preventDefault 保住编辑器选区，点击即作用于当前选区/段落。
 */
import type { Muya } from '@muyajs/core';
import { icon } from './icons';

type Tool =
    | { kind: 'format'; ic: string; tip: string; type: string }
    | { kind: 'para'; ic: string; tip: string; label: string }
    | { kind: 'table'; ic: string; tip: string }
    | { kind: 'custom'; ic: string; tip: string; run: () => void }
    | { kind: 'sep' };

export function buildToolbar(bar: HTMLElement, getEditor: () => Muya | null, extras: Array<{ ic: string; tip: string; run: () => void }>): void {
    const tools: Tool[] = [
        { kind: 'format', ic: 'bold', tip: '加粗', type: 'strong' },
        { kind: 'format', ic: 'italic', tip: '斜体', type: 'em' },
        { kind: 'format', ic: 'strikethrough', tip: '删除线', type: 'del' },
        { kind: 'format', ic: 'code', tip: '行内代码', type: 'inline_code' },
        { kind: 'format', ic: 'link', tip: '链接', type: 'link' },
        { kind: 'sep' },
        { kind: 'para', ic: 'heading', tip: '一级标题（Alt+1）', label: 'heading 1' },
        { kind: 'para', ic: 'heading', tip: '二级标题（Alt+2）', label: 'heading 2' },
        { kind: 'para', ic: 'heading', tip: '三级标题（Alt+3）', label: 'heading 3' },
        { kind: 'sep' },
        { kind: 'para', ic: 'list', tip: '无序列表', label: 'ul-bullet' },
        { kind: 'para', ic: 'list-numbers', tip: '有序列表', label: 'ol-order' },
        { kind: 'para', ic: 'list-check', tip: '任务列表', label: 'ul-task' },
        { kind: 'para', ic: 'quote', tip: '引用', label: 'blockquote' },
        { kind: 'sep' },
        { kind: 'para', ic: 'table', tip: '表格', label: 'table' },
        { kind: 'para', ic: 'minus', tip: '分割线', label: 'hr' },
        { kind: 'para', ic: 'sigma', tip: '公式块', label: 'mathblock' },
    ];
    for (const extra of extras) tools.push({ kind: 'custom', ...extra });

    for (const tool of tools) {
        if (tool.kind === 'sep') {
            const sep = document.createElement('span');
            sep.className = 'tool-sep';
            bar.append(sep);
            continue;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'icon-btn tool-btn';
        button.dataset.tip = tool.tip;
        button.innerHTML = icon(tool.ic);
        // 防止点击夺走编辑器焦点/选区
        button.addEventListener('mousedown', (e) => e.preventDefault());
        button.addEventListener('click', () => {
            const editor = getEditor();
            if (!editor) return;
            if (tool.kind === 'format') editor.format(tool.type);
            else if (tool.kind === 'para') {
                if (tool.label === 'table') editor.createTable({ rows: 3, columns: 3 }, {});
                else editor.updateParagraph(tool.label);
            } else if (tool.kind === 'custom') tool.run();
        });
        bar.append(button);
    }
}
