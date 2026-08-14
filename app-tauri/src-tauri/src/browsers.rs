//! Finding browsers and picking the one that is actually signed in.
//!
//! yt-dlp knows eight browser names. The real world has more: Zen, LibreWolf,
//! Waterfox and Floorp are Firefox with a different profile directory, and
//! Opera GX, Arc and Thorium are Chromium with a different one. Rather than
//! telling the user their browser is unsupported, each fork is passed to
//! yt-dlp as its base engine plus an explicit profile path — which is exactly
//! what `--cookies-from-browser firefox:/path/to/profile` is for.

use serde::Serialize;
use std::path::PathBuf;

/// A browser installed on this machine.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Browser {
    /// Human name for the UI, e.g. "Zen".
    pub label: String,
    /// The exact `--cookies-from-browser` argument, e.g. `firefox:C:\...`.
    pub arg: String,
    /// Chromium-family browsers lock their cookie DB while running, so the UI
    /// can warn about that specifically.
    pub chromium: bool,
}

/// Engine a browser is built on — decides which yt-dlp name to hand over and
/// where its cookie store lives.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Engine {
    Firefox,
    Chromium,
}

/// One browser we know how to look for: its display name, engine, and the
/// directory to probe, relative to a platform root.
struct Candidate {
    label: &'static str,
    engine: Engine,
    /// yt-dlp's own name for it, when it has one. Forks have none and are
    /// addressed by profile path instead.
    native: Option<&'static str>,
    path: Option<PathBuf>,
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key).map(PathBuf::from)
}

#[cfg(target_os = "windows")]
fn candidates() -> Vec<Candidate> {
    let local = env_path("LOCALAPPDATA");
    let roaming = env_path("APPDATA");
    let j = |base: &Option<PathBuf>, rel: &str| base.as_ref().map(|p| p.join(rel));

    vec![
        // Chromium family — the profile root, which yt-dlp reads directly.
        Candidate { label: "Chrome", engine: Engine::Chromium, native: Some("chrome"),
            path: j(&local, "Google/Chrome/User Data") },
        Candidate { label: "Edge", engine: Engine::Chromium, native: Some("edge"),
            path: j(&local, "Microsoft/Edge/User Data") },
        Candidate { label: "Brave", engine: Engine::Chromium, native: Some("brave"),
            path: j(&local, "BraveSoftware/Brave-Browser/User Data") },
        Candidate { label: "Vivaldi", engine: Engine::Chromium, native: Some("vivaldi"),
            path: j(&local, "Vivaldi/User Data") },
        Candidate { label: "Chromium", engine: Engine::Chromium, native: Some("chromium"),
            path: j(&local, "Chromium/User Data") },
        Candidate { label: "Opera", engine: Engine::Chromium, native: Some("opera"),
            path: j(&roaming, "Opera Software/Opera Stable") },
        // Opera GX is a separate install with its own cookies; yt-dlp's
        // "opera" points only at Opera Stable, so GX needs an explicit path.
        Candidate { label: "Opera GX", engine: Engine::Chromium, native: None,
            path: j(&roaming, "Opera Software/Opera GX Stable") },
        Candidate { label: "Arc", engine: Engine::Chromium, native: None,
            path: j(&local, "Packages/TheBrowserCompany.Arc_ttt1ap7aakyb4/LocalCache/Local/Arc/User Data") },
        Candidate { label: "Thorium", engine: Engine::Chromium, native: None,
            path: j(&local, "Thorium/User Data") },

        // Firefox family — the *Profiles* directory; a specific profile inside
        // it is chosen later.
        Candidate { label: "Firefox", engine: Engine::Firefox, native: Some("firefox"),
            path: j(&roaming, "Mozilla/Firefox/Profiles") },
        Candidate { label: "Zen", engine: Engine::Firefox, native: None,
            path: j(&roaming, "zen/Profiles") },
        Candidate { label: "LibreWolf", engine: Engine::Firefox, native: None,
            path: j(&roaming, "librewolf/Profiles") },
        Candidate { label: "Waterfox", engine: Engine::Firefox, native: None,
            path: j(&roaming, "Waterfox/Profiles") },
        Candidate { label: "Floorp", engine: Engine::Firefox, native: None,
            path: j(&roaming, "Floorp/Profiles") },
    ]
}

