/**
 * 合入口。独立用 StandaloneHost，进米米换 MimiHost。
 * 方法名合入后不许改；加字段只能 optional。
 * 扩 list 筛选 / saveFile 等到对应施工单元再改，不要把计划提前写进这份文件。
 */

export type FolioPath = string;

export type FolioDoc = {
    path: FolioPath;
    markdown: string;
    /** 读时的文件 mtime（ms），写回经 If-Match 做冲突保护（米米建议 2） */
    mtimeMs?: number;
    /** 创建时间（birthtime，ms），中区底栏展示用 */
    ctimeMs?: number;
};

export type FolioListItem = {
    path: FolioPath;
    /** 文件名（含扩展名）。搜索/底栏/目录用。左栏清单同一套。不读 YAML title:。 */
    title: string;
    /** frontmatter tags:（单元 6），无 frontmatter 时为空 */
    tags?: string[];
    /** notes/ 长文、memos/ 速记；其它目录不给 kind */
    kind?: 'note' | 'memo';
    /** links/ 下链入的库外文档（单元 10） */
    linked?: boolean;
    /** frontmatter favorite: true（单元 13） */
    favorite?: boolean;
    /** 搜索命中时的上下文行（单元 13，仅 search 返回） */
    snippet?: string;
    /** 修改时间（ms）；速记流相对时间用 */
    mtimeMs?: number;
    /** 创建时间（birthtime，ms） */
    ctimeMs?: number;
    /** 速记看法卡片流用的全文；list 只给 kind=memo 带上，避免把长文塞进清单 */
    markdown?: string;
    /**
     * 空目录占位：该路径下没有子孙文档时 list 仍给出这一项，侧栏据此画文件夹。
     * 文档项不带此字段。合入后 daemon 同形。
     */
    folder?: true;
};

/** list 的筛选（单元 6）。合入后 daemon 按同样语义扫资产层。 */
export type FolioListOpts = {
    dir?: string;
    tag?: string;
    kind?: 'note' | 'memo';
};

export type FolioImage = {
    /** 写入 markdown 的相对路径，如 attachments/x.png */
    src: string;
};

/** saveFile 与 saveImage 同形：都回 attachments/ 下的相对路径 */
export type FolioAttachment = FolioImage;

/** 搜索命中（单元 13/验收批）：text 为上下文行，start 是命中在 text 里的起点 */
export type FolioSearchItem = FolioListItem & { matches: { text: string; start: number }[] };

export type FolioIndex = {
    outgoing: FolioPath[];
    backlinks: FolioPath[];
};

export type FolioWorkspace = {
    id: string;
    name: string;
    dir: string;
};

export interface FolioHost {
    read(path: FolioPath): Promise<FolioDoc>;
    /** ifMatch 传读时的 mtimeMs：文件已变则 409，不静默覆盖 */
    write(path: FolioPath, markdown: string, ifMatch?: number): Promise<void>;
    list(opts?: FolioListOpts): Promise<FolioListItem[]>;
    saveImage(bytes: Uint8Array, hint: string): Promise<FolioImage>;
    /** 音视频等附件落盘（单元 4）；合入后由 daemon 提供同名能力 */
    saveFile?(bytes: Uint8Array, hint: string): Promise<FolioAttachment>;
    /**
     * 粘贴的网络图片：服务端拉取，落盘 vault/pics/，回相对路径。
     * 合入后 daemon 同名；页面 `if (!host.saveRemoteImage)` 降级（不拦粘贴）。
     */
    saveRemoteImage?(url: string): Promise<FolioImage>;
    /**
     * 库外 md 链入 vault（单元 10）：在 vault/links/ 建指向库外文件的链接，
     * 读写穿透回原文件；**失败抛错，绝不拷贝正文**。合入后 daemon 同名实现。
     */
    linkOutside?(absSource: string): Promise<FolioPath>;
    /** 系统选文件夹窗；取消回 null。合入后由宿主原生对话框提供。 */
    pickFolder?(): Promise<string | null>;
    /** 文件夹整体链入 vault/links/<原名>/，不拷贝。 */
    linkFolder?(absSource: string): Promise<{ dir: FolioPath; count: number }>;
    /** 更换顶层外链文件夹的源路径，vault 槽位名不变。 */
    relinkFolder?(dir: FolioPath, absSource: string): Promise<{ dir: FolioPath; count: number }>;
    /**
     * 建空文件夹（不写占位 md）。删光子文档后目录仍在盘上，list 用 `folder: true` 画出。
     * 合入后 daemon 同名；页面 `if (!host.mkdir)` 降级提示，不暗塞未命名笔记。
     */
    mkdir?(path: FolioPath): Promise<void>;
    /** 文档管理（验收清单 14）；合入后 daemon 同名实现 */
    moveDoc?(from: FolioPath, to: FolioPath): Promise<FolioPath>;
    copyDoc?(from: FolioPath, to: FolioPath): Promise<FolioPath>;
    deleteDoc?(path: FolioPath): Promise<void>;
    /** 全文搜索（单元 13）：标题或正文命中，回清单项 + 上下文行 */
    search?(query: string): Promise<FolioSearchItem[]>;
    index?(path: FolioPath): Promise<FolioIndex>;
    /** 网页预览看法的 iframe src（单元：html 不当 md 打开）。合入后 daemon 同路径端文件。 */
    previewUrl?(path: FolioPath): string;
    /** 工作区清单（人翻不同目录；不写进 md）。合入后 daemon 同名。 */
    listWorkspaces?(): Promise<{ items: FolioWorkspace[]; activeId: string }>;
    setWorkspace?(id: string): Promise<void>;
    addWorkspace?(name: string, dir: string): Promise<FolioWorkspace>;
    renameWorkspace?(id: string, name: string): Promise<void>;
    deleteWorkspace?(id: string): Promise<void>;
}

export function detectHostKind(): 'mimi' | 'standalone' {
    if (typeof window !== 'undefined') {
        const w = window as Window & { __MIMI_FOLIO__?: boolean };
        if (w.__MIMI_FOLIO__) return 'mimi';
        if (new URLSearchParams(window.location.search).get('host') === 'mimi') {
            return 'mimi';
        }
    }
    return 'standalone';
}
