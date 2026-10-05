#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use flate2::read::GzDecoder;
use tauri::{Manager, RunEvent};
use tauri_plugin_prevent_default::{Builder as PreventDefaultBuilder, Flags, PlatformOptions};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// 拉起的服务端是控制台程序（pkg exe 或 node）；静默拉起，不带黑窗。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 单文件 portable：scripts/desktop-pack-runtime.mjs 把服务端 + 整个 dist/
/// 打成包内嵌，数据段 gzip，启动时解到 exe 旁 folio-data/runtime/<version>/。
/// 两种包形态（打包脚本 --lite 决定）：完整版含 folio-server.exe（pkg Node），
/// lite 版只有 folio-server.cjs（spawn 用户本机的 node）。
/// 格式：[u32 LE manifest 长度][manifest JSON: {version, files:[{path,offset,len}]}][gzip 数据块]
const RUNTIME_PAK: &[u8] = include_bytes!("../resources/runtime.pak");

#[cfg(not(debug_assertions))]
const _: () = assert!(
    RUNTIME_PAK.len() > 4,
    "runtime.pak 是占位空包：先跑 scripts/desktop-build.mjs 再 cargo build"
);

const PORT: u16 = 3790;

/// 启动计时账：T0 = main 进来那刻；每步写一行到 boot-log.txt。
/// server 侧用 FOLIO_BOOT_T0（epoch ms）对齐同一时间轴。
static BOOT_T0: OnceLock<Instant> = OnceLock::new();
static BOOT_EPOCH_MS: OnceLock<u128> = OnceLock::new();
static BOOT_LOG: OnceLock<PathBuf> = OnceLock::new();
/// 数据目录（exe 旁 folio-data），boot 线程解析后存这里给看门狗用。
static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

fn boot_log_path() -> PathBuf {
    if let Some(p) = BOOT_LOG.get() {
        return p.clone();
    }
    exe_dir()
        .map(|d| d.join("folio-data").join("boot-log.txt"))
        .unwrap_or_else(|_| std::env::temp_dir().join("mimi-folio-boot-log.txt"))
}

fn stamp(tag: &str) {
    let Some(t0) = BOOT_T0.get() else { return };
    let path = boot_log_path();
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{:>7}ms [shell] {tag}", t0.elapsed().as_millis());
    }
}

struct ServerProc(Mutex<Option<Child>>);

#[derive(serde::Deserialize)]
struct PakManifest {
    version: String,
    files: Vec<PakFile>,
}

#[derive(serde::Deserialize)]
struct PakFile {
    path: String,
    offset: usize,
    len: usize,
}

fn wait_api(port: u16) {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + Duration::from_secs(45);
    while Instant::now() < deadline {
        // 必须 connect_timeout：这台机器对关着端口的 SYN 不回 RST（有过滤软件），
        // 裸 connect 每次干等 ~2s 重传超时才失败，轮询会被拖死。
        if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(30));
    }
}

fn exe_dir() -> Result<PathBuf, String> {
    // 不能走 tauri path().executable_dir()：底层 dirs 6 的 Windows 实现恒返回 None。
    std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "exe 无上级目录".to_string())
}

