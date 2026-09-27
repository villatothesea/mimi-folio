/**
 * 启动计时日志：桌面壳（Rust）与服务端写同一本 boot-log.txt，
 * 用 FOLIO_BOOT_T0（Unix epoch ms，壳进程启动时刻）对齐时间轴。
 * 环境变量没设 = 非桌面壳场景，全部 no-op。
 */
import { appendFile } from 'node:fs';

const log = process.env.FOLIO_BOOTLOG;
const t0 = Number(process.env.FOLIO_BOOT_T0) || Date.now();

export function bootStamp(tag: string): void {
    if (!log) return;
    const ms = Math.max(0, Date.now() - t0);
    appendFile(log, `${String(ms).padStart(7)}ms [server] ${tag}\n`, () => {});
}
