//! The browser inside yt2mp. Every open tab is a child webview of the main
//! window, laid over the page area the React UI leaves for it under its own
//! tab strip and toolbar. The strip, the address bar and the history are
//! drawn and kept by the React side; this module only owns the webviews.
//!
//! Three rules hold it together:
//!
//! 1. A closed tab is gone. Its webview is closed, which tears down its
//!    WebView2 controller and lets the renderer process exit, so a tab
//!    that was closed costs no memory afterwards.
//! 2. Browsed sites reach nothing. The tabs are labelled `tab-*`, the app's
//!    capability names only the `main` webview (not the `main` window, which
//!    would cover its children too), and every app command needs a
//!    permission. A page in a tab can call `invoke`, and every call is
//!    refused.
//! 3. One profile. The tabs use the same WebView2 user data folder as the
//!    app itself, so cookies, logins and site storage survive a restart the
//!    way they do in a normal browser, and no second browser process is
//!    started for them.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Runtime, Url,
    WebviewUrl,
};

const PREFIX: &str = "tab-";

/// Where the page area sits in the window, in logical pixels, as the React
/// side last measured it. Every tab is laid out there.
#[derive(Clone, Copy, Default, Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Default)]
pub struct Tabs {
    bounds: Mutex<Bounds>,
}

/// What the tab strip and the toolbar show for a tab.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabState {
    pub id: String,
    pub url: String,
    pub title: String,
    pub loading: bool,
    pub can_back: bool,
    pub can_forward: bool,
}

#[derive(Clone, Serialize)]
struct Popup {
    from: String,
    url: String,
}

#[derive(Clone, Serialize)]
struct Key {
    id: String,
    key: &'static str,
}

#[derive(Clone, Serialize)]
struct Icon {
    id: String,
    icon: Option<String>,
}

/// Tab ids come from the React side and become webview labels, so they are
/// held to a short plain alphabet: nothing that could collide with `main`
/// or with Tauri's own label rules.
fn label(id: &str) -> Result<String, String> {
    let ok = !id.is_empty()
        && id.len() <= 40
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(format!("{PREFIX}{id}"))
    } else {
        Err("That tab id is not valid.".into())
    }
}

/// What a tab may load. The web, local files and blank pages, and never the
/// app's own origins: loading the app's page inside a tab would put the app's
/// code in a webview the capability does not cover, which is harmless today
/// and not something to leave to chance.
fn allowed(url: &Url) -> bool {
    match url.scheme() {
        "https" | "about" | "blob" | "file" => true,
        "http" => {
            let host = url.host_str().unwrap_or("");
            let app_host = matches!(host, "tauri.localhost" | "ipc.localhost" | "asset.localhost");
            // The dev server is the app's origin in a debug build.
            let dev_app = cfg!(debug_assertions) && host == "localhost" && url.port() == Some(5173);
            !app_host && !dev_app
        }
        _ => false,
    }
}

fn parse(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url.trim()).map_err(|_| "That address could not be opened.".to_string())?;
    if allowed(&parsed) {
        Ok(parsed)
    } else {
        Err("That address can't be opened in a tab.".into())
    }
}

fn to_app<R: Runtime, S: Serialize + Clone>(app: &AppHandle<R>, event: &str, payload: S) {
    let _ = app.emit_to(
        EventTarget::Webview {
            label: "main".into(),
        },
        event,
        payload,
    );
}

fn tab_id(label: &str) -> Option<&str> {
    label.strip_prefix(PREFIX)
}

fn supported() -> Result<(), String> {
    if cfg!(windows) {
        Ok(())
    } else {
        Err("The built-in browser is Windows-only for now.".into())
    }
}

