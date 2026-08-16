//! Which site a URL belongs to, and what that implies for the UI.
//!
//! The app used to accept YouTube links only, validated with a regex before
//! yt-dlp ever saw them. Supporting several sites through one regex per site
//! would mean re-encoding knowledge yt-dlp already has (it ships ~1750
//! extractors), and it would reject valid URL shapes the moment a site
//! changed one. So validation is deliberately loose here: this module only
//! decides *how to present* a link, and yt-dlp decides whether it can
//! actually be downloaded.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    YouTube,
    TikTok,
    Instagram,
    Twitter,
    Twitch,
    /// A URL that looks like a link but belongs to none of the sites the UI
    /// has specific handling for. yt-dlp may still support it — there are
    /// ~1750 extractors — so these are passed through rather than rejected.
    Other,
}

impl Platform {
    /// Display name for error messages and the UI badge.
    pub fn label(&self) -> &'static str {
        match self {
            Platform::YouTube => "YouTube",
            Platform::TikTok => "TikTok",
            Platform::Instagram => "Instagram",
            Platform::Twitter => "X",
            Platform::Twitch => "Twitch",
            Platform::Other => "Link",
        }
    }

    /// Whether the UI can embed a playable preview.
    ///
    /// Only YouTube offers an embed that works inside a webview without
    /// login or an SDK. The others are shown as a thumbnail with the site's
    /// own page one click away.
    ///
    /// Sent to the frontend as part of `VideoInfo` rather than being
    /// recomputed there, so this stays the single place the rule lives.
    pub fn supports_embed(&self) -> bool {
        matches!(self, Platform::YouTube)
    }

    /// Sites that commonly gate content behind a login. Used to turn yt-dlp's
    /// raw extractor errors into something a user can act on.
    pub fn may_require_login(&self) -> bool {
        matches!(self, Platform::Instagram | Platform::TikTok | Platform::Twitter)
    }
}

/// Extracts the host from a URL without pulling in a URL-parsing crate: the
/// host is everything between "://" and the next "/", "?" or "#", minus any
/// userinfo and port.
fn host_of(url: &str) -> Option<String> {
    let after_scheme = url.split_once("://")?.1;
    let host = after_scheme
        .split(['/', '?', '#'])
        .next()?
        .rsplit('@')
        .next()?
        .split(':')
        .next()?;

    if host.is_empty() {
        return None;
    }

    Some(host.to_ascii_lowercase())
}

/// True when `host` is `domain` or a subdomain of it — a suffix check alone
/// would match "evilyoutube.com" for "youtube.com".
fn host_matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// Identifies the platform a URL belongs to. Anything with an http(s) scheme
/// and a host resolves to at least `Other`; anything else is not a link.
pub fn detect(url: &str) -> Option<Platform> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return None;
    }

    let host = host_of(url)?;

    let platform = if ["youtube.com", "youtu.be", "youtube-nocookie.com"]
        .iter()
        .any(|d| host_matches(&host, d))
    {
        Platform::YouTube
    } else if ["tiktok.com", "vm.tiktok.com"]
        .iter()
        .any(|d| host_matches(&host, d))
    {
        Platform::TikTok
    } else if ["instagram.com", "instagr.am", "ddinstagram.com"]
        .iter()
        .any(|d| host_matches(&host, d))
    {
        Platform::Instagram
    } else if ["twitter.com", "x.com", "t.co", "fxtwitter.com", "vxtwitter.com"]
        .iter()
        .any(|d| host_matches(&host, d))
    {
        Platform::Twitter
    } else if ["twitch.tv"].iter().any(|d| host_matches(&host, d)) {
        Platform::Twitch
    } else {
        Platform::Other
    };

    Some(platform)
}

