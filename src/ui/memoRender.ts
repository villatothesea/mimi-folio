/**
 * 速记卡片短记子集：段落、行内代码、清单、#tag、[[wikilink]]、本机图。
 * 不引入第二套 markdown 库；输出已转义，不跑任意 HTML。
 */
import { splitFrontmatter } from '../shared/frontmatter.ts';

const TASK_RE = /^(\s*)[-*+]\s+\[([ xX])\]\s?(.*)$/;
const WIKI_RE = /^\[\[([^\]|#]+)(?:#[^|\]]+)?(?:\|([^\]]+))?\]\]/;
const IMG_RE = /^!\[([^\]]*)\]\((attachments\/[^)\s]+)\)/;

function esc(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function inline(text: string): string {
    let out = '';
    let i = 0;
    while (i < text.length) {
        if (text[i] === '`') {
            const end = text.indexOf('`', i + 1);
            if (end > i) {
                out += `<code>${esc(text.slice(i + 1, end))}</code>`;
                i = end + 1;
                continue;
            }
        }
        const rest = text.slice(i);
        const img = IMG_RE.exec(rest);
        if (img) {
            out += `<img class="memo-img" src="/${esc(img[2])}" alt="${esc(img[1])}">`;
            i += img[0].length;
            continue;
        }
        const wiki = WIKI_RE.exec(rest);
        if (wiki) {
            const target = wiki[1].trim();
            const label = wiki[2]?.trim() || target;
            out += `<button type="button" class="memo-wiki" data-wiki="${esc(target)}">${esc(label)}</button>`;
            i += wiki[0].length;
            continue;
        }
        const hash = /^#([^\s#]+)/.exec(rest);
        const boundary = i === 0 || /[\s([{（【]/.test(text[i - 1] ?? '');
        if (hash && boundary) {
            const name = hash[1].replace(/[.,;:!?。，；：！？)\]】）]+$/u, '');
            if (name) {
                out += `<button type="button" class="memo-hash" data-tag="${esc(name)}">#${esc(name)}</button>`;
                i += 1 + name.length;
                continue;
            }
        }
        out += esc(text[i]!);
        i += 1;
    }
    return out;
}

/** 把速记 markdown 渲成卡片 HTML。行号相对正文（含 frontmatter 后的空行）。 */
export function renderMemoLite(markdown: string): string {
    const { body } = splitFrontmatter(markdown);
    const lines = body.split('\n');
    const html: string[] = [];
    let fence: string[] | null = null;

    const flushFence = (): void => {
        if (!fence) return;
        html.push(`<pre class="memo-pre"><code>${esc(fence.join('\n'))}</code></pre>`);
        fence = null;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (fence) {
            if (line.startsWith('```')) flushFence();
            else fence.push(line);
            continue;
        }
        if (line.startsWith('```')) {
            fence = [];
            continue;
        }
        const task = TASK_RE.exec(line);
        if (task) {
            const on = task[2] !== ' ';
            html.push(
                `<label class="memo-task"><input type="checkbox" data-line="${i}"${on ? ' checked' : ''}>`
                + `<span>${inline(task[3])}</span></label>`,
            );
            continue;
        }
        if (!line.trim()) continue;
        html.push(`<p>${inline(line)}</p>`);
    }
    flushFence();
    return html.join('');
}
