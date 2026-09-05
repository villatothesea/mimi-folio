/**
 * 速记看法：左栏搜/历/标签，中区 composer + 卡片流。
 * 捕获与就地改用 textarea；只有「在笔记里打开」才上 Muya。
 */
import type { FolioHost, FolioIndex, FolioListItem } from '../host/types.ts';
import { setScalar, splitFrontmatter } from '../shared/frontmatter.ts';
import {
    bodySnippet,
    hasCode,
    hasTask,
    hasWikilink,
    memoDayFromPath,
    newMemoMarkdown,
    newMemoPath,
    relativeTime,
    saveMemoMarkdown,
    toggleTaskAtLine,
} from '../shared/memoMd.ts';
import { buildIndex, resolveLink } from '../shared/wikilink.ts';
import { monthCells, WEEKDAYS } from './memoCalendar.ts';
import { showContextMenu } from './contextMenu.ts';
import { icon } from './icons.ts';
import { renderMemoLite } from './memoRender.ts';
import { applyTagColor } from './tagColors.ts';

export type MemoDeps = {
    host: Pick<FolioHost, 'write' | 'saveImage'> & {
        deleteDoc?: FolioHost['deleteDoc'];
        index?: FolioHost['index'];
    };
    files: FolioListItem[];
    say: (msg: string) => void;
    confirm: (msg: string) => Promise<boolean>;
    openInNote: (path: string) => void;
    refresh: () => Promise<void>;
};

type Derived = 'link' | 'task' | 'code';

const state = {
    selectedDay: null as string | null,
    tagFilter: null as string | null,
    derived: null as Derived | null,
    search: '',
    editingPath: null as string | null,
    year: new Date().getFullYear(),
    month0: new Date().getMonth(),
    bound: false,
};

let deps: MemoDeps | null = null;

export function isMemoBusy(): boolean {
    if (!state.editingPath) return false;
    const ae = document.activeElement;
    return ae instanceof HTMLTextAreaElement && ae.classList.contains('memo-edit');
}

export function focusComposer(): void {
    document.querySelector<HTMLTextAreaElement>('#memo-composer')?.focus();
}

export async function paintMemoView(next: MemoDeps): Promise<void> {
    deps = next;
    bindOnce();
    paintCalendar();
    paintDerived();
    paintTags();
    paintActive();
    await paintStream();
}

function memosOf(): FolioListItem[] {
    return (deps?.files ?? []).filter((f) => f.kind === 'memo');
}

function bindOnce(): void {
    if (state.bound) return;
    state.bound = true;

    const searchIc = document.querySelector('.memo-search-ic');
    if (searchIc) searchIc.innerHTML = icon('search');

    const search = document.querySelector<HTMLInputElement>('#memo-search');
    search?.addEventListener('input', () => {
        state.search = search.value.trim();
        paintActive();
        void paintStream();
    });

    const composer = document.querySelector<HTMLTextAreaElement>('#memo-composer');
    const bar = document.querySelector<HTMLElement>('#memo-composer-bar');
    if (bar && composer) {
        bar.replaceChildren();
        const tool = (name: string, tip: string, run: () => void): void => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'icon-btn';
            b.dataset.tip = tip;
            b.innerHTML = icon(name);
            b.addEventListener('click', run);
            bar.append(b);
        };
        const insert = (text: string): void => {
            const s = composer.selectionStart;
            const e = composer.selectionEnd;
            composer.value = `${composer.value.slice(0, s)}${text}${composer.value.slice(e)}`;
            composer.selectionStart = composer.selectionEnd = s + text.length;
            composer.focus();
        };
        tool('hash', '插入标签', () => insert(' #'));
        tool('list-check', '插入清单', () => insert('\n- [ ] '));
        tool('paperclip', '插入图片', () => void attachImage(composer, insert));
        const hint = document.createElement('span');
        hint.className = 'memo-composer-hint';
        hint.textContent = 'Ctrl+Enter';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'memo-save';
        save.textContent = '保存';
        save.addEventListener('click', () => void submitComposer());
        bar.append(hint, save);
        composer.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submitComposer();
            }
        });
    }

    const stream = document.querySelector<HTMLElement>('#memo-stream');
    stream?.addEventListener('click', onStreamClick);
    stream?.addEventListener('change', onStreamChange);
}

async function attachImage(
    composer: HTMLTextAreaElement,
    insert: (text: string) => void,
): Promise<void> {
    if (!deps) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            const img = await deps!.host.saveImage(new Uint8Array(await file.arrayBuffer()), file.name);
            insert(`![](${img.src})`);
            composer.focus();
        } catch (err) {
            deps!.say(`插图失败：${(err as Error).message}`);
        }
    });
    input.click();
}

