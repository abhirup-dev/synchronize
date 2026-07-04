// Spike (sync-c61.1): prove the Tauri shell can load the daemon-served web UI
// at an external loopback URL (load model A) and that the SPA's live-mode
// detection fires. This is intentionally minimal — the polished shell + daemon
// supervision land in sync-c61.3 / sync-c61.4.

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Resolve the running daemon's base URL from its discovery file.
/// Mirrors `~/.synchronize/daemon.json` (overridable via SYNCHRONIZE_HOME).
fn discover_base_url() -> Option<String> {
    let base_dir = std::env::var("SYNCHRONIZE_HOME")
        .ok()
        .or_else(|| std::env::var("HOME").ok().map(|h| format!("{h}/.synchronize")))?;
    let raw = std::fs::read_to_string(format!("{base_dir}/daemon.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("baseUrl").and_then(|b| b.as_str()).map(str::to_string)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Load model A: point the webview directly at the daemon's /web.
            // The webview's real origin becomes the daemon, so the SPA's
            // live-mode branch (pathname.startsWith("/web")) fires unchanged.
            let target = match discover_base_url() {
                Some(base) => {
                    let url = format!("{}/web", base.trim_end_matches('/'));
                    log::info!("loading daemon web UI: {url}");
                    WebviewUrl::External(url.parse().expect("valid daemon URL"))
                }
                None => {
                    log::warn!("no daemon.json found; showing placeholder");
                    WebviewUrl::App("index.html".into())
                }
            };

            WebviewWindowBuilder::new(app, "main", target)
                .title("Synchronize")
                .inner_size(1100.0, 760.0)
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