/// portable：数据落 exe 旁 folio-data/；写不进（如被挪进 Program Files）退到 %LOCALAPPDATA%。
fn data_dir() -> Result<PathBuf, String> {
    let mut dir = exe_dir()?.join("folio-data");
    if fs::create_dir_all(&dir).is_err() {
        let local =
            std::env::var_os("LOCALAPPDATA").ok_or("exe 旁目录不可写，且无 LOCALAPPDATA")?;
        dir = PathBuf::from(local).join("MimiFolio").join("folio-data");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(dir.join("vault")).map_err(|e| e.to_string())?;
    let _ = BOOT_LOG.set(dir.join("boot-log.txt"));
    Ok(dir)
}

fn silent(cmd: &mut Command) -> &mut Command {
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 要读输出的辅助命令（netstat / powershell / taskkill 查询类）：
/// 只免黑窗，stdout 留给 .output() 捕获——套 silent 会把输出掐没。
fn no_window(cmd: &mut Command) -> &mut Command {
    cmd.stdin(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 双击关联文件启动：第一个非旗标、磁盘上存在的参数当成要打开的文件路径。
fn open_file_arg() -> Option<String> {
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') || arg.starts_with('/') {
            continue;
        }
        if Path::new(&arg).is_file() {
            return Some(arg);
        }
    }
    None
}

/// 上个实例被强杀/崩溃后，它的 msedgewebview2 浏览器进程会变孤儿、继续持有
/// 本应用的 user-data 目录；新实例建 webview 要等 WV2 把它清场（实测 17-53s）。
/// 启动时把「父进程已死」的浏览器根进程收掉；父进程活着说明另一实例在跑，
/// 共享同一 UDF，不许碰。
#[cfg(windows)]
fn reap_orphan_webviews() {
    // 快路径：Toolhelp 快照找「父进程已死」的 webview 进程（<1ms），
    // 没有嫌疑就直接返回——不起 PowerShell。
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    let t = Instant::now();
    let suspects: Vec<u32> = unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return;
        };
        let mut e = PROCESSENTRY32W::default();
        e.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut out = Vec::new();
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                let end = e
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(e.szExeFile.len());
                if String::from_utf16_lossy(&e.szExeFile[..end])
                    .eq_ignore_ascii_case("msedgewebview2.exe")
                    && e.th32ParentProcessID != 0
                    && OpenProcess(
                        PROCESS_QUERY_LIMITED_INFORMATION,
                        false,
                        e.th32ParentProcessID,
                    )
                    .map(|h| {
                        let _ = CloseHandle(h);
                    })
                    .is_err()
                {
                    out.push(e.th32ProcessID);
                }
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
        out
    };

    if suspects.is_empty() {
        stamp(&format!("wv2 orphan sweep {}ms clean", t.elapsed().as_millis()));
        return;
    }

    let udf = match std::env::var("LOCALAPPDATA") {
        Ok(d) => format!("{d}\\com.mimi.folio.desktop\\EBWebView"),
        Err(_) => return,
    };
    let pids = suspects
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let ps = format!(
        "$udf='{udf}'
foreach ($p in {pids}) {{
  $c = (Get-CimInstance Win32_Process -Filter \"ProcessId=$p\").CommandLine
  if ($c -like \"*$udf*\") {{
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    \"reaped $p\"
  }}
}}",
        udf = udf.replace('\'', "''")
    );
    match no_window(Command::new("powershell").args(["-NoProfile", "-Command", &ps])).output() {
        Ok(o) => {
            let out = String::from_utf8_lossy(&o.stdout).trim().replace('\n', " ");
            stamp(&format!(
                "wv2 orphan sweep {}ms {}",
                t.elapsed().as_millis(),
                if out.is_empty() {
                    "suspects not ours"
                } else {
                    out.as_str()
                }
            ));
        }
        Err(e) => stamp(&format!("wv2 orphan sweep failed: {e}")),
    }
}

/// 同目录多实例共用 3790 上一个 server：后开实例只「reuse」不持有子进程，
/// 先开的退出时 child.kill() 会带走 server，留下的窗口所有 API 全挂
/// （"列目录失败：Failed to fetch" / 搜索假「没有命中」的根因）。
/// 同一数据目录只许一个实例；second launch 聚焦已有窗口后退。
/// mutex 按数据目录 hash 命名：不同安装目录（多份便携包）互不影响。
#[cfg(windows)]
fn data_dir_tag() -> String {
    let dir = exe_dir()
        .map(|d| d.join("folio-data").to_string_lossy().to_lowercase().replace('/', "\\"))
        .unwrap_or_default();
    // FNV-1a 64：不需要密码学强度，只要稳定。
    let mut h: u64 = 0xcbf29ce484222325;
    for b in dir.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

#[cfg(windows)]
fn claim_single_instance() -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS};
    use windows::Win32::System::Threading::CreateMutexW;
    let name: Vec<u16> = format!("Local\\mimi-folio-{}", data_dir_tag())
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        match CreateMutexW(None, true, PCWSTR(name.as_ptr())) {
            Ok(h) if GetLastError() != ERROR_ALREADY_EXISTS => {
                let _ = h; // HANDLE 无 Drop：不关句柄 = mutex 持有到进程退出，OS 自动释放
                true
            }
            Ok(h) => {
                let _ = CloseHandle(h);
                false
            }
            Err(_) => true, // mutex 不可用不挡启动
        }
    }
}

