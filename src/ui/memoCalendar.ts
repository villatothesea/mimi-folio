/**
 * 速记月历：按文件名日期前缀计数。点日筛流，再点取消。不是一天一个日记文件。
 */

export type CalCell = {
    iso: string;
    inMonth: boolean;
    date: number;
    count: number;
};

function isoOf(year: number, month0: number, day: number): string {
    const dt = new Date(year, month0, day);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** 周一为周首。格子含前后月补齐。 */
export function monthCells(year: number, month0: number, counts: Map<string, number>): CalCell[] {
    const first = new Date(year, month0, 1);
    const pad = (first.getDay() + 6) % 7;
    const days = new Date(year, month0 + 1, 0).getDate();
    const cells: CalCell[] = [];
    for (let i = 0; i < pad; i++) {
        const iso = isoOf(year, month0, 1 - pad + i);
        cells.push({ iso, inMonth: false, date: Number(iso.slice(-2)), count: counts.get(iso) ?? 0 });
    }
    for (let d = 1; d <= days; d++) {
        const iso = isoOf(year, month0, d);
        cells.push({ iso, inMonth: true, date: d, count: counts.get(iso) ?? 0 });
    }
    while (cells.length % 7 !== 0) {
        const iso = isoOf(year, month0, days + (cells.length - pad - days) + 1);
        cells.push({ iso, inMonth: false, date: Number(iso.slice(-2)), count: counts.get(iso) ?? 0 });
    }
    return cells;
}

export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;