async function submitComposer(): Promise<void> {
    if (!deps) return;
    const ta = document.querySelector<HTMLTextAreaElement>('#memo-composer');
    if (!ta) return;
    const body = ta.value.replace(/^\s+/, '').replace(/\s+$/, '');
    if (!body) return;
    let path = newMemoPath(state.selectedDay);
    let n = 0;
    while (deps.files.some((f) => f.path === path)) {
        n += 1;
        path = newMemoPath(state.selectedDay).replace(/\.md$/, `-${n}.md`);
    }
    try {
        await deps.host.write(path, newMemoMarkdown(body));
        ta.value = '';
        deps.say(`已存 ${new Date().toLocaleTimeString()}`);
        await deps.refresh();
    } catch (err) {
        deps.say(`新建失败：${(err as Error).message}`);
    }
}

function dayCounts(): Map<string, number> {
    const map = new Map<string, number>();
    for (const file of memosOf()) {
        const day = memoDayFromPath(file.path);
        if (!day) continue;
        map.set(day, (map.get(day) ?? 0) + 1);
    }
    return map;
}

function paintCalendar(): void {
    const root = document.querySelector<HTMLElement>('#memo-cal');
    if (!root) return;
    root.replaceChildren();
    const head = document.createElement('div');
    head.className = 'memo-cal-head';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'icon-btn';
    prev.dataset.tip = '上个月';
    prev.innerHTML = icon('chevron-left');
    prev.addEventListener('click', () => {
        if (state.month0 === 0) {
            state.year -= 1;
            state.month0 = 11;
        } else state.month0 -= 1;
        paintCalendar();
    });
    const title = document.createElement('span');
    title.className = 'memo-cal-title';
    title.textContent = `${state.year}年${state.month0 + 1}月`;
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'icon-btn';
    next.dataset.tip = '下个月';
    next.innerHTML = icon('chevron-right');
    next.addEventListener('click', () => {
        if (state.month0 === 11) {
            state.year += 1;
            state.month0 = 0;
        } else state.month0 += 1;
        paintCalendar();
    });
    head.append(prev, title, next);

    const week = document.createElement('div');
    week.className = 'memo-cal-week';
    for (const d of WEEKDAYS) {
        const span = document.createElement('span');
        span.textContent = d;
        week.append(span);
    }

    const grid = document.createElement('div');
    grid.className = 'memo-cal-grid';
    const today = new Date().toLocaleDateString('sv');
    for (const cell of monthCells(state.year, state.month0, dayCounts())) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'memo-cal-day';
        if (cell.inMonth) btn.classList.add('in-month');
        if (cell.count > 0) btn.classList.add('has-memos');
        if (cell.iso === today) btn.classList.add('is-today');
        btn.textContent = String(cell.date);
        btn.dataset.day = cell.iso;
        btn.setAttribute('aria-pressed', String(state.selectedDay === cell.iso));
        btn.addEventListener('click', () => {
            state.selectedDay = state.selectedDay === cell.iso ? null : cell.iso;
            paintCalendar();
            paintActive();
            void paintStream();
        });
        grid.append(btn);
    }
    root.append(head, week, grid);
}