/// 把已在跑的实例窗口拉到前台：只认「标题 米素* + 进程 exe 在我们目录下」的顶层窗口。
#[cfg(windows)]
fn focus_running_instance() {
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
        SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    struct Ctx {
        our_dir: String,
        hit: Option<HWND>,
    }
    unsafe extern "system" fn cb(hwnd: HWND, lp: LPARAM) -> windows::core::BOOL {
        let ctx = &mut *(lp.0 as *mut Ctx);
        let mut buf = [0u16; 64];
        let n = GetWindowTextW(hwnd, &mut buf);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        if !title.starts_with("米素") || !IsWindowVisible(hwnd).as_bool() {
            return true.into();
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == std::process::id() {
            return true.into();
        }
        let ours = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
            .map(|h| {
                let mut name = [0u16; 512];
                let mut len = name.len() as u32;
                let img = QueryFullProcessImageNameW(
                    h,
                    PROCESS_NAME_WIN32,
                    windows::core::PWSTR(name.as_mut_ptr()),
                    &mut len,
                )
                .map(|()| String::from_utf16_lossy(&name[..len as usize]).to_lowercase())
                .unwrap_or_default();
                let _ = CloseHandle(h);
                img.starts_with(&ctx.our_dir)
            })
            .unwrap_or(false);
        if ours {
            ctx.hit = Some(hwnd);
            return false.into();
        }
        true.into()
    }

    let our_dir = exe_dir()
        .map(|d| d.to_string_lossy().to_lowercase().replace('/', "\\"))
        .unwrap_or_default();
    let mut ctx = Ctx { our_dir: format!("{}\\", our_dir.trim_end_matches('\\')), hit: None };
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&mut ctx as *mut Ctx as isize));
        if let Some(hwnd) = ctx.hit {
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

/// 二次启动（双击/拖到图标）带着文件参数：POST 给在跑的 server 进待开队列，
/// 页面轮询 pending-open 弹出后链入并打开。服务可能还在启动中 → 重试几轮。
#[cfg(all(windows, not(debug_assertions)))]
fn request_open_via_api(path: &str) {
    let body = serde_json::json!({ "path": path }).to_string();
    let req = format!(
        "POST /folio/v1/request-open HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], PORT));
    for _ in 0..10 {
        if let Ok(mut s) = std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(300)) {
            let _ = s.set_write_timeout(Some(Duration::from_secs(2)));
            let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
            if s.write_all(req.as_bytes()).is_ok() {
                let mut buf = [0u8; 256];
                let _ = s.read(&mut buf);
                return;
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    stamp("request-open post failed: api unreachable");
}

/// 看门狗：server 被杀/崩而窗口还活着时 2s 内重拉。start_api 内部先
/// netstat 复查再决定 spawn/reuse，两个实例竞速也只会赢一个。
#[cfg(not(debug_assertions))]
fn spawn_api_watchdog(data: PathBuf, server: std::sync::Arc<ServerProc>) {
    std::thread::spawn(move || {
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], PORT));
        loop {
            std::thread::sleep(Duration::from_secs(2));
            if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
                continue;
            }
            stamp("api watchdog: port dead, respawn");
            if let Err(e) = start_api(&data, &server) {
                stamp(&format!("api watchdog respawn failed: {e}"));
            }
        }
    });
}

fn parse_pak() -> Result<(PakManifest, usize), String> {
    if RUNTIME_PAK.len() < 4 {
        return Err("runtime.pak 为空或损坏".into());
    }
    let mlen = u32::from_le_bytes(RUNTIME_PAK[..4].try_into().unwrap()) as usize;
    let blob_start = 4 + mlen;
    if RUNTIME_PAK.len() < blob_start {
        return Err("runtime.pak manifest 越界".into());
    }
    let manifest: PakManifest =
        serde_json::from_slice(&RUNTIME_PAK[4..blob_start]).map_err(|e| e.to_string())?;
    Ok((manifest, blob_start))
}

