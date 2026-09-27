/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** 桌面打包构建：1 表示进 Tauri WebView，启用壳层右键策略。 */
    readonly VITE_FOLIO_DESKTOP?: string;
}
