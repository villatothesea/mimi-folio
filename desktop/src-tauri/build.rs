use std::fs;
use std::path::Path;

fn main() {
    // runtime.pak 由 scripts/desktop-pack-runtime.mjs 生成、被 main.rs include_bytes! 内嵌。
    // 没跑过打包脚本时补一个占位空包，保证 cargo check / tauri dev 也能编过；
    // release 下空包会撞上 main.rs 的 const assert。
    let pak = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/runtime.pak");
    println!("cargo:rerun-if-changed={}", pak.display());
    if !pak.exists() {
        let manifest = b"{\"version\":\"empty\",\"files\":[]}";
        let mut buf = (manifest.len() as u32).to_le_bytes().to_vec();
        buf.extend_from_slice(manifest);
        fs::write(&pak, buf).expect("write placeholder runtime.pak");
    }
    tauri_build::build()
}
