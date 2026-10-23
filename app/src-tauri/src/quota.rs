//! The daily allowance for the AI features, and the person's own key.
//!
//! The shared keys live on the project's server (web/lib/ai.ts), which is the
//! real limit: a free Groq account only has so many tokens a day, so each
//! install gets five AI searches and five Spotify checks per 24 hours, counted
//! there. This file keeps the same count on the machine, which is what Settings
//! shows and what saves a request that is bound to be refused. A rolling
//! 24-hour window rather than a calendar day, so there is no time zone to get
//! wrong and no midnight where everyone's counter resets at once.
//!
//! Someone who adds their own Groq key in Settings is not counted at all: the
//! cost is theirs, so the limit is too.
//!
//! The file can be edited, which changes what this side shows and nothing the
//! server will allow. It also holds the install's id, which is how the server
//! tells installs apart.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub const DAILY_LIMIT: u32 = 5;
const WINDOW_SECS: u64 = 24 * 60 * 60;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Use {
    /// "Describe what you're after" on the AI tab.
    Search,
    /// The model's check of a Spotify match.
    Verify,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
struct State {
    own_key: Option<String>,
    /// Random, made on first use. Not a person's identity: it only lets the
    /// server count one install's requests together.
    install: String,
    window_start: u64,
    search_used: u32,
    verify_used: u32,
    /// Whether the person has already been told this window that the
    /// allowance ran out. Once is enough; every playlist track would
    /// otherwise raise the same warning again.
    told_search: bool,
    told_verify: bool,
}

/// What a request for one use of the model got.
#[derive(Debug, PartialEq, Eq)]
pub enum Access {
    /// The person's own key. Not counted.
    Own(String),
    /// The shared keys, one use set aside. Hand it back with `refund` if the
    /// request did not get an answer.
    Shared,
    /// The allowance is spent. `first` is true the first time in a window, the
    /// moment to say so.
    Spent { first: bool },
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Usage {
    pub limit: u32,
    pub search_used: u32,
    pub verify_used: u32,
    /// Seconds until the counters start again; 0 when nothing is counted yet.
    pub resets_in: u64,
    pub own_key: bool,
    /// The last four characters of the saved key, enough to recognise it.
    pub key_hint: Option<String>,
}

static STATE: Mutex<State> = Mutex::new(State {
    own_key: None,
    install: String::new(),
    window_start: 0,
    search_used: 0,
    verify_used: 0,
    told_search: false,
    told_verify: false,
});
static PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn init(config_dir: Option<PathBuf>) {
    let file = config_dir.map(|d| d.join("ai.json"));
    let loaded = file
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<State>(&raw).ok())
        .unwrap_or_default();
    *STATE.lock().unwrap() = loaded;
    *PATH.lock().unwrap() = file;
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn save(state: &State) {
    let Some(path) = PATH.lock().unwrap().clone() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // Best effort: failing to remember a counter must not fail a search.
    if let Ok(body) = serde_json::to_string(state) {
        let _ = std::fs::write(path, body);
    }
}

/// Starts a fresh window once 24 hours have passed. A clock set backwards
/// counts as a new window too, so a wrong clock cannot lock anyone out.
fn roll(s: &mut State, now: u64) {
    if s.window_start == 0 || now < s.window_start || now - s.window_start >= WINDOW_SECS {
        s.window_start = now;
        s.search_used = 0;
        s.verify_used = 0;
        s.told_search = false;
        s.told_verify = false;
    }
}

fn reserve_at(s: &mut State, kind: Use, now: u64) -> Access {
    if let Some(key) = s.own_key.clone() {
        return Access::Own(key);
    }
    roll(s, now);
    let (used, told) = match kind {
        Use::Search => (&mut s.search_used, &mut s.told_search),
        Use::Verify => (&mut s.verify_used, &mut s.told_verify),
    };
    if *used >= DAILY_LIMIT {
        let first = !*told;
        *told = true;
        return Access::Spent { first };
    }
    *used += 1;
    Access::Shared
}

pub fn reserve(kind: Use) -> Access {
    let mut s = STATE.lock().unwrap();
    let access = reserve_at(&mut s, kind, now());
    save(&s);
    access
}

/// Gives back a use that never got an answer (the service was down, every key
/// was rate-limited). The person should not pay for our failure.
pub fn refund(kind: Use) {
    let mut s = STATE.lock().unwrap();
    let used = match kind {
        Use::Search => &mut s.search_used,
        Use::Verify => &mut s.verify_used,
    };
    *used = used.saturating_sub(1);
    save(&s);
}

/// The server said this use is spent although the count here was lower (the
/// file was edited, or another install on the same address used it up). Brings
/// the count in line; true the first time in a window, the moment to say so.
pub fn exhaust(kind: Use) -> bool {
    let mut s = STATE.lock().unwrap();
    let first = exhaust_at(&mut s, kind, now());
    save(&s);
    first
}

fn exhaust_at(s: &mut State, kind: Use, now: u64) -> bool {
    roll(s, now);
    let (used, told) = match kind {
        Use::Search => (&mut s.search_used, &mut s.told_search),
        Use::Verify => (&mut s.verify_used, &mut s.told_verify),
    };
    *used = DAILY_LIMIT;
    let first = !*told;
    *told = true;
    first
}

pub fn install_id() -> String {
    let mut s = STATE.lock().unwrap();
    if s.install.is_empty() {
        s.install = uuid::Uuid::new_v4().to_string();
        save(&s);
    }
    s.install.clone()
}

pub fn own_key() -> Option<String> {
    STATE.lock().unwrap().own_key.clone()
}

pub fn set_own_key(key: Option<String>) {
    let mut s = STATE.lock().unwrap();
    s.own_key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    save(&s);
}

fn usage_at(s: &State, now: u64) -> Usage {
    // A window that has already run out shows as empty, the way the next
    // request will treat it.
    let expired =
        s.window_start == 0 || now < s.window_start || now - s.window_start >= WINDOW_SECS;
    let (search_used, verify_used, resets_in) = if expired {
        (0, 0, 0)
    } else {
        (
            s.search_used,
            s.verify_used,
            s.window_start + WINDOW_SECS - now,
        )
    };
    Usage {
        limit: DAILY_LIMIT,
        search_used,
        verify_used,
        resets_in,
        own_key: s.own_key.is_some(),
        key_hint: s.own_key.as_ref().map(|k| {
            let tail: String = k
                .chars()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            format!("…{tail}")
        }),
    }
}

pub fn usage() -> Usage {
    usage_at(&STATE.lock().unwrap(), now())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn five_are_granted_and_the_sixth_is_spent() {
        let mut s = State::default();
        for _ in 0..DAILY_LIMIT {
            assert_eq!(reserve_at(&mut s, Use::Search, 1000), Access::Shared);
        }
        assert_eq!(
            reserve_at(&mut s, Use::Search, 1001),
            Access::Spent { first: true }
        );
        // Told once per window, not on every later attempt.
        assert_eq!(
            reserve_at(&mut s, Use::Search, 1002),
            Access::Spent { first: false }
        );
    }

    #[test]
    fn exhausting_one_use_leaves_the_other_and_tells_once() {
        let mut s = State::default();
        let _ = reserve_at(&mut s, Use::Search, 1000);
        s.search_used = DAILY_LIMIT;
        assert_eq!(
            reserve_at(&mut s, Use::Search, 1001),
            Access::Spent { first: true }
        );
        assert_eq!(
            reserve_at(&mut s, Use::Search, 1002),
            Access::Spent { first: false }
        );
        assert_eq!(reserve_at(&mut s, Use::Verify, 1003), Access::Shared);
    }

    #[test]
    fn searches_and_checks_are_counted_apart() {
        let mut s = State::default();
        for _ in 0..DAILY_LIMIT {
            reserve_at(&mut s, Use::Search, 1000);
        }
        assert_eq!(reserve_at(&mut s, Use::Verify, 1000), Access::Shared);
    }

    #[test]
    fn the_window_rolls_after_a_day() {
        let mut s = State::default();
        for _ in 0..DAILY_LIMIT {
            reserve_at(&mut s, Use::Verify, 1000);
        }
        assert!(matches!(
            reserve_at(&mut s, Use::Verify, 1000 + WINDOW_SECS - 1),
            Access::Spent { .. }
        ));
        assert_eq!(
            reserve_at(&mut s, Use::Verify, 1000 + WINDOW_SECS),
            Access::Shared
        );
        // And the warning is armed again for the new window.
        for _ in 1..DAILY_LIMIT {
            reserve_at(&mut s, Use::Verify, 1000 + WINDOW_SECS);
        }
        assert_eq!(
            reserve_at(&mut s, Use::Verify, 1000 + WINDOW_SECS),
            Access::Spent { first: true }
        );
    }

    #[test]
    fn a_clock_set_backwards_does_not_lock_anyone_out() {
        let mut s = State::default();
        for _ in 0..DAILY_LIMIT {
            reserve_at(&mut s, Use::Search, 50_000);
        }
        assert_eq!(reserve_at(&mut s, Use::Search, 10), Access::Shared);
    }

    #[test]
    fn an_own_key_is_never_counted() {
        let mut s = State {
            own_key: Some("gsk_abcd1234".into()),
            ..Default::default()
        };
        for _ in 0..50 {
            assert_eq!(
                reserve_at(&mut s, Use::Search, 1000),
                Access::Own("gsk_abcd1234".into())
            );
        }
        assert_eq!(s.search_used, 0);
        assert_eq!(usage_at(&s, 1000).key_hint.as_deref(), Some("…1234"));
    }

    #[test]
    fn usage_reports_time_left_and_forgets_an_expired_window() {
        let mut s = State::default();
        reserve_at(&mut s, Use::Search, 1000);
        let u = usage_at(&s, 1000 + 3600);
        assert_eq!((u.search_used, u.resets_in), (1, WINDOW_SECS - 3600));
        let u = usage_at(&s, 1000 + WINDOW_SECS + 1);
        assert_eq!((u.search_used, u.resets_in), (0, 0));
    }
}
