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

/// 开屏页：内嵌 data: URL，不进 pak 不走网络，webview 一就绪就能画。
/// 白底 + 转圈 + 字样，盖住服务端拉起（node/pkg exe ~0.1–1.5s）这段真空期。
#[cfg(not(debug_assertions))]
fn splash_url() -> tauri::Url {
    const HTML: &str = concat!(
        "<!DOCTYPE html><meta charset=utf-8>",
        "<body style='margin:0;height:100vh;display:flex;flex-direction:column;gap:14px;",
        "align-items:center;justify-content:center;background:#fff'>",
        "<div style='width:20px;height:20px;border:2.5px solid #e4e4e4;",
        "border-top-color:#8a8a8a;border-radius:50%;animation:s .7s linear infinite'></div>",
        "<div style='font:12px/1 system-ui;color:#9a9a9a;letter-spacing:4px'>米素 folio</div>",
        "<style>@keyframes s{to{transform:rotate(360deg)}}</style>",
    );
    let mut enc = String::with_capacity(HTML.len() * 3);
    for &b in HTML.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                enc.push(b as char)
            }
            _ => enc.push_str(&format!("%{b:02X}")),
        }
    }
    tauri::Url::parse(&format!("data:text/html;charset=utf-8,{enc}")).unwrap()
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
    // epoch 也落账：进程创建时刻（WMI）对得上它时，差值就是 OS/杀软的 pre-main 耗时
    stamp(&format!("main enter @{}", BOOT_EPOCH_MS.get().copied().unwrap_or_default()));

    let prevent = PreventDefaultBuilder::new()
        .with_flags(Flags::CONTEXT_MENU)
        .platform(PlatformOptions::new().default_context_menus(false))
        .build();

    let server = ServerProc(Mutex::new(None));

    tauri::Builder::default()
        .plugin(prevent)
        .manage(server)
        .setup(|app| {
            let Some(win) = app.get_webview_window("main") else {
                return Ok(());
            };
            // 开屏页先行盖掉白屏；服务端启动挪后台线程，
            // WebView2 初始化 / 开屏渲染 / node 拉起三线并行，setup 即刻返回。
            // 服务就绪后统一 navigate 到真页面——避免抢跑撞上「连接被拒」错误页。
            // __FOLIO_DESKTOP__ 由 VITE_FOLIO_DESKTOP 构建标记覆盖，这里不再补 eval。
            #[cfg(not(debug_assertions))]
            {
                stamp("setup enter");
                let _ = win.navigate(splash_url());
                stamp("splash nav issued");
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    stamp("boot thread start");
                    let boot = match data_dir() {
                        Ok(data) => {
                            let state = handle.state::<ServerProc>();
                            start_api(&data, state.inner()).map_err(|e| (e, Some(data)))
                        }
                        Err(e) => Err((e, None)),
                    };
                    match boot {
                        Ok(()) => {
                            if let Some(w) = handle.get_webview_window("main") {
                                let _ = w.navigate(app_url("http://127.0.0.1:3790"));
                                stamp("app nav issued");
                            }
                        }
                        Err((e, data)) => {
                            stamp(&format!("boot fail: {e}"));
                            let _ = boot_fail(data.as_deref(), e);
                            handle.exit(1);
                        }
                    }
                });
            }
            #[cfg(debug_assertions)]
            let _ = win.navigate(app_url("http://127.0.0.1:5174"));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build tauri")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit) {
                if let Some(state) = app.try_state::<ServerProc>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