function visibleMemos(): FolioListItem[] {
    let list = memosOf();
    if (state.selectedDay) list = list.filter((f) => memoDayFromPath(f.path) === state.selectedDay);
    if (state.tagFilter) list = list.filter((f) => f.tags?.includes(state.tagFilter!));
    if (state.derived === 'link') list = list.filter((f) => hasWikilink(f.markdown ?? ''));
    if (state.derived === 'task') list = list.filter((f) => hasTask(f.markdown ?? ''));
    if (state.derived === 'code') list = list.filter((f) => hasCode(f.markdown ?? ''));
    if (state.search) {
        const q = state.search.toLowerCase();
        list = list.filter((f) => (f.markdown ?? '').toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
    }
    return list.sort((a, b) => {
        const fav = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
        if (fav) return fav;
        const da = memoDayFromPath(a.path) ?? '0000-00-00';
        const db = memoDayFromPath(b.path) ?? '0000-00-00';
        if (da !== db) return db.localeCompare(da);
        return b.path.localeCompare(a.path, 'zh');
    });
}

function paintDerived(): void {
    const root = document.querySelector<HTMLElement>('#memo-derived');
    if (!root) return;
    root.replaceChildren();
    const all = memosOf();
    const items: Array<[Derived, string, number]> = [
        ['link', '链接', all.filter((f) => hasWikilink(f.markdown ?? '')).length],
        ['task', '任务', all.filter((f) => hasTask(f.markdown ?? '')).length],
        ['code', '代码', all.filter((f) => hasCode(f.markdown ?? '')).length],
    ];
    for (const [key, label, count] of items) {
        if (count === 0 && state.derived !== key) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'memo-chip';
        b.textContent = `${label} ${count}`;
        b.setAttribute('aria-pressed', String(state.derived === key));
        b.addEventListener('click', () => {
            state.derived = state.derived === key ? null : key;
            paintDerived();
            paintActive();
            void paintStream();
        });
        root.append(b);
    }
}

function paintTags(): void {
    const root = document.querySelector<HTMLElement>('#memo-tags');
    if (!root) return;
    root.replaceChildren();
    const counts = new Map<string, number>();
    for (const file of memosOf()) {
        for (const tag of file.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    for (const tag of [...counts.keys()].sort((a, b) => a.localeCompare(b, 'zh'))) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tag-chip';
        b.textContent = `# ${tag}`;
        b.dataset.tag = tag;
        if (tag === state.tagFilter) b.setAttribute('aria-pressed', 'true');
        applyTagColor(b, tag);
        b.addEventListener('click', () => setTagFilter(tag));
        root.append(b);
    }
}

function setTagFilter(tag: string | null): void {
    state.tagFilter = tag && state.tagFilter === tag ? null : tag;
    paintTags();
    paintActive();
    void paintStream();
}

function paintActive(): void {
    const root = document.querySelector<HTMLElement>('#memo-active');
    if (!root) return;
    root.replaceChildren();
    const chip = (label: string, clear: () => void): void => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'memo-chip';
        b.textContent = `${label} ×`;
        b.addEventListener('click', clear);
        root.append(b);
    };
    if (state.selectedDay) {
        chip(state.selectedDay, () => {
            state.selectedDay = null;
            paintCalendar();
            paintActive();
            void paintStream();
        });
    }
    if (state.tagFilter) chip(`#${state.tagFilter}`, () => setTagFilter(null));
    if (state.derived) {
        const label = state.derived === 'link' ? '链接' : state.derived === 'task' ? '任务' : '代码';
        chip(label, () => {
            state.derived = null;
            paintDerived();
            paintActive();
            void paintStream();
        });
    }
}

function pagesIndex() {
    return buildIndex(new Map((deps?.files ?? []).map((f) => [f.path, f.markdown ?? ''])));
}

async function paintStream(): Promise<void> {
    const root = document.querySelector<HTMLElement>('#memo-stream');
    if (!root || !deps) return;
    const list = visibleMemos();
    if (list.length === 0) {
        root.replaceChildren();
        const empty = document.createElement('div');
        empty.className = 'memo-empty';
        empty.textContent = memosOf().length === 0 ? '还没有速记' : '没有符合筛选的速记';
        root.append(empty);
        return;
    }
    const links = await Promise.all(
        list.map((file) => deps!.host.index?.(file.path) ?? Promise.resolve<FolioIndex>({ outgoing: [], backlinks: [] })),
    );
    root.replaceChildren();
    list.forEach((file, i) => root.append(renderCard(file, links[i]!)));
}

function renderCard(file: FolioListItem, links: FolioIndex): HTMLElement {
    const card = document.createElement('article');
    card.className = 'memo-flow-card';
    card.dataset.path = file.path;

    const head = document.createElement('div');
    head.className = 'memo-flow-head';
    const time = document.createElement('span');
    time.className = 'memo-flow-time';
    time.textContent = relativeTime(file.mtimeMs ?? Date.now());
    time.title = file.path;
    head.append(time);
    if (file.favorite) {
        const star = document.createElement('span');
        star.innerHTML = icon('star', true);
        star.title = '已钉选';
        head.append(star);
    }
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'icon-btn';
    more.dataset.tip = '更多';
    more.innerHTML = icon('dots-vertical');
    more.addEventListener('click', (event) => {
        event.stopPropagation();
        openCardMenu(file, more);
    });
    head.append(more);
    card.append(head);

    if (state.editingPath === file.path) {
        card.append(editBox(file));
    } else {
        const body = document.createElement('div');
        body.className = 'memo-body';
        body.innerHTML = renderMemoLite(file.markdown ?? '');
        body.addEventListener('click', (event) => {
            const t = event.target as HTMLElement;
            if (t.closest('button, input, a, label')) return;
            state.editingPath = file.path;
            void paintStream();
        });
        card.append(body);
        appendRelations(card, links);
    }
    return card;
}

function editBox(file: FolioListItem): HTMLElement {
    const wrap = document.createElement('div');
    const ta = document.createElement('textarea');
    ta.className = 'memo-edit';
    ta.value = splitFrontmatter(file.markdown ?? '').body.replace(/^\n+/, '');
    const hint = document.createElement('div');
    hint.className = 'memo-composer-hint';
    hint.textContent = 'Ctrl+Enter 保存 · Esc 取消';
    ta.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            state.editingPath = null;
            void paintStream();
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void saveEdit(file, ta.value);
        }
    });
    wrap.append(ta, hint);
    queueMicrotask(() => ta.focus());
    return wrap;
}

