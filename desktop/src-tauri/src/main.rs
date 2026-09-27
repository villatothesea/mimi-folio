#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

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
    let deadline = Instant::now() + Duration::from_secs(45);
    while Instant::now() < deadline {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
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

    let _ = fs::remove_dir_all(&rt);
    for f in &manifest.files {
        let rel = Path::new(&f.path);
        if rel
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
        {
            return Err(format!("runtime.pak 含非法路径 {}", f.path));
        }
        let dst = rt.join(rel);
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let bytes = blob
            .get(f.offset..f.offset + f.len)
            .ok_or_else(|| format!("runtime.pak 数据越界：{}", f.path))?;
        fs::write(&dst, bytes).map_err(|e| format!("解包 {} 失败：{e}", f.path))?;
    }
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

/// 问 3790 上在跑的服务自报版本（响应头 X-Folio-Build）。
/// None = 没报版本（旧包的服务端或外来服务）。
fn running_build() -> Option<String> {
    let mut s = std::net::TcpStream::connect(("127.0.0.1", PORT)).ok()?;
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
/// 定位 PID、确认命令行是 folio-server 再杀——外来服务不碰，直接报错。
fn kill_stale_server() -> Result<(), String> {
    let out = no_window(Command::new("netstat").args(["-ano", "-p", "tcp"]))
        .output()
        .map_err(|e| format!("netstat 失败：{e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let pid = text
        .lines()
        .find(|l| l.contains(&format!(":{PORT}")) && l.contains("LISTENING"))
        .and_then(|l| l.split_whitespace().last())
        .ok_or_else(|| {
            format!(
                "{PORT} 在监听但定位不到 PID（netstat 状态 {:?}，stdout {} 字节，stderr {} 字节：{:.200}）",
                out.status.code(),
                out.stdout.len(),
                out.stderr.len(),
                String::from_utf8_lossy(&out.stderr),
            )
        })?
        .to_string();

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

    // 端口活着：版本一致才复用；不一致（或老版本不报头）确认是自家旧 server 后杀掉重启
    if std::net::TcpStream::connect(("127.0.0.1", PORT)).is_ok() {
        if running_build().as_deref() == Some(embedded.as_str()) {
            return Ok(());
        }
        kill_stale_server()?;
    }

    let rt = ensure_runtime(data)?;
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
        .env("FOLIO_DIST", rt.join("dist"))
        .env("FOLIO_VAULT", data.join("vault"))
        .env("FOLIO_WORKSPACES", data.join("workspaces.json"))
        // 主程序路径给 server：设置 .md 默认打开方式时拿它写注册表 open command
        .env("FOLIO_APP_EXE", std::env::current_exe().unwrap_or_default())
        .spawn()
        .map_err(|e| {
            if bundled {
                format!("启动 folio API 失败：{e}")
            } else {
                format!("未找到本机 Node.js（lite 版需要 Node ≥ 20，见 https://nodejs.org）：{e}")
            }
        })?;

    *child_state.0.lock().unwrap() = Some(child);
    wait_api(PORT);
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
            // 窗口先停在 about:blank，服务就绪后统一 navigate——避免抢跑撞上「连接被拒」错误页。
            // __FOLIO_DESKTOP__ 由 VITE_FOLIO_DESKTOP 构建标记覆盖，这里不再补 eval。
            #[cfg(not(debug_assertions))]
            {
                let state = app.state::<ServerProc>();
                let boot = match data_dir() {
                    Ok(data) => start_api(&data, state.inner()).map_err(|e| (e, Some(data))),
                    Err(e) => Err((e, None)),
                };
                if let Err((e, data)) = boot {
                    return Err(boot_fail(data.as_deref(), e).into());
                }
                let _ = win.navigate(app_url("http://127.0.0.1:3790"));
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