#[tauri::command]
pub async fn tab_open<R: Runtime>(
    app: AppHandle<R>,
    tabs: tauri::State<'_, Tabs>,
    id: String,
    url: String,
    show: bool,
) -> Result<(), String> {
    supported()?;
    let label = label(&id)?;
    let url = parse(&url)?;
    if app.get_webview(&label).is_some() {
        return Err("That tab is already open.".into());
    }
    let window = app.get_window("main").ok_or("The window is gone.")?;
    let b = *tabs.bounds.lock().unwrap();

    let popups = app.clone();
    let from = id.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .on_navigation(allowed)
        // window.open, target=_blank and "open in new window" all land here.
        .on_new_window(move |url, features| new_window(&popups, &from, url, features))
        // Ctrl+wheel and Ctrl +/- zoom a page, as in any browser.
        .zoom_hotkeys_enabled(true)
        .focused(show);

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(b.x, b.y),
            LogicalSize::new(b.width.max(1.0), b.height.max(1.0)),
        )
        .map_err(|e| format!("The tab could not be opened: {e}"))?;

    #[cfg(windows)]
    win::attach(&webview, app.clone(), id);

    if show {
        show_only(&app, Some(&label), b, true);
    } else {
        let _ = webview.hide();
    }
    Ok(())
}

/// Where a new window a page asks for goes.
///
/// A link opened in a new window (`target=_blank`, "open in new window", a
/// bare `window.open(url)`) becomes a tab next to the page that opened it: a
/// second native window would sit outside the tab strip where it can't be
/// found again.
///
/// A window the page gives a size to is a popup, and a popup is almost always
/// a sign-in ("Sign in with Google", "Log in with Apple"). Those talk back to
/// the page that opened them and close themselves when done, which only works
/// if they really are its popup. Opened as a tab, the sign-in finishes and the
/// page never hears of it. So a sized window is opened as a small real window,
/// sharing the tab's WebView2 environment (so it has the same cookies) and its
/// opener.
fn new_window<R: Runtime>(
    app: &AppHandle<R>,
    from: &str,
    url: Url,
    features: tauri::webview::NewWindowFeatures,
) -> NewWindowResponse<R> {
    if !allowed(&url) {
        return NewWindowResponse::Deny;
    }
    // A popup that fails to open becomes a tab: better than nothing.
    if features.size().is_some() {
        if let Ok(window) = popup(app, from, &url, features) {
            return NewWindowResponse::Create { window };
        }
    }
    to_app(
        app,
        "tab:popup",
        Popup {
            from: from.to_string(),
            url: url.to_string(),
        },
    );
    NewWindowResponse::Deny
}

static POPUPS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn popup<R: Runtime>(
    app: &AppHandle<R>,
    from: &str,
    url: &Url,
    features: tauri::webview::NewWindowFeatures,
) -> tauri::Result<tauri::WebviewWindow<R>> {
    let n = POPUPS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tabs = app.clone();
    let opener = from.to_string();
    // The label is outside the capability, like a tab's: the popup is a site
    // and reaches no app command.
    tauri::WebviewWindowBuilder::new(app, format!("popup-{n}"), WebviewUrl::External(url.clone()))
        .window_features(features)
        .title(url.host_str().unwrap_or("Sign in"))
        .on_navigation(allowed)
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        // A popup's own links open as tabs beside the page that opened it.
        .on_new_window(move |url, _| {
            if allowed(&url) {
                to_app(
                    &tabs,
                    "tab:popup",
                    Popup {
                        from: opener.clone(),
                        url: url.to_string(),
                    },
                );
            }
            NewWindowResponse::Deny
        })
        .build()
}

#[tauri::command]
pub async fn tab_close<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let label = label(&id)?;
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Shows one tab and hides the rest; `None` hides every tab, for when the
/// app's own screen is in front. `focus` moves the keyboard into the page,
/// which is right when a tab is picked and wrong when the page only comes
/// back from behind the suggestions list while someone is still typing.
#[tauri::command]
pub async fn tab_show<R: Runtime>(
    app: AppHandle<R>,
    tabs: tauri::State<'_, Tabs>,
    id: Option<String>,
    focus: bool,
) -> Result<(), String> {
    let target = id.as_deref().map(label).transpose()?;
    let b = *tabs.bounds.lock().unwrap();
    show_only(&app, target.as_deref(), b, focus);
    Ok(())
}

