import { detectHostKind } from './types.ts';

/**
 * 米素页存活心跳（仅 mimi 模式）：daemon 由此知道页面开着还是关了，
 * 米米顶栏按钮的高亮/「开着不重开」跟着翻转。
 * - 每 3s POST /folio/v1/presence（同源 Cookie 自动带，daemon 容忍 8s 窗）
 * - 关页 pagehide 发 sendBeacon('/folio/v1/bye')，立刻判关不等超窗
 * 独立模式不起心跳——那边没有按钮要点亮（api.ts 的同名路由是 no-op）。
 * 心跳失败不重连：页面回前台时 fetch 自然恢复；后台被节流的标签靠超窗兜底。
 */
export function startMimiPresence(): void {
    if (detectHostKind() !== 'mimi') return;
    const ping = () => {
        void fetch('/folio/v1/presence', { method: 'POST' }).catch(() => {});
    };
    ping();
    window.setInterval(ping, 3000);
    window.addEventListener('pagehide', () => navigator.sendBeacon('/folio/v1/bye'), {
        capture: true,
    });
}