/// 内嵌运行包解到 folio-data/runtime/<version>/，已解过则跳过并清掉旧版本目录。
/// 版本目录隔离：旧 server 还占着旧文件也不挡新包落盘。返回该版本目录。
fn ensure_runtime(data: &Path) -> Result<PathBuf, String> {
    let (manifest, blob_start) = parse_pak()?;
    let rt_root = data.join("runtime");
    let rt = rt_root.join(&manifest.version);
    let ok_mark = rt.join(".ok");
    if ok_mark.is_file() {
        return Ok(rt);
    }

    // 整个 gzip 数据段一次解压，再按 manifest 的 offset/len 切片落盘。
    let packed = RUNTIME_PAK
        .get(blob_start..)
        .ok_or("runtime.pak 数据段缺失")?;
    let mut blob = Vec::new();
    GzDecoder::new(packed)
        .read_to_end(&mut blob)
        .map_err(|e| format!("runtime.pak 解压失败：{e}"))?;
    stamp(&format!("pak decompressed {}B", blob.len()));

    let _ = fs::remove_dir_all(&rt);
    // 先校验全部路径，再多线程落盘——766 个小文件单线程写要 ~3s。
    for f in &manifest.files {
        let rel = Path::new(&f.path);
        if rel
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
        {
            return Err(format!("runtime.pak 含非法路径 {}", f.path));
        }
        if blob.get(f.offset..f.offset + f.len).is_none() {
            return Err(format!("runtime.pak 数据越界：{}", f.path));
        }
    }
    let blob = &blob;
    let rt_ref = &rt;
    std::thread::scope(|s| -> Result<(), String> {
        let n = manifest.files.len().div_ceil(8).max(1);
        let mut handles = Vec::new();
        for chunk in manifest.files.chunks(n) {
            handles.push(s.spawn(move || -> Result<(), String> {
                for f in chunk {
                    let dst = rt_ref.join(&f.path);
                    if let Some(parent) = dst.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    fs::write(&dst, &blob[f.offset..f.offset + f.len])
                        .map_err(|e| format!("解包 {} 失败：{e}", f.path))?;
                }
                Ok(())
            }));
        }
        for h in handles {
            h.join().map_err(|_| "解包线程 panic".to_string())??;
        }
        Ok(())
    })?;
    fs::write(&ok_mark, &manifest.version).map_err(|e| e.to_string())?;

    // 顺手清掉旧版本目录和历史遗留的平铺布局（旧版 runtime/ 直接装文件）
    if let Ok(entries) = fs::read_dir(&rt_root) {
        for entry in entries.flatten() {
            if entry.path() != rt {
                let _ = fs::remove_dir_all(entry.path());
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(rt)
}

/// 3790 谁在监听（返回 PID，None=空闲）。读 netstat 本地表而非 connect 探测——
/// connect 在 SYN 被过滤的环境会重传 ~2s 才超时，启动链上每探一次白等一次。
fn listening_pid() -> Result<Option<String>, String> {
    let out = no_window(Command::new("netstat").args(["-ano", "-p", "tcp"]))
        .output()
        .map_err(|e| format!("netstat 失败：{e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text
        .lines()
        .find(|l| l.contains(&format!(":{PORT} ")) && l.contains("LISTENING"))
        .and_then(|l| l.split_whitespace().last().map(str::to_string)))
}

/// 问 3790 上在跑的服务自报版本（响应头 X-Folio-Build）。
/// None = 没报版本（旧包的服务端或外来服务）。只在确认有监听后调用。
fn running_build() -> Option<String> {
    let mut s = std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], PORT)),
        Duration::from_secs(3),
    )
    .ok()?;
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(3)));
    s.write_all(b"GET / HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .ok()?;
    let mut buf = Vec::new();
    s.take(64 * 1024).read_to_end(&mut buf).ok()?;
    String::from_utf8_lossy(&buf)
        .to_lowercase()
        .lines()
        .find_map(|l| l.strip_prefix("x-folio-build:").map(str::trim).map(str::to_string))
}

