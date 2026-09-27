#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};
use tauri_plugin_prevent_default::{Builder as PreventDefaultBuilder, Flags, PlatformOptions};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// pkg 出的 folio-server.exe 是控制台程序；静默拉起，不带黑窗。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 单文件 portable：scripts/desktop-pack-runtime.mjs 把 pkg 出的 folio-server.exe
/// 和整个 dist/ 打成一个包内嵌进来，启动时解到 exe 旁 folio-data/runtime/。
/// 格式：[u32 LE manifest 长度][manifest JSON: {version, files:[{path,offset,len}]}][数据块]
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

/// 内嵌运行包解到 folio-data/runtime/，版本一致则跳过。返回 (server exe, dist 目录)。
fn ensure_runtime(data: &Path) -> Result<(PathBuf, PathBuf), String> {
    let (manifest, blob_start) = parse_pak()?;
    let rt = data.join("runtime");
    let server = rt.join("folio-server.exe");
    let dist = rt.join("dist");
    let stamp = rt.join(".stamp");
    if fs::read_to_string(&stamp).ok().as_deref() == Some(manifest.version.as_str())
        && server.exists()
        && dist.is_dir()
    {
        return Ok((server, dist));
    }

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
        let from = blob_start + f.offset;
        let bytes = RUNTIME_PAK
            .get(from..from + f.len)
            .ok_or_else(|| format!("runtime.pak 数据越界：{}", f.path))?;
        if let Err(e) = fs::write(&dst, bytes) {
            // exe 被残留进程占用时写不进；杀掉重试一次
            let _ =
                silent(Command::new("taskkill").args(["/f", "/im", "folio-server.exe"])).status();
            fs::write(&dst, bytes)
                .map_err(|e2| format!("解包 {} 失败：{e2}（首次：{e}）", f.path))?;
        }
    }
    fs::write(&stamp, &manifest.version).map_err(|e| e.to_string())?;
    Ok((server, dist))
}

fn start_api(data: &Path, child_state: &ServerProc) -> Result<(), String> {
    // 已有实例在跑（或端口被别的服务占着）就直接复用，不再解包/拉进程
    if std::net::TcpStream::connect(("127.0.0.1", PORT)).is_ok() {
        return Ok(());
    }

    let (server, dist) = ensure_runtime(data)?;
    let child = silent(
        Command::new(&server)
            .env("PORT", PORT.to_string())
            .env("FOLIO_DIST", &dist)
            .env("FOLIO_VAULT", data.join("vault"))
            .env("FOLIO_WORKSPACES", data.join("workspaces.json"))
            // 主程序路径给 server：设置 .md 默认打开方式时拿它写注册表 open command
            .env("FOLIO_APP_EXE", std::env::current_exe().unwrap_or_default()),
    )
    .spawn()
    .map_err(|e| format!("启动 folio API 失败：{e}"))?;

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