async function saveEdit(file: FolioListItem, body: string): Promise<void> {
    if (!deps) return;
    try {
        await deps.host.write(file.path, saveMemoMarkdown(file.markdown ?? '', body), file.mtimeMs);
        state.editingPath = null;
        deps.say(`已存 ${new Date().toLocaleTimeString()}`);
        await deps.refresh();
    } catch (err) {
        deps.say(`保存失败：${(err as Error).message}`);
    }
}

function appendRelations(card: HTMLElement, links: FolioIndex): void {
    if (!deps) return;
    const add = (label: string, paths: string[]): void => {
        if (paths.length === 0) return;
        const box = document.createElement('div');
        box.className = 'memo-rel';
        const head = document.createElement('div');
        head.className = 'memo-rel-label';
        head.textContent = `${label} ${paths.length}`;
        box.append(head);
        for (const path of paths) {
            const item = deps!.files.find((f) => f.path === path);
            const mini = document.createElement('button');
            mini.type = 'button';
            mini.className = 'memo-mini';
            mini.dataset.path = path;
            const title = document.createElement('span');
            title.className = 'memo-mini-title';
            title.textContent = item?.title ?? path;
            const snip = document.createElement('span');
            snip.className = 'memo-mini-snip';
            snip.textContent = item?.markdown ? bodySnippet(item.markdown) : path;
            mini.append(title, snip);
            mini.addEventListener('click', (event) => {
                event.stopPropagation();
                openTarget(path);
            });
            box.append(mini);
        }
        card.append(box);
    };
    add('出链', links.outgoing);
    add('反链', links.backlinks);
}

function openTarget(path: string): void {
    if (!deps) return;
    const item = deps.files.find((f) => f.path === path);
    if (item?.kind === 'memo') {
        const el = document.querySelector<HTMLElement>(`.memo-flow-card[data-path="${CSS.escape(path)}"]`);
        if (el) {
            el.scrollIntoView({ block: 'center' });
            return;
        }
    }
    deps.openInNote(path);
}

function openCardMenu(file: FolioListItem, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const fav = Boolean(file.favorite);
    showContextMenu(rect.left, rect.bottom + 4, [
        {
            ic: 'star',
            label: fav ? '取消钉选' : '钉选到顶部',
            run: () => void toggleFav(file),
        },
        {
            ic: 'file-text',
            label: '在笔记里打开',
            run: () => deps?.openInNote(file.path),
        },
        { sep: true },
        {
            ic: 'trash',
            label: '删除',
            danger: true,
            run: () => void deleteMemo(file),
        },
    ]);
}

async function toggleFav(file: FolioListItem): Promise<void> {
    if (!deps) return;
    const next = setScalar(file.markdown ?? '', 'favorite', file.favorite ? null : true);
    try {
        await deps.host.write(file.path, next, file.mtimeMs);
        await deps.refresh();
    } catch (err) {
        deps.say(`钉选失败：${(err as Error).message}`);
    }
}

async function deleteMemo(file: FolioListItem): Promise<void> {
    if (!deps?.host.deleteDoc) return;
    if (!(await deps.confirm('删除这条速记？'))) return;
    try {
        await deps.host.deleteDoc(file.path);
        if (state.editingPath === file.path) state.editingPath = null;
        await deps.refresh();
    } catch (err) {
        deps.say(`删除失败：${(err as Error).message}`);
    }
}

function onStreamClick(event: Event): void {
    const t = event.target as HTMLElement;
    const wiki = t.closest<HTMLElement>('.memo-wiki');
    if (wiki?.dataset.wiki) {
        event.preventDefault();
        const path = resolveLink(pagesIndex(), wiki.dataset.wiki);
        if (path) openTarget(path);
        else deps?.say(`找不到 [[${wiki.dataset.wiki}]]`);
        return;
    }
    const hash = t.closest<HTMLElement>('.memo-hash');
    if (hash?.dataset.tag) {
        event.preventDefault();
        setTagFilter(hash.dataset.tag);
    }
}

function onStreamChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'checkbox' || input.dataset.line === undefined || !deps) return;
    const card = input.closest<HTMLElement>('.memo-flow-card');
    const path = card?.dataset.path;
    const file = deps.files.find((f) => f.path === path);
    if (!file) return;
    const line = Number(input.dataset.line);
    void (async () => {
        try {
            await deps!.host.write(file.path, toggleTaskAtLine(file.markdown ?? '', line), file.mtimeMs);
            await deps!.refresh();
        } catch (err) {
            deps!.say(`勾选失败：${(err as Error).message}`);
        }
    })();
}
