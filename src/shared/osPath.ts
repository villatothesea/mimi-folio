/**
 * 把 vault 绝对根和库内 posix 相对路径拼成宿主 OS 路径（Windows 带盘符）。
 * 根是盘符或 UNC 时一律反斜杠，方便往资源管理器地址栏粘。
 */
export function joinOsAbs(root: string, rel = ''): string {
    const trimmed = root.replace(/[\\/]+$/, '');
    const win = /^[A-Za-z]:/.test(trimmed) || trimmed.startsWith('\\\\') || trimmed.includes('\\');
    const sep = win ? '\\' : '/';
    const base = win ? trimmed.replaceAll('/', '\\') : trimmed;
    const rest = rel.replaceAll('\\', '/').split('/').filter(Boolean).join(sep);
    return rest ? `${base}${sep}${rest}` : base;
}