/// Whether a URL points at a collection of items rather than one.
///
/// Only checked for sites where a playlist view makes sense. Instagram and
/// TikTok profile URLs are deliberately not treated as playlists: yt-dlp
/// marks `instagram:user` as broken, and enumerating a whole TikTok profile
/// is a very different (and much slower) operation than what this UI does.
pub fn is_collection(url: &str, platform: Platform) -> bool {
    match platform {
        Platform::YouTube => {
            url.contains("youtube.com/playlist")
                || (url.contains("list=") && url.contains("youtube.com/watch"))
        }
        // A Twitch "collection" URL is a real playlist-shaped thing, but VODs
        // and clips (the common case) are single items.
        Platform::Twitch => url.contains("/collection/"),
        _ => false,
    }
}

/// Turns yt-dlp's extractor errors into something a user can act on.
///
/// yt-dlp's messages are written for a CLI audience ("Unable to download
/// webpage: HTTP Error 403", "Instagram sent an empty media response"), and
/// showing them verbatim in a desktop app tells a non-technical user nothing
/// about what to do. The raw text is still worth keeping for genuinely
/// unknown failures — a vague generic message is worse than a specific
/// technical one.
pub fn explain_error(raw: &str, platform: Platform) -> String {
    let lower = raw.to_ascii_lowercase();

    // No connection. Checked first: with the network down every other branch
    // is a wrong guess, and the raw text is the worst offender in the whole
    // set — yt-dlp hands back curl's own wording, so the user was shown
    // "curl: (6) Could not resolve host … see libcurl-errors.html", which
    // says nothing about the one thing they can act on.
    if lower.contains("could not resolve host")
        || lower.contains("failed to resolve")
        || lower.contains("temporary failure in name resolution")
        || lower.contains("connection refused")
        || lower.contains("network is unreachable")
        || lower.contains("connection reset")
        || lower.contains("failed to perform")
        || lower.contains("ssl connect error")
    {
        return "Couldn't reach the internet. Check your connection and try \
                again."
            .into();
    }

    // Cookie extraction fails while the browser holds its database open —
    // a very common state, since people leave their browser running. This
    // has to be checked before the login branch, because the underlying
    // symptom the user then hits is "login required".
    if lower.contains("could not copy") && lower.contains("cookie database") {
        return "Close your browser completely and try again — check the \
                taskbar corner too, it often keeps running there. Your login \
                can't be read while it's open."
            .into();
    }

    // Instagram refusing the request outright. Originally read as a per-device
    // rate limit on an observation of HTTP 429; re-measured later that no
    // longer held — the API answered 403, every Instagram path failed with a
    // session Instagram demonstrably accepts, and instagram.com still loaded
    // fine in a browser. A rate limit would not be path-specific.
    //
    // Checked before the login branch because the symptom reads like a missing
    // login and the advice is the opposite: signing in again cannot help.
    if platform == Platform::Instagram
        && (lower.contains("http error 400")
            || lower.contains("http error 401")
            || lower.contains("http error 403")
            || lower.contains("http error 429")
            || lower.contains("too many requests")
            || lower.contains("rate-limit reached")
            || lower.contains("not granting access")
            || lower.contains("unable to extract data")
            || lower.contains("video info extraction failed"))
    {
        return "Instagram is blocking downloads right now. It's not your \
                account and not something you can fix here — signing in again \
                won't help. It'll start working again by itself once the fix \
                arrives."
            .into();
    }

    if lower.contains("login required")
        || lower.contains("requested content is not available")
        || lower.contains("empty media response")
        || lower.contains("rate-limit reached")
        || lower.contains("sign in")
    {
        return if platform.may_require_login() {
            format!(
                "{} needs you to be logged in for this one. Private accounts, \
                 stories and age-restricted posts can't be downloaded.",
                platform.label()
            )
        } else {
            format!("{} wouldn't serve this without a login.", platform.label())
        };
    }

    if lower.contains("video unavailable")
        || lower.contains("does not exist")
        || lower.contains("not found")
        || lower.contains("404")
    {
        return "That post doesn't exist any more, or the link is wrong.".into();
    }

    if lower.contains("no video could be found") || lower.contains("no media found") {
        return "There's no video on that post — it may be text or images only.".into();
    }

    if lower.contains("unsupported url") || lower.contains("is not a valid url") {
        return "That link isn't one this app can download from.".into();
    }

    if lower.contains("geo") && lower.contains("restrict") {
        return "That post isn't available in your country.".into();
    }

    if lower.contains("private") {
        return "That post is private.".into();
    }

    // A 403 arrives *after* extraction succeeded: the format was listed with
    // a real size and the media request was then refused. On YouTube that is
    // the site rotating which player clients it will serve, which yt-dlp
    // tracks far faster than this app can ship releases.
    // Points at Settings by what the user sees there, not by the tool's name:
    // the Updates page shows "yt-dlp" as a row, so "check for updates in
    // Settings" lands them in the right place without needing to know what
    // yt-dlp is beforehand.
    if lower.contains("http error 403") || lower.contains("forbidden") {
        return format!(
            "{} wouldn't hand over the file. The site has usually changed \
             something — open Settings and check for updates, which fixes \
             this more often than not.",
            platform.label()
        );
    }

    // Unexpected-response failures are usually the extractor itself breaking
    // against a site change, not anything the user did — say so, since
    // "check your link" would send them chasing a non-problem.
    if lower.contains("unexpected response") || lower.contains("please report") {
        return format!(
            "{} changed something and this app can't read it right now. \
             Nothing is wrong on your end — open Settings and check for \
             updates, or wait for the fix.",
            platform.label()
        );
    }

    // Nothing matched. The raw line is still the most informative thing
    // available, and a vague "something went wrong" would be worse — but it
    // is written for a terminal, so the parts that only make sense there are
    // stripped: the `ERROR:` prefix, the `[Instagram] Abc123:` extractor tag,
    // and any URL to documentation the user has no reason to open.
    let last = raw.lines().last().unwrap_or(raw).trim();
    let mut cleaned = last.trim_start_matches("ERROR:").trim();

    // "[Instagram] DAsMcJEyaGY: Unable to …" → "Unable to …". Split on ": ",
    // never a bare ':', which would cut a URL apart at its scheme.
    if cleaned.starts_with('[') {
        if let Some((_, rest)) = cleaned.split_once("] ") {
            cleaned = rest.split_once(": ").map_or(rest, |(_, r)| r.trim());
        }
    }

    // Drop a trailing "See https://… for more details." and anything after it.
    let cleaned = match cleaned.find(" See http") {
        Some(i) => cleaned[..i].trim(),
        None => cleaned,
    };
    let cleaned = match cleaned.find("http") {
        Some(i) if i > 0 => cleaned[..i].trim().trim_end_matches('.').trim(),
        _ => cleaned,
    };

    if cleaned.is_empty() {
        format!("Couldn't fetch that {} link.", platform.label())
    } else {
        let mut msg: String = cleaned.chars().take(180).collect();
        if !msg.ends_with('.') {
            msg.push('.');
        }
        msg
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Instagram's refusal arrives labelled 400, not 429 — yt-dlp reports what
    /// its extractor saw, not the status underneath. Matching only on "429"
    /// would miss every real occurrence.
    ///
    /// The message must not blame the user's account or promise a wait: this
    /// was measured to be a general block on downloaders, not a per-device
    /// rate limit, and an earlier version told people to wait a few hours for
    /// something that does not lift on a timer.
    #[test]
    fn instagram_refusal_is_named_not_echoed() {
        let raw = "ERROR: [Instagram] X: Video info extraction failed: \
                   HTTP Error 400: Bad Request";
        let msg = explain_error(raw, Platform::Instagram);
        assert!(msg.contains("blocking"), "names the cause: {msg}");
        assert!(
            msg.contains("not your account"),
            "must not leave the user suspecting their own login: {msg}"
        );
        assert!(!msg.contains("400"), "no raw status code: {msg}");
    }

    /// The same 400 on another site is not Instagram's block and must not
    /// borrow its explanation.
    #[test]
    fn other_sites_do_not_get_the_instagram_explanation() {
        let msg = explain_error("ERROR: HTTP Error 400", Platform::Twitter);
        assert!(!msg.contains("Instagram is blocking"), "{msg}");
    }

    /// A 403 means extraction worked and the media request was then refused —
    /// the site changed something. Checking for updates is the action that
    /// helps, so the message has to point there rather than printing a status
    /// code the user cannot act on.
    #[test]
    fn forbidden_points_at_checking_for_updates() {
        let raw = "ERROR: unable to download video data: HTTP Error 403: Forbidden";
        let msg = explain_error(raw, Platform::YouTube);
        assert!(msg.contains("Settings"), "says where to go: {msg}");
        assert!(msg.contains("updates"), "says what to do there: {msg}");
        assert!(!msg.contains("403"), "no raw status code: {msg}");
    }

    /// Captured verbatim from the app while the connection dropped mid-test.
    /// It is the worst raw message in the set — yt-dlp passes curl's own
    /// wording straight through, so the user was shown a libcurl error code
    /// and a link to libcurl's documentation.
    #[test]
    fn a_dropped_connection_says_so() {
        let raw = "[Instagram] DAsMcJEyaGY: Unable to download webpage: \
                   Failed to perform, curl: (6) Could not resolve host: \
                   www.instagram.com. See https://curl.se/libcurl/c/libcurl-errors.html \
                   first for more details.";
        let msg = explain_error(raw, Platform::Instagram);
        assert!(msg.contains("internet"), "{msg}");
        assert!(!msg.contains("curl"), "leaks curl: {msg}");
        assert!(!msg.contains("http"), "leaks a documentation link: {msg}");
    }

    /// An unrecognised failure still shows yt-dlp's own words — a vague
    /// "something went wrong" would be less useful — but stripped of the
    /// parts that only mean something in a terminal.
    #[test]
    fn an_unknown_error_is_cleaned_before_it_is_shown() {
        let raw = "ERROR: [SomeSite] xyz789: The clip is still processing. \
                   See https://example.com/help for more details.";
        let msg = explain_error(raw, Platform::Other);
        assert!(msg.starts_with("The clip is still processing"), "{msg}");
        assert!(!msg.contains('['), "leaks the extractor tag: {msg}");
        assert!(!msg.contains("xyz789"), "leaks the internal id: {msg}");
        assert!(!msg.contains("http"), "leaks a link: {msg}");
    }

    /// Every message the user can be shown has to read as plain English.
    /// These strings surface in the app's error area, where "yt-dlp",
    /// "extractor" or a bare status code tells someone nothing they can act
    /// on — the tool's name in particular means nothing to a person who just
    /// wanted a video.
    #[test]
    fn user_facing_errors_avoid_tool_jargon() {
        let cases = [
            ("ERROR: Could not copy Chrome cookie database.", Platform::Instagram),
            (
                "ERROR: [Instagram] X: Video info extraction failed: HTTP Error 400: Bad Request",
                Platform::Instagram,
            ),
            (
                "ERROR: unable to download video data: HTTP Error 403: Forbidden",
                Platform::YouTube,
            ),
            ("ERROR: Unexpected response; please report this issue", Platform::TikTok),
            ("ERROR: Video unavailable", Platform::YouTube),
        ];
        for (raw, platform) in cases {
            let msg = explain_error(raw, platform);
            let lower = msg.to_ascii_lowercase();
            for word in ["yt-dlp", "extractor", "http error", "stderr", "api"] {
                assert!(
                    !lower.contains(word),
                    "message for {platform:?} leaks {word:?}: {msg}"
                );
            }
        }
    }

    #[test]
    fn detects_each_supported_platform() {
        assert_eq!(detect("https://www.youtube.com/watch?v=abc"), Some(Platform::YouTube));
        assert_eq!(detect("https://youtu.be/abc"), Some(Platform::YouTube));
        assert_eq!(detect("https://www.tiktok.com/@a/video/123"), Some(Platform::TikTok));
        assert_eq!(detect("https://vm.tiktok.com/ZM123/"), Some(Platform::TikTok));
        assert_eq!(detect("https://www.instagram.com/reel/abc/"), Some(Platform::Instagram));
        assert_eq!(detect("https://x.com/nasa/status/123"), Some(Platform::Twitter));
        assert_eq!(detect("https://twitter.com/nasa/status/123"), Some(Platform::Twitter));
        assert_eq!(detect("https://www.twitch.tv/videos/123"), Some(Platform::Twitch));
    }

    #[test]
    fn unknown_hosts_pass_through_as_other() {
        // yt-dlp supports ~1750 sites; rejecting anything not in our list
        // would block most of them for no reason.
        assert_eq!(detect("https://vimeo.com/123"), Some(Platform::Other));
        assert_eq!(detect("https://soundcloud.com/a/b"), Some(Platform::Other));
    }

    #[test]
    fn rejects_non_urls() {
        assert_eq!(detect("just some text"), None);
        assert_eq!(detect("youtube.com/watch?v=abc"), None); // no scheme
        assert_eq!(detect(""), None);
    }

    /// A plain suffix check would let "evilyoutube.com" pass as YouTube.
    #[test]
    fn lookalike_domains_are_not_matched() {
        assert_eq!(detect("https://evilyoutube.com/watch?v=a"), Some(Platform::Other));
        assert_eq!(detect("https://nottiktok.com/video/1"), Some(Platform::Other));
    }

    #[test]
    fn handles_ports_and_userinfo_in_host() {
        assert_eq!(detect("https://www.youtube.com:443/watch?v=a"), Some(Platform::YouTube));
    }

    /// Only YouTube has an embed that plays inside a webview without a login
    /// or an SDK; everything else has to open in the user's real browser.
    #[test]
    fn only_youtube_can_be_embedded() {
        assert!(Platform::YouTube.supports_embed());
        assert!(!Platform::TikTok.supports_embed());
        assert!(!Platform::Instagram.supports_embed());
        assert!(!Platform::Twitter.supports_embed());
        assert!(!Platform::Twitch.supports_embed());
        assert!(!Platform::Other.supports_embed());
    }

    /// Drives the tailored "you need to be logged in" message. Twitch and
    /// YouTube serve public content without a session, so they are excluded.
    #[test]
    fn login_prone_sites_are_flagged() {
        assert!(Platform::Instagram.may_require_login());
        assert!(Platform::TikTok.may_require_login());
        assert!(Platform::Twitter.may_require_login());
        assert!(!Platform::YouTube.may_require_login());
        assert!(!Platform::Twitch.may_require_login());
    }

    #[test]
    fn detects_youtube_playlists_but_not_profiles() {
        assert!(is_collection(
            "https://www.youtube.com/playlist?list=PL1",
            Platform::YouTube
        ));
        assert!(is_collection(
            "https://www.youtube.com/watch?v=a&list=PL1",
            Platform::YouTube
        ));
        // instagram:user is marked broken upstream — never treat a profile
        // URL as an enumerable collection.
        assert!(!is_collection(
            "https://www.instagram.com/nasa/",
            Platform::Instagram
        ));
        assert!(!is_collection(
            "https://www.tiktok.com/@nasa",
            Platform::TikTok
        ));
    }

    #[test]
    fn login_errors_name_the_platform_and_the_limit() {
        let msg = explain_error("ERROR: Login required", Platform::Instagram);
        assert!(msg.contains("Instagram"));
        assert!(msg.contains("logged in"));
    }

    #[test]
    fn extractor_breakage_is_not_blamed_on_the_user() {
        let msg = explain_error(
            "ERROR: [TikTok] 123: Unexpected response from webpage request; please report this issue",
            Platform::TikTok,
        );
        assert!(msg.contains("TikTok"));
        // The user should not be told to check a link that is fine.
        assert!(!msg.to_lowercase().contains("check that the link"));
    }

    #[test]
    fn unknown_errors_keep_yt_dlps_own_text() {
        let msg = explain_error("ERROR: something extremely specific broke", Platform::Other);
        assert!(msg.contains("something extremely specific broke"));
    }
}