/// 端口上跑的是版本不一致的米素服务（换包后旧 server 残留会喂旧 dist）：
/// 确认命令行是 folio-server 再杀——外来服务不碰，直接报错。
fn kill_stale_server(pid: &str) -> Result<(), String> {
    let cmdline = no_window(Command::new("powershell").args([
        "-NoProfile",
        "-Command",
        &format!("(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine"),
    ]))
    .output()
    .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase())
    .unwrap_or_default();

    if !cmdline.contains("folio-server") {
        return Err(format!(
            "端口 {PORT} 被非米素进程占用（PID {pid}），请释放端口后重试"
        ));
    }
    let _ = silent(Command::new("taskkill").args(["/f", "/pid", &pid])).status();
    Ok(())
}

fn start_api(data: &Path, child_state: &ServerProc) -> Result<(), String> {
    let (manifest, _) = parse_pak()?;
    let embedded = manifest.version.clone();
    stamp("pak parsed");

    // 端口活着：版本一致才复用；不一致（或老版本不报头）确认是自家旧 server 后杀掉重启
    if let Some(pid) = listening_pid()? {
        stamp(&format!("port occupied pid={pid}"));
        if running_build().as_deref() == Some(embedded.as_str()) {
            stamp("reuse running server");
            return Ok(());
        }
        stamp("stale server on port, kill");
        kill_stale_server(&pid)?;
    }
    stamp("port check done");

    let rt = ensure_runtime(data)?;
    stamp("runtime ready");
    let server_exe = rt.join("folio-server.exe");
    let bundled = server_exe.is_file();
    let mut cmd = if bundled {
        Command::new(&server_exe)
    } else {
        // lite 包：服务端是 cjs，跑用户本机的 node
        let js = rt.join("folio-server.cjs");
        let mut c = Command::new("node");
        c.arg(js);
        c
    };
    let child = silent(&mut cmd)
        .env("PORT", PORT.to_string())
        .env("FOLIO_BUILD", &embedded)
        .env("FOLIO_DIST", rt.join("dist.pak"))
        .env("FOLIO_VAULT", data.join("vault"))
        .env("FOLIO_WORKSPACES", data.join("workspaces.json"))
        // 主程序路径给 server：设置 .md 默认打开方式时拿它写注册表 open command
        .env("FOLIO_APP_EXE", std::env::current_exe().unwrap_or_default())
        // 启动计时账：server 侧时间与壳对齐
        .env("FOLIO_BOOTLOG", data.join("boot-log.txt"))
        .env(
            "FOLIO_BOOT_T0",
            BOOT_EPOCH_MS.get().copied().unwrap_or_default().to_string(),
        )
        .spawn()
        .map_err(|e| {
            if bundled {
                format!("启动 folio API 失败：{e}")
            } else {
                format!("未找到本机 Node.js（lite 版需要 Node ≥ 20，见 https://nodejs.org）：{e}")
            }
        })?;

    *child_state.0.lock().unwrap() = Some(child);
    stamp("server spawned");
    wait_api(PORT);
    stamp("api listening");
    Ok(())
}

/// 首页地址；双击关联文件启动时把绝对路径编进 ?open= 传给页面。
fn app_url(base: &str) -> tauri::Url {
    let mut url = tauri::Url::parse(base).unwrap();
    if let Some(file) = open_file_arg() {
        url.query_pairs_mut().append_pair("open", &file);
    }
    url
}

/// 开屏页 HTML，注入 about:blank 自绘。不走 tauri.localhost 自定义协议：
/// WV2 冷环境/版本迁移时首个协议导航偶发失败→「无法显示此页面」错误页，
/// about:blank 永不失败，初始化脚本在 DOMContentLoaded 注入开屏 DOM。
#[cfg(not(debug_assertions))]
const SPLASH_HTML: &str = include_str!("../../stub-frontend/index.html");

#[cfg(not(debug_assertions))]
fn splash_init_js() -> String {
    let esc = SPLASH_HTML
        .replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace("${", "\\${");
    format!(
        "if(location.href==='about:blank'){{\
           const w=()=>{{document.open();document.write(`{esc}`);document.close()}};\
           document.readyState==='loading'?addEventListener('DOMContentLoaded',w):w();\
         }}"
    )
}

/// 窗口只亮一次：开屏首帧 / 兜底超时 / 导航后备 谁先谁负责。
#[cfg(not(debug_assertions))]
static WINDOW_SHOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(not(debug_assertions))]
fn show_window_once(win: &tauri::WebviewWindow, why: &str) {
    if !WINDOW_SHOWN.swap(true, std::sync::atomic::Ordering::SeqCst) {
        let _ = win.show();
        stamp(&format!("window shown ({why})"));
    }
}

