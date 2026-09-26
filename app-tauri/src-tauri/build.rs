/// Every command the app registers, listed so that each one needs a
/// permission. Without this list Tauri lets any local page call any app
/// command, and with the built-in browser there are pages in this window that
/// are not the app's. The capability in capabilities/default.json grants them
/// to the app's own webview and to nothing else.
const COMMANDS: &[&str] = &[
    "fetch_info",
    "start_download",
    "download_folder",
    "pick_media_files",
    "probe_files",
    "convert_file",
    "scan_page_quick",
    "scan_page_deep",
    "save_a_copy",
    "file_size",
    "stop_download",
    "reveal_file",
    "get_settings",
    "save_settings",
    "detected_browsers",
    "browser_label",
    "find_working_browser",
    "tools_status",
    "ensure_tools",
    "update_ytdlp",
    "check_ytdlp",
    "app_version",
    "choose_download_dir",
    "forget_download_dir",
    "tab_open",
    "tab_close",
    "tab_show",
    "tab_bounds",
    "tab_navigate",
    "tab_go",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