#[cfg(target_os = "macos")]
fn candidates() -> Vec<Candidate> {
    let home = env_path("HOME");
    let lib = home.as_ref().map(|p| p.join("Library/Application Support"));
    let j = |base: &Option<PathBuf>, rel: &str| base.as_ref().map(|p| p.join(rel));

    vec![
        Candidate { label: "Chrome", engine: Engine::Chromium, native: Some("chrome"),
            path: j(&lib, "Google/Chrome") },
        Candidate { label: "Edge", engine: Engine::Chromium, native: Some("edge"),
            path: j(&lib, "Microsoft Edge") },
        Candidate { label: "Brave", engine: Engine::Chromium, native: Some("brave"),
            path: j(&lib, "BraveSoftware/Brave-Browser") },
        Candidate { label: "Vivaldi", engine: Engine::Chromium, native: Some("vivaldi"),
            path: j(&lib, "Vivaldi") },
        Candidate { label: "Chromium", engine: Engine::Chromium, native: Some("chromium"),
            path: j(&lib, "Chromium") },
        Candidate { label: "Opera", engine: Engine::Chromium, native: Some("opera"),
            path: j(&lib, "com.operasoftware.Opera") },
        Candidate { label: "Opera GX", engine: Engine::Chromium, native: None,
            path: j(&lib, "com.operasoftware.OperaGX") },
        Candidate { label: "Arc", engine: Engine::Chromium, native: None,
            path: j(&lib, "Arc/User Data") },
        Candidate { label: "Safari", engine: Engine::Chromium, native: Some("safari"),
            path: home.as_ref().map(|p| p.join("Library/Cookies")) },
        Candidate { label: "Firefox", engine: Engine::Firefox, native: Some("firefox"),
            path: j(&lib, "Firefox/Profiles") },
        Candidate { label: "Zen", engine: Engine::Firefox, native: None,
            path: j(&lib, "zen/Profiles") },
        Candidate { label: "LibreWolf", engine: Engine::Firefox, native: None,
            path: j(&lib, "librewolf/Profiles") },
        Candidate { label: "Waterfox", engine: Engine::Firefox, native: None,
            path: j(&lib, "Waterfox/Profiles") },
    ]
}

#[cfg(all(unix, not(target_os = "macos")))]
fn candidates() -> Vec<Candidate> {
    let home = env_path("HOME");
    let config = home.as_ref().map(|p| p.join(".config"));
    let j = |base: &Option<PathBuf>, rel: &str| base.as_ref().map(|p| p.join(rel));

    vec![
        Candidate { label: "Chrome", engine: Engine::Chromium, native: Some("chrome"),
            path: j(&config, "google-chrome") },
        Candidate { label: "Edge", engine: Engine::Chromium, native: Some("edge"),
            path: j(&config, "microsoft-edge") },
        Candidate { label: "Brave", engine: Engine::Chromium, native: Some("brave"),
            path: j(&config, "BraveSoftware/Brave-Browser") },
        Candidate { label: "Vivaldi", engine: Engine::Chromium, native: Some("vivaldi"),
            path: j(&config, "vivaldi") },
        Candidate { label: "Chromium", engine: Engine::Chromium, native: Some("chromium"),
            path: j(&config, "chromium") },
        Candidate { label: "Opera", engine: Engine::Chromium, native: Some("opera"),
            path: j(&config, "opera") },
        Candidate { label: "Firefox", engine: Engine::Firefox, native: Some("firefox"),
            path: home.as_ref().map(|p| p.join(".mozilla/firefox")) },
        Candidate { label: "Zen", engine: Engine::Firefox, native: None,
            path: j(&config, "zen") },
        Candidate { label: "LibreWolf", engine: Engine::Firefox, native: None,
            path: j(&config, "librewolf") },
        Candidate { label: "Waterfox", engine: Engine::Firefox, native: None,
            path: j(&config, "waterfox") },
        Candidate { label: "Floorp", engine: Engine::Firefox, native: None,
            path: j(&config, "floorp") },
    ]
}