/// 启动失败不留黑盒：写 boot-error.txt 并用系统默认程序打开它。
fn boot_fail(data: Option<&Path>, msg: String) -> String {
    let log = data
        .map(|d| d.join("boot-error.txt"))
        .unwrap_or_else(|| std::env::temp_dir().join("mimi-folio-boot-error.txt"));
    let _ = fs::write(&log, format!("米素启动失败：{msg}\n"));
    let _ = silent(Command::new("cmd").args(["/c", "start", ""]).arg(&log)).spawn();
    msg
}

fn main() {
    let _ = BOOT_T0.set(Instant::now());
    let _ = BOOT_EPOCH_MS.set(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default(),
    );
    // 静默消失盘查：panic 也进 boot-log，不然 Rust panic 只在 stderr（无窗进程看不到）
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let path = boot_log_path();
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
            let ms = BOOT_T0.get().map(|t| t.elapsed().as_millis()).unwrap_or_default();
            let _ = writeln!(f, "{ms:>7}ms [shell] PANIC {info}");
        }
        default_hook(info);
    }));
    // epoch 也落账：进程创建时刻（WMI）对得上它时，差值就是 OS/杀软的 pre-main 耗时
    stamp(&format!("main enter @{}", BOOT_EPOCH_MS.get().copied().unwrap_or_default()));

    // 同一数据目录只开一个实例（原因见 claim_single_instance 注释）。
    // 带着文件参数的二次启动：先把路径递交给在跑的 server（pending-open 队列，
    // 页面轮询消费），再聚焦已有窗退出——文件不再丢。
    #[cfg(all(windows, not(debug_assertions)))]
    if !claim_single_instance() {
        if let Some(file) = open_file_arg() {
            stamp(&format!("second instance forwards open: {file}"));
            request_open_via_api(&file);
        } else {
            stamp("second instance, focus existing");
        }
        focus_running_instance();
        return;
    }

    // 孤儿 webview 清扫必须在 webview 创建前完成（否则 WV2 清场白等 17-50s），
    // 但 WMI 查询本身要 ~1.5s——后台跑，setup 建窗前 join，常态零成本。
    #[cfg(all(windows, not(debug_assertions)))]
    let (sweep_tx, sweep_rx) = std::sync::mpsc::channel::<()>();
    #[cfg(all(windows, not(debug_assertions)))]
    std::thread::spawn(move || {
        reap_orphan_webviews();
        let _ = sweep_tx.send(());
    });

    let prevent = PreventDefaultBuilder::new()
        .with_flags(Flags::CONTEXT_MENU)
        .platform(PlatformOptions::new().default_context_menus(false))
        .build();

    let server = std::sync::Arc::new(ServerProc(Mutex::new(None)));

    // 服务端拉起不依赖窗口，先于 Builder 开跑——与 Tauri/WebView2 初始化并行，
    // 等 webview 能画开屏页时 server 往往已经在监听了。
    #[cfg(not(debug_assertions))]
    let boot = {
        let server = server.clone();
        std::thread::spawn(move || {
            stamp("boot thread start");
            match data_dir() {
                Ok(data) => {
                    let _ = DATA_DIR.set(data.clone());
                    start_api(&data, &server).map_err(|e| (e, Some(data)))
                }
                Err(e) => Err((e, None)),
            }
        })
    };

    tauri::Builder::default()
        .plugin(prevent)
        .manage(server)
        .setup(move |app| {
            // 窗口不进 conf：要挂 on_page_load 钩子（conf 建的窗挂不了）。
            // release：hidden 起手，初始页 = stub-frontend 开屏页（tauri 协议），
            //   开屏 load 完成才 show——WebView2 冷初始化的空白全程不上屏。
            //   服务就绪后统一 navigate 到真页面，避免抢跑「连接被拒」。
            // dev：直接明窗打 devUrl。
            #[cfg(debug_assertions)]
            let win = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(app_url("http://127.0.0.1:5174")),
            )
            .title("米素")
            .inner_size(1280.0, 840.0)
            .decorations(false)
            // 默认的 OS 文件拖入让 wry 注册自己的 IDropTarget，页内 HTML5 拖拽
            // （侧栏拖文件换夹）的 drop 被它吞掉——关掉 handler 才能用 HTML5 DnD。
            .disable_drag_drop_handler()
            .build()?;
            #[cfg(all(windows, not(debug_assertions)))]
            {
                let t = Instant::now();
                let _ = sweep_rx.recv_timeout(Duration::from_secs(10));
                let waited = t.elapsed().as_millis();
                if waited > 50 {
                    stamp(&format!("wv2 sweep waited {waited}ms"));
                }
            }
            #[cfg(not(debug_assertions))]
            stamp("setup begin");
            #[cfg(not(debug_assertions))]
            let win = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(tauri::Url::parse("about:blank").unwrap()),
            )
            .title("米素")
            .inner_size(1280.0, 840.0)
            .decorations(false)
            .visible(false)
            .disable_drag_drop_handler() // 同上：OS 文件拖入没人接，页内拖拽却会被吞
            .initialization_script(&splash_init_js())
            // 纯本地应用不需要网络栈：本机存在流量过滤时，WV2 建 webview 时的
            // 组件更新/CRL/代理探测都会走重传超时（实测偶发 17-20s），全掐掉。
            .additional_browser_args(
                "--no-proxy-server --disable-background-networking \
                 --disable-component-update --disable-sync --disable-metrics \
                 --no-first-run --no-default-browser-check",
            )
            .on_page_load(|w, payload| {
                if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                    // 首个 Finished = 开屏页加载完（DOM 就绪，show 后首帧即开屏）
                    let w = w.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(80));
                        show_window_once(&w, "page loaded");
                    });
                }
            })
            .build()?;
            #[cfg(not(debug_assertions))]
            {
                stamp("window built");
                // about:blank 是初始文档、不产 PageLoadEvent——开屏靠注入脚本就位，
                // 建窗后稍等渲染管线起来即亮窗；on_page_load 与长兜底仍保留。
                let w2 = win.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(400));
                    show_window_once(&w2, "post-build");
                });
                let w3 = win.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(5));
                    show_window_once(&w3, "fallback 5s")
                });

                let w4 = win.clone();
                let handle = app.handle().clone();
                std::thread::spawn(move || match boot.join() {
                    Ok(Ok(())) => {
                        let _ = w4.navigate(app_url("http://127.0.0.1:3790"));
                        stamp("app nav issued");
                        // server 被杀/崩后看门狗重拉——别实例复用的 server 属于别人，
                        // 人家一退这边不陪葬（"Failed to fetch" 窗口的根因修复）。
                        if let Some(data) = DATA_DIR.get() {
                            let srv = handle.state::<std::sync::Arc<ServerProc>>().inner().clone();
                            spawn_api_watchdog(data.clone(), srv);
                        }
                        // 开屏没来得及画就连上服务的情况：导航后兜底亮窗
                        std::thread::sleep(Duration::from_millis(900));
                        show_window_once(&w4, "post-nav fallback");
                    }
                    Ok(Err((e, data))) => {
                        stamp(&format!("boot fail: {e}"));
                        let _ = boot_fail(data.as_deref(), e);
                        handle.exit(1);
                    }
                    Err(_) => {
                        stamp("boot thread panicked");
                        handle.exit(1);
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build tauri")
        .run(|app, event| {
            // 静默消失盘查：关窗/退出请求/退出全落账。
            // CloseRequested+Destroyed = 正常关窗；只有 Destroyed = WV2 侧死窗；
            // ExitRequested 带 code = handle.exit() 或外部请求。
            match event {
                RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { .. }, .. } => {
                    stamp(&format!("window {label} close-requested"));
                }
                RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } => {
                    stamp(&format!("window {label} destroyed"));
                }
                RunEvent::ExitRequested { code, .. } => {
                    stamp(&format!("exit requested code={code:?}"));
                }
                RunEvent::Exit => {
                    stamp("exit");
                    if let Some(state) = app.try_state::<std::sync::Arc<ServerProc>>() {
                        if let Some(mut child) = state.inner().0.lock().unwrap().take() {
                            let _ = child.kill();
                        }
                    }
                }
                _ => {}
            }
        });
}
