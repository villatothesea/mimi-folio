type FolioWin = Window & { __FOLIO_DESKTOP__?: boolean };

/** 桌面壳（Tauri 打包）或带 VITE_FOLIO_DESKTOP 的构建。 */
export function isDesktopShell(): boolean {
    const w = window as FolioWin;
    return import.meta.env.VITE_FOLIO_DESKTOP === '1' || w.__FOLIO_DESKTOP__ === true;
}

/**
 * 打包进桌面壳时：关掉 WebView 自带右键（Rust 侧也会关 AreDefaultContextMenus）。
 * 只 preventDefault，不 stopPropagation，侧栏/编辑区自己的 contextmenu 仍会弹出 .ctx-menu。
 */
export function installDesktopShellGuards(): void {
    if (!isDesktopShell()) return;
    (window as FolioWin).__FOLIO_DESKTOP__ = true;
    document.addEventListener('contextmenu', (event) => event.preventDefault(), { capture: true });
}
