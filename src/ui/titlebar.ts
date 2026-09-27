/**
 * 桌面壳标题栏：无边框窗，整条顶栏（sidebar-head + page-head）兼任标题栏——
 * 空白处按住可拖窗、双击切最大化，右端挂最小化/最大化/关闭。
 * 浏览器 / daemon 模式不装（系统标题栏本来就是浏览器的）。
 */
import { isDesktopShell } from '../shared/desktopShell.ts';
import { icon } from './icons';

type TauriWin = {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    startDragging(): Promise<void>;
};

type TauriGlobal = {
    window?: { getCurrentWindow(): TauriWin };
    core?: { invoke(cmd: string): Promise<unknown> };
};

function tauriInvoke(cmd: string): Promise<unknown> | null {
    const w = window as Window & { __TAURI__?: TauriGlobal; __TAURI_INTERNALS__?: { invoke(cmd: string): Promise<unknown> } };
    const inv = w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke;
    return inv ? inv(cmd) : null;
}

function currentWin(): TauriWin | null {
    const api = (window as Window & { __TAURI__?: TauriGlobal }).__TAURI__?.window;
    if (api?.getCurrentWindow) return api.getCurrentWindow();
    const via = (cmd: string) => () => (tauriInvoke(`plugin:window|${cmd}`) ?? Promise.resolve()).then(() => undefined);
    return { minimize: via('minimize'), toggleMaximize: via('toggle_maximize'), close: via('close'), startDragging: via('start_dragging') };
}

const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], iframe, [data-no-drag]';

export function installTitlebar(): void {
    if (!isDesktopShell()) return;
    const win = currentWin();
    if (!win) return;

    // startDragging 会进入系统模态拖窗循环，把 dblclick 吞掉——双击要靠 mousedown 的 detail===2 判。
    // dblclick 仍作兜底；两路可能都触发，用时间戳去重防「最大化又还原」。
    let lastToggle = 0;
    const toggle = (): void => {
        const now = Date.now();
        if (now - lastToggle < 500) return;
        lastToggle = now;
        void win.toggleMaximize();
    };

    for (const sel of ['#sidebar-head', '#page-head']) {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) continue;
        el.classList.add('drag-region');
        el.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest(INTERACTIVE)) return;
            if (e.detail === 2) { toggle(); return; }
            if (e.detail > 2) return;
            void win.startDragging();
        });
        el.addEventListener('dblclick', (e) => {
            if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
            toggle();
        });
    }

    const head = document.querySelector<HTMLElement>('#page-head');
    if (!head || head.querySelector('#win-controls')) return;
    const box = document.createElement('span');
    box.id = 'win-controls';
    const mk = (name: string, tip: string, fn: () => Promise<void>): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-btn';
        b.dataset.tip = tip;
        b.innerHTML = icon(name);
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            void fn();
        });
        return b;
    };
    const closeBtn = mk('x', '关闭', () => win.close());
    closeBtn.classList.add('win-close');
    box.append(
        mk('minus', '最小化', () => win.minimize()),
        mk('square', '最大化 / 还原', () => win.toggleMaximize()),
        closeBtn,
    );
    head.append(box);
}