fn show_only<R: Runtime>(app: &AppHandle<R>, target: Option<&str>, b: Bounds, focus: bool) {
    let all = app.webviews();
    // The new one first, then the old ones away: the other order flashes the
    // app's own screen between the two.
    if let Some(webview) = target.and_then(|t| all.get(t)) {
        let _ = webview.set_position(LogicalPosition::new(b.x, b.y));
        let _ = webview.set_size(LogicalSize::new(b.width.max(1.0), b.height.max(1.0)));
        let _ = webview.show();
        if focus {
            let _ = webview.set_focus();
        }
        #[cfg(windows)]
        win::foreground(webview, true);
    }
    for (label, webview) in &all {
        if tab_id(label).is_some() && Some(label.as_str()) != target {
            let _ = webview.hide();
            #[cfg(windows)]
            win::foreground(webview, false);
        }
    }
}

#[tauri::command]
pub async fn tab_bounds<R: Runtime>(
    app: AppHandle<R>,
    tabs: tauri::State<'_, Tabs>,
    bounds: Bounds,
) -> Result<(), String> {
    *tabs.bounds.lock().unwrap() = bounds;
    for (label, webview) in app.webviews() {
        if tab_id(&label).is_some() {
            let _ = webview.set_position(LogicalPosition::new(bounds.x, bounds.y));
            let _ = webview.set_size(LogicalSize::new(
                bounds.width.max(1.0),
                bounds.height.max(1.0),
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn tab_navigate<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    url: String,
) -> Result<(), String> {
    let label = label(&id)?;
    let url = parse(&url)?;
    let webview = app.get_webview(&label).ok_or("That tab is closed.")?;
    webview.navigate(url).map_err(|e| e.to_string())?;
    // Enter in the address bar hands the keyboard to the page, as browsers do.
    let _ = webview.set_focus();
    Ok(())
}

/// Back, forward, reload and stop.
#[tauri::command]
pub async fn tab_go<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    action: String,
) -> Result<(), String> {
    let label = label(&id)?;
    let webview = app.get_webview(&label).ok_or("That tab is closed.")?;
    match action.as_str() {
        "reload" => webview.reload().map_err(|e| e.to_string()),
        #[cfg(windows)]
        "back" | "forward" | "stop" => {
            win::go(&webview, action);
            Ok(())
        }
        #[cfg(not(windows))]
        "back" => webview.eval("history.back()").map_err(|e| e.to_string()),
        #[cfg(not(windows))]
        "forward" => webview.eval("history.forward()").map_err(|e| e.to_string()),
        #[cfg(not(windows))]
        "stop" => webview.eval("window.stop()").map_err(|e| e.to_string()),
        _ => Err("Unknown action.".into()),
    }
}

/// The WebView2 side: events Tauri doesn't surface (same-document URL
/// changes, history, favicons, keyboard shortcuts) and the memory hint for
/// tabs in the background.
#[cfg(windows)]
mod win {
    use super::{to_app, Icon, Key, TabState};
    use base64::Engine;
    use std::cell::Cell;
    use std::rc::Rc;
    use tauri::{AppHandle, Runtime, Webview};
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::*;
    use windows::core::{Interface, BOOL, PWSTR};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_MENU, VK_SHIFT};

    pub fn attach<R: Runtime>(webview: &Webview<R>, app: AppHandle<R>, id: String) {
        let _ = webview.with_webview(move |platform| unsafe {
            let _ = hook(platform.controller(), app, id);
        });
    }

    pub fn go<R: Runtime>(webview: &Webview<R>, action: String) {
        let _ = webview.with_webview(move |platform| unsafe {
            if let Ok(core) = platform.controller().CoreWebView2() {
                let _ = match action.as_str() {
                    "back" => core.GoBack(),
                    "forward" => core.GoForward(),
                    _ => core.Stop(),
                };
            }
        });
    }

    /// A tab in the background keeps running (music keeps playing), but is
    /// told memory matters more than speed, so WebView2 trims its caches.
    pub fn foreground<R: Runtime>(webview: &Webview<R>, front: bool) {
        let _ = webview.with_webview(move |platform| unsafe {
            let level = if front {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            };
            if let Ok(core) = platform
                .controller()
                .CoreWebView2()
                .and_then(|c| c.cast::<ICoreWebView2_19>())
            {
                let _ = core.SetMemoryUsageTargetLevel(level);
            }
        });
    }

    unsafe fn text(read: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>) -> String {
        let mut raw = PWSTR::null();
        match read(&mut raw) {
            Ok(()) => take_pwstr(raw),
            Err(_) => String::new(),
        }
    }

    unsafe fn flag(read: impl FnOnce(*mut BOOL) -> windows::core::Result<()>) -> bool {
        let mut raw = BOOL::default();
        read(&mut raw).is_ok() && raw.as_bool()
    }

    unsafe fn hook<R: Runtime>(
        controller: ICoreWebView2Controller,
        app: AppHandle<R>,
        id: String,
    ) -> windows::core::Result<()> {
        let core = controller.CoreWebView2()?;
        let loading = Rc::new(Cell::new(true));

        // Every change sends the whole state: the React side then never has
        // to reconcile half-updates arriving in some order.
        let send: Rc<dyn Fn(&ICoreWebView2)> = {
            let app = app.clone();
            let id = id.clone();
            let loading = loading.clone();
            Rc::new(move |core: &ICoreWebView2| {
                let state = TabState {
                    id: id.clone(),
                    url: text(|p| core.Source(p)),
                    title: text(|p| core.DocumentTitle(p)),
                    loading: loading.get(),
                    can_back: flag(|p| core.CanGoBack(p)),
                    can_forward: flag(|p| core.CanGoForward(p)),
                };
                to_app(&app, "tab:state", state);
            })
        };
        let mut token = 0i64;

        {
            let (send, loading) = (send.clone(), loading.clone());
            core.add_NavigationStarting(
                &NavigationStartingEventHandler::create(Box::new(move |sender, _| {
                    loading.set(true);
                    if let Some(core) = sender {
                        send(&core);
                    }
                    Ok(())
                })),
                &mut token,
            )?;
        }
        {
            let (send, loading) = (send.clone(), loading.clone());
            core.add_NavigationCompleted(
                &NavigationCompletedEventHandler::create(Box::new(move |sender, _| {
                    loading.set(false);
                    if let Some(core) = sender {
                        send(&core);
                    }
                    Ok(())
                })),
                &mut token,
            )?;
        }
        // Single-page sites (YouTube among them) change the address without
        // a navigation; these three catch that, the new title, and whether
        // back/forward are possible.
        {
            let send = send.clone();
            core.add_SourceChanged(
                &SourceChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(core) = sender {
                        send(&core);
                    }
                    Ok(())
                })),
                &mut token,
            )?;
        }
        {
            let send = send.clone();
            core.add_HistoryChanged(
                &HistoryChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(core) = sender {
                        send(&core);
                    }
                    Ok(())
                })),
                &mut token,
            )?;
        }
        {
            let send = send.clone();
            core.add_DocumentTitleChanged(
                &DocumentTitleChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(core) = sender {
                        send(&core);
                    }
                    Ok(())
                })),
                &mut token,
            )?;
        }

        // The page's own icon, read from WebView2 as PNG rather than fetched
        // by URL: no request leaves the machine for it.
        if let Ok(core15) = core.cast::<ICoreWebView2_15>() {
            let app = app.clone();
            let id = id.clone();
            core15.add_FaviconChanged(
                &FaviconChangedEventHandler::create(Box::new(move |sender, _| {
                    let Some(core15) = sender.and_then(|c| c.cast::<ICoreWebView2_15>().ok())
                    else {
                        return Ok(());
                    };
                    let (app, id) = (app.clone(), id.clone());
                    let _ = core15.GetFavicon(
                        COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG,
                        &GetFaviconCompletedHandler::create(Box::new(move |result, stream| {
                            let bytes = match (result, stream) {
                                (Ok(()), Some(stream)) => read_all(&stream),
                                _ => Vec::new(),
                            };
                            let icon = (!bytes.is_empty()).then(|| {
                                format!(
                                    "data:image/png;base64,{}",
                                    base64::engine::general_purpose::STANDARD.encode(&bytes)
                                )
                            });
                            to_app(&app, "tab:icon", Icon { id, icon });
                            Ok(())
                        })),
                    );
                    Ok(())
                })),
                &mut token,
            )?;
        }

        // Keys pressed while a page has focus never reach the React side, so
        // the browser's own shortcuts are caught here and passed across.
        {
            let app = app.clone();
            let id = id.clone();
            controller.add_AcceleratorKeyPressed(
                &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                    args.KeyEventKind(&mut kind)?;
                    if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                        && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                    {
                        return Ok(());
                    }
                    let mut vk = 0u32;
                    args.VirtualKey(&mut vk)?;
                    let down = |k: u16| GetKeyState(k as i32) < 0;
                    let key = shortcut(
                        vk,
                        down(VK_CONTROL.0),
                        down(VK_SHIFT.0),
                        down(VK_MENU.0),
                    );
                    if let Some(key) = key {
                        args.SetHandled(true)?;
                        to_app(
                            &app,
                            "tab:key",
                            Key {
                                id: id.clone(),
                                key,
                            },
                        );
                    }
                    Ok(())
                })),
                &mut token,
            )?;
        }

        send(&core);
        Ok(())
    }

    fn shortcut(vk: u32, ctrl: bool, shift: bool, alt: bool) -> Option<&'static str> {
        const TAB: u32 = 0x09;
        const PAGE_UP: u32 = 0x21;
        const PAGE_DOWN: u32 = 0x22;
        const F4: u32 = 0x73;
        const F6: u32 = 0x75;
        let letter = |c: char| vk == c as u32;
        Some(match () {
            _ if ctrl && shift && letter('T') => "reopen",
            _ if ctrl && !shift && letter('T') => "new",
            _ if ctrl && (letter('W') || vk == F4) => "close",
            _ if (ctrl && letter('L')) || (alt && letter('D')) || vk == F6 => "address",
            _ if ctrl && shift && vk == TAB => "prev",
            _ if ctrl && vk == TAB => "next",
            _ if ctrl && vk == PAGE_UP => "prev",
            _ if ctrl && vk == PAGE_DOWN => "next",
            _ => return None,
        })
    }

    unsafe fn read_all(stream: &windows::Win32::System::Com::IStream) -> Vec<u8> {
        let mut out = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            let mut read = 0u32;
            let hr = stream.Read(buf.as_mut_ptr().cast(), buf.len() as u32, Some(&mut read));
            if hr.is_err() || read == 0 {
                break;
            }
            out.extend_from_slice(&buf[..read as usize]);
            // An icon is a few kilobytes; anything past this is not one.
            if out.len() > 512 * 1024 {
                return Vec::new();
            }
        }
        out
    }

    #[cfg(test)]
    mod tests {
        use super::shortcut;

        #[test]
        fn browser_shortcuts_are_recognised() {
            assert_eq!(shortcut('T' as u32, true, false, false), Some("new"));
            assert_eq!(shortcut('T' as u32, true, true, false), Some("reopen"));
            assert_eq!(shortcut('W' as u32, true, false, false), Some("close"));
            assert_eq!(shortcut('L' as u32, true, false, false), Some("address"));
            assert_eq!(shortcut('D' as u32, false, false, true), Some("address"));
            assert_eq!(shortcut(0x09, true, false, false), Some("next"));
            assert_eq!(shortcut(0x09, true, true, false), Some("prev"));
            // Typing, copy and paste stay with the page.
            assert_eq!(shortcut('T' as u32, false, false, false), None);
            assert_eq!(shortcut('C' as u32, true, false, false), None);
            assert_eq!(shortcut('V' as u32, true, false, false), None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tabs_may_not_load_the_app_itself() {
        let ok = |s: &str| allowed(&Url::parse(s).unwrap());
        assert!(ok("https://www.youtube.com/watch?v=x"));
        assert!(ok("http://example.com/"));
        assert!(ok("about:blank"));
        assert!(!ok("http://tauri.localhost/"));
        assert!(!ok("http://ipc.localhost/fetch_info"));
        assert!(!ok("tauri://localhost/"));
        assert!(!ok("javascript:alert(1)"));
        assert!(!ok("ms-settings:privacy"));
    }

    #[test]
    fn tab_ids_stay_plain() {
        assert_eq!(label("a1b2").unwrap(), "tab-a1b2");
        assert!(label("").is_err());
        assert!(label("../main").is_err());
        assert!(label("x y").is_err());
    }
}
