//! Persisted user settings.
//!
//! Right now this holds one thing: which browser, if any, the app may borrow
//! cookies from. That is deliberately a stored setting rather than an
//! environment variable — the previous design required editing a .env file,
//! which meant the feature effectively did not exist for anyone who had not
//! read the source.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;

/// Browser names yt-dlp actually knows how to read cookies from. Validating
/// against this list means a bad value surfaces as "no cookies" rather than
/// as a yt-dlp usage error on every single call.
pub const KNOWN_BROWSERS: [&str; 8] = [
    "brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct Settings {
    /// Browser to take cookies from, e.g. "firefox" or "chrome:Default".
    /// `None` means the app never touches any cookie store.
    pub cookies_from: Option<String>,
}

impl Settings {
    /// Drops a cookie source that isn't a browser yt-dlp supports, so a
    /// hand-edited settings file cannot break every request.
    fn sanitized(mut self) -> Self {
        self.cookies_from = self.cookies_from.and_then(|raw| normalize_browser(&raw));
        self
    }
}

/// Accepts "firefox", "Firefox", "chrome:Default" — anything whose browser
/// part is a name yt-dlp knows. Returns the value in the form yt-dlp wants,
/// preserving any `:profile` suffix.
pub fn normalize_browser(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let name = trimmed
        .split(':')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_lowercase();
    if !KNOWN_BROWSERS.contains(&name.as_str()) {
        return None;
    }
    // Lower-case the browser part but keep the profile exactly as typed —
    // profile directory names are case-sensitive on Linux.
    match trimmed.split_once(':') {
        Some((_, profile)) if !profile.is_empty() => Some(format!("{name}:{profile}")),
        _ => Some(name),
    }
}

static CACHE: RwLock<Option<Settings>> = RwLock::new(None);
static PATH: RwLock<Option<PathBuf>> = RwLock::new(None);

/// Points the module at the app's config directory and loads what is there.
pub fn init(config_dir: Option<PathBuf>) {
    let file = config_dir.map(|d| d.join("settings.json"));

    let loaded = file
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
        .unwrap_or_default()
        .sanitized();

    *PATH.write().unwrap() = file;
    *CACHE.write().unwrap() = Some(loaded);
}

pub fn get() -> Settings {
    CACHE
        .read()
        .unwrap()
        .clone()
        .unwrap_or_default()
}

/// Stores settings and writes them to disk. A write failure is reported
/// rather than swallowed: silently forgetting a preference the user just set
/// is worse than telling them it did not stick.
pub fn save(next: Settings) -> Result<Settings, String> {
    let next = next.sanitized();
    *CACHE.write().unwrap() = Some(next.clone());

    let path = PATH.read().unwrap().clone();
    if let Some(path) = path {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Could not create the settings folder: {e}"))?;
        }
        let body = serde_json::to_string_pretty(&next)
            .map_err(|e| format!("Could not encode settings: {e}"))?;
        std::fs::write(&path, body)
            .map_err(|e| format!("Could not save settings: {e}"))?;
    }
    Ok(next)
}

/// The browser to pass to `--cookies-from-browser`, if the user picked one.
///
/// The environment variable is still honoured and still wins, so an existing
/// .env setup keeps working and a temporary override stays possible.
pub fn cookie_browser() -> Option<String> {
    if let Ok(raw) = std::env::var("YT2MP_COOKIES_FROM") {
        if let Some(name) = normalize_browser(&raw) {
            return Some(name);
        }
    }
    get().cookies_from
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_accepts_known_browsers_only() {
        assert_eq!(normalize_browser("firefox").as_deref(), Some("firefox"));
        assert_eq!(normalize_browser("  Edge  ").as_deref(), Some("edge"));
        assert_eq!(normalize_browser("netscape"), None);
        assert_eq!(normalize_browser(""), None);
        assert_eq!(normalize_browser("   "), None);
    }

    #[test]
    fn normalize_keeps_profile_suffix_verbatim() {
        // The profile is a directory name and is case-sensitive on Linux, so
        // only the browser part may be lower-cased.
        assert_eq!(
            normalize_browser("Chrome:Profile 2").as_deref(),
            Some("chrome:Profile 2")
        );
        // A trailing colon carries no profile and should collapse to the name.
        assert_eq!(normalize_browser("firefox:").as_deref(), Some("firefox"));
    }

    /// Firefox forks are addressed as `firefox:<absolute path>`, and on
    /// Windows that path contains its own colon ("C:\..."). Splitting on the
    /// wrong colon would corrupt every fork profile into an unusable value.
    #[test]
    fn windows_profile_paths_survive_normalization() {
        let raw = r"firefox:C:\Users\a\AppData\Roaming\zen\Profiles\x.Default";
        assert_eq!(
            normalize_browser(raw).as_deref(),
            Some(r"firefox:C:\Users\a\AppData\Roaming\zen\Profiles\x.Default"),
            "the drive letter's colon must not be treated as the separator"
        );
    }

    /// Chromium forks (Opera GX, Arc) are addressed the same way.
    #[test]
    fn chromium_fork_paths_are_accepted() {
        let raw = r"chrome:C:\Users\a\AppData\Roaming\Opera Software\Opera GX Stable";
        assert!(normalize_browser(raw).is_some());
    }

    #[test]
    fn sanitizing_drops_an_unknown_browser() {
        let s = Settings {
            cookies_from: Some("internet-explorer".into()),
        }
        .sanitized();
        assert_eq!(s.cookies_from, None, "a bad stored value must not persist");
    }

    #[test]
    fn default_settings_share_no_cookies() {
        assert_eq!(Settings::default().cookies_from, None);
    }
}