/// The Firefox profile most likely to be the one in use: the one whose cookie
/// store was written most recently. Firefox installs routinely carry several
/// profiles and all but one are usually stale, so picking by mtime beats
/// picking the first directory or trusting a "default" name.
fn newest_firefox_profile(profiles_root: &PathBuf) -> Option<PathBuf> {
    let entries = std::fs::read_dir(profiles_root).ok()?;
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;

    for entry in entries.flatten() {
        let dir = entry.path();
        let cookies = dir.join("cookies.sqlite");
        // A profile with no cookie store has nothing to offer.
        let Ok(meta) = std::fs::metadata(&cookies) else {
            continue;
        };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if best.as_ref().is_none_or(|(t, _)| modified > *t) {
            best = Some((modified, dir));
        }
    }
    best.map(|(_, dir)| dir)
}

/// Every browser found on this machine, in probe order.
///
/// Chromium browsers come last: they lock their cookie database while
/// running, so a Firefox-family browser that is open still works and is the
/// better thing to try first.
pub fn detect() -> Vec<Browser> {
    let mut found = Vec::new();

    for c in candidates() {
        let Some(root) = c.path else { continue };
        if !root.exists() {
            continue;
        }

        let arg = match c.engine {
            Engine::Firefox => {
                // Forks need an explicit profile; so does Firefox itself when
                // we want a specific profile rather than yt-dlp's guess.
                match newest_firefox_profile(&root) {
                    Some(profile) => format!("firefox:{}", profile.display()),
                    // No usable profile inside: fall back to the plain name if
                    // yt-dlp knows this browser, otherwise skip it entirely.
                    None => match c.native {
                        Some(name) => name.to_string(),
                        None => continue,
                    },
                }
            }
            Engine::Chromium => match c.native {
                Some(name) => name.to_string(),
                None => format!("chrome:{}", root.display()),
            },
        };

        found.push(Browser {
            label: c.label.to_string(),
            arg,
            chromium: c.engine == Engine::Chromium,
        });
    }

    // Firefox-family first — see the doc comment.
    found.sort_by_key(|b| b.chromium);
    found
}

/// Looks up a browser by the argument string stored in settings, so the UI can
/// show a name for a saved choice.
pub fn label_for(arg: &str) -> Option<String> {
    detect().into_iter().find(|b| b.arg == arg).map(|b| b.label)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Chromium browsers lock their cookie DB while running, so they are the
    /// worse thing to try first — a Firefox-family browser works even when
    /// open. Probe order has to reflect that.
    #[test]
    fn firefox_family_is_probed_before_chromium() {
        let list = vec![
            Browser { label: "Chrome".into(), arg: "chrome".into(), chromium: true },
            Browser { label: "Zen".into(), arg: "firefox:/p".into(), chromium: false },
        ];
        let mut sorted = list.clone();
        sorted.sort_by_key(|b| b.chromium);
        assert_eq!(sorted[0].label, "Zen");
    }

    /// Detection must never invent a browser that is not installed. Whatever
    /// this machine has, every reported path has to exist.
    #[test]
    fn detected_browsers_are_really_installed() {
        for b in detect() {
            assert!(!b.arg.is_empty(), "an empty argument would break yt-dlp");
            // Forks carry an explicit path; it must point at something real.
            if let Some((_, path)) = b.arg.split_once(':') {
                // Skip bare names like "chrome" that have no path part.
                if path.contains(['/', '\\']) {
                    assert!(
                        PathBuf::from(path).exists(),
                        "{} points at a missing path: {path}",
                        b.label
                    );
                }
            }
        }
    }

    /// A fork is addressed as its base engine plus a path — never by a name
    /// yt-dlp would reject.
    #[test]
    fn forks_are_addressed_by_engine_and_path() {
        for b in detect() {
            let engine = b.arg.split(':').next().unwrap();
            assert!(
                crate::settings::KNOWN_BROWSERS.contains(&engine),
                "{} would be passed to yt-dlp as unknown engine {engine}",
                b.label
            );
        }
    }
}
