/// Finding downloadable media on a page that is not itself a video page.
///
/// The tabs everywhere else in this app start from a link that *is* the thing
/// you want. This one starts from a link that merely *contains* things you
/// want: an article with embeds, a course page, an archive listing. yt-dlp
/// cannot be handed that URL directly and asked to work it out — measured, it
/// answers "Unsupported URL" on most such pages, and on the ones it does
/// handle it returns exactly one item even when the page holds several.
///
/// So there are two passes, and they are genuinely different techniques:
///
///   quick — hand the page to yt-dlp as-is and let its generic extractor look
///           for an embedded player. One request, a few seconds, no risk of
///           annoying anyone. Finds nothing on most pages, which is fine.
///
///   deep  — fetch the page ourselves, pull every link out of the HTML, and
///           ask yt-dlp which of them it recognises.
///
/// The deep pass sounds like a crawler and is not one, for one measured
/// reason: `--use-extractors default,-generic` makes yt-dlp reject a URL it
/// does not recognise *by its shape alone*, with no network request at all.
/// Feeding it eighty links from a page costs eighty pattern matches and a
/// handful of real requests — only to the links that were already going to a
/// known media site. That is why this does not hammer the site it scanned.
///
/// Everything goes through a single yt-dlp process via a batch file, so this
/// is one spawn regardless of how many links the page had.
use serde::Serialize;
use std::collections::BTreeSet;

use crate::ytdlp;

/// How long to wait for the page itself. Short on purpose: this is one request
/// to one server, and a page that has not answered in this long is not going
/// to produce a useful scan either.
const PAGE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Cap on links handed to yt-dlp in the deep pass.
///
/// Not a politeness limit — rejection is free, so the cost of a large page is
/// paid in pattern matching, not requests. It is a latency limit, and it is
/// the only real lever on how long a scan takes: measured against a channel
/// page, a link yt-dlp *recognises* costs about 1.2s to look up, while one it
/// does not costs nothing. 300 candidates that all turn out to be real is a
/// six-minute wait; this keeps the worst case near two.
const MAX_CANDIDATES: usize = 120;

/// How many entries to take from any one link that turns out to be a playlist
/// or a channel.
///
/// Measured, and the reason this exists: a channel link sitting in the page's
/// footer expanded to 609 rows from a page that had 30 videos on it. The page
/// is the subject of the scan — a channel linked from it is a different
/// subject, and swamping the list with it buries what was actually there.
const ITEMS_PER_COLLECTION: &str = "1:5";

/// A page is HTML, and HTML is the only thing worth parsing here. A link that
/// points straight at a 400 MB video file should not be downloaded in order to
/// discover that it was not a web page.
const MAX_PAGE_BYTES: usize = 8 * 1024 * 1024;

/// One thing found on the page that yt-dlp can actually fetch.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    /// The URL to hand to the normal download path.
    pub url: String,
    pub title: String,
    /// Seconds. Zero when the site did not say, which is common on a flat
    /// listing and is not an error.
    pub duration: f64,
    pub uploader: String,
    /// Which site this turned out to live on, for the row's second line.
    pub site: String,
    /// How this was found, so the row can say why it is in the list. The user
    /// asked for this explicitly: they want to know what they are looking at.
    pub how: Origin,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    /// Found by yt-dlp's own generic extractor — an embedded player.
    Embedded,
    /// Found as a link in the page's HTML that yt-dlp recognised.
    Linked,
}

/// Pulls every candidate URL out of a page's HTML.
///
/// Deliberately not an HTML parser. A real parser buys correctness on
/// malformed markup, and this does not need it: the goal is to over-collect
/// cheaply and let yt-dlp be the judge of what is real. A missed link costs a
/// result; a bogus one costs a free pattern-match rejection. The asymmetry is
/// the whole design.
///
/// Collected from `href="..."` and `src="..."` — the second matters because
/// embeds live in `<iframe src>`, which is exactly the case this feature is
/// for.
fn harvest_links(html: &str, base: &url_lite::Base) -> Vec<String> {
    // BTreeSet: deduplicates and gives a stable order, so two scans of the
    // same page list their results the same way.
    let mut out = BTreeSet::new();

    for attr in ["href=", "src="] {
        let mut rest = html;
        while let Some(at) = rest.find(attr) {
            rest = &rest[at + attr.len()..];
            let Some(quote) = rest.chars().next() else { break };
            if quote != '"' && quote != '\'' {
                continue;
            }
            let Some(end) = rest[1..].find(quote) else { break };
            let raw = &rest[1..1 + end];
            rest = &rest[1 + end..];

            if let Some(abs) = base.resolve(&decode_entities(raw)) {
                out.insert(abs);
            }
        }
    }

    // Sites that render their listings from JSON rather than anchors — YouTube
    // is the obvious one — ship no href for the videos on the page at all.
    // Measured: a channel's video page yields its links only this way.
    for cap in find_all_video_ids(html) {
        out.insert(format!("https://www.youtube.com/watch?v={cap}"));
    }

    out.into_iter().collect()
}

/// Pulls `"videoId":"..."` values out of a page's embedded JSON.
///
/// Narrow on purpose. This is not a general "find ids in JSON" pass — that
/// would invent URLs for every site that happens to use the word. It handles
/// the one case measured to need it, and anything else goes through the
/// ordinary link harvest.
fn find_all_video_ids(html: &str) -> Vec<String> {
    const KEY: &str = "\"videoId\":\"";
    let mut out = Vec::new();
    let mut rest = html;

    while let Some(at) = rest.find(KEY) {
        rest = &rest[at + KEY.len()..];
        let Some(end) = rest.find('"') else { break };
        let id = &rest[..end];
        // YouTube ids are exactly 11 URL-safe characters. Checking that keeps
        // a truncated or unrelated value from becoming a dead row.
        if id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            out.push(id.to_string());
        }
        rest = &rest[end..];
    }

    out
}

/// Undoes the HTML escaping an attribute value carries.
///
/// `href="...?v=x&amp;t=1"` is the *correct* way to write that link in HTML,
/// so this is not a rare malformed case — it is what a well-formed page looks
/// like. Feeding the raw text to yt-dlp passes a literal "&amp;t=1" as part of
/// the query string, which happens to be harmless on YouTube and is not on a
/// site that reads its parameters.
fn decode_entities(raw: &str) -> String {
    // &amp; last: decoding it first would turn "&amp;lt;" into "<" instead of
    // the literal "&lt;" the page actually meant.
    raw.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#x2F;", "/")
        .replace("&#47;", "/")
        .replace("&amp;", "&")
}

/// Just enough URL handling to turn a page-relative link into an absolute one.
///
/// A whole URL crate would be a dependency for this one job. What is needed is
/// narrow: keep absolute http(s) links, resolve root-relative and
/// path-relative ones against the page, and drop everything else — mailto,
/// javascript, data, fragments.
mod url_lite {
    pub struct Base {
        /// e.g. "https://example.com"
        origin: String,
        /// e.g. "https://example.com/docs/" — always ends in a slash.
        dir: String,
    }

    impl Base {
        pub fn of(page_url: &str) -> Option<Base> {
            let scheme_end = page_url.find("://")? + 3;
            let after = &page_url[scheme_end..];
            let host_len = after.find('/').unwrap_or(after.len());
            let origin = page_url[..scheme_end + host_len].to_string();

            let full = page_url.split(['?', '#']).next().unwrap_or(page_url);
            let dir = match full.rfind('/') {
                // rfind lands on the slash after the host when there is no
                // path, which is still the right directory.
                Some(i) if i >= scheme_end => full[..=i].to_string(),
                _ => format!("{origin}/"),
            };

            Some(Base { origin, dir })
        }

        pub fn resolve(&self, raw: &str) -> Option<String> {
            let raw = raw.trim();
            if raw.is_empty() || raw.starts_with('#') {
                return None;
            }

            // Protocol-relative: //host/path inherits the page's scheme.
            if let Some(hostless) = raw.strip_prefix("//") {
                let scheme = self.origin.split("://").next()?;
                return Some(format!("{scheme}://{hostless}"));
            }

            if raw.starts_with("http://") || raw.starts_with("https://") {
                return Some(raw.to_string());
            }

            // Any other scheme (mailto:, javascript:, data:, tel:) is not a
            // page and never a video.
            if raw.contains(':') && raw.split(':').next().is_some_and(|s| !s.contains('/')) {
                return None;
            }

            if let Some(path) = raw.strip_prefix('/') {
                return Some(format!("{}/{}", self.origin, path));
            }

            Some(format!("{}{}", self.dir, raw))
        }
    }
}

/// Fetches the page's HTML.
///
/// Sends a browser User-Agent. Not to disguise anything — the request is one
/// GET for one page the user explicitly pasted — but because a plain library
/// UA is served a different page, or none, by enough sites to make the feature
/// look broken when it is not.
async fn fetch_page(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(PAGE_TIMEOUT)
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        )
        .build()
        .map_err(|_| "Could not start the scan.".to_string())?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "Couldn't open that page. Check the link, or your connection.".to_string())?;

    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "That page needs you to be signed in, so it can't be scanned.".to_string(),
            404 => "That page isn't there any more.".to_string(),
            429 => "The site is asking us to slow down. Try again in a minute.".to_string(),
            _ => "That page wouldn't open.".to_string(),
        });
    }

    // A link straight to a big media file is not a page to scan. Checking the
    // declared type first avoids pulling the file down to find that out.
    // map_or rather than is_none_or: the latter is newer than this crate's
    // stated minimum Rust version, and a warning nobody can act on is a
    // warning people learn to scroll past.
    let is_html = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map_or(true, |t| t.contains("html") || t.contains("xml"));
    if !is_html {
        return Err("That link is a file, not a page. Paste it in the Link tab instead.".into());
    }

    let body = response
        .text()
        .await
        .map_err(|_| "That page couldn't be read.".to_string())?;

    Ok(body.chars().take(MAX_PAGE_BYTES).collect())
}

/// The quick pass: yt-dlp's own generic extractor, on the page as given.
///
/// Measured behaviour: finds an embedded player when there is an obvious one,
/// answers "Unsupported URL" otherwise, and never returns more than one item.
/// Both outcomes are normal, so a failure here is not surfaced as an error —
/// it just means the deep pass has something to do.
pub async fn quick(page_url: &str) -> Vec<Found> {
    let args = vec![
        "-J".into(),
        "--flat-playlist".into(),
        "--ignore-errors".into(),
        "--no-warnings".into(),
        page_url.to_string(),
    ];

    let Ok(stdout) = ytdlp::run_ytdlp(args, crate::platform::Platform::Other).await else {
        return Vec::new();
    };

    let Ok(value) = serde_json::from_str::<serde_json::Value>(&stdout) else {
        return Vec::new();
    };

    // The generic extractor answers either with one item or with a playlist
    // wrapper; both shapes show up, so handle both rather than assuming.
    match value.get("entries").and_then(|e| e.as_array()) {
        Some(entries) => entries
            .iter()
            .filter_map(|e| found_from(e, Origin::Embedded))
            .collect(),
        None => found_from(&value, Origin::Embedded).into_iter().collect(),
    }
}

/// The deep pass: harvest the page's links, then ask yt-dlp which it knows.
pub async fn deep(page_url: &str) -> Result<Vec<Found>, String> {
    let html = fetch_page(page_url).await?;

    let base = url_lite::Base::of(page_url)
        .ok_or_else(|| "That doesn't look like a web address.".to_string())?;

    let mut candidates = harvest_links(&html, &base);

    // The page itself is not a candidate: the quick pass already tried it, and
    // including it here would re-run the generic extractor that pass exists for.
    candidates.retain(|c| c.trim_end_matches('/') != page_url.trim_end_matches('/'));

    // Sort likely media links to the front *before* the cap. The harvest is
    // alphabetical, so without this a page whose fonts and CDN assets sort
    // early would spend the whole budget on them and drop the videos — which
    // is exactly what a 300-link page was measured doing.
    candidates.sort_by_key(|u| !looks_like_media(u));
    candidates.truncate(MAX_CANDIDATES);

    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    probe_candidates(&candidates).await
}

/// A cheap guess at whether a URL is worth keeping when the list has to be
/// cut down.
///
/// Only used for ordering, never to reject: yt-dlp remains the judge of what
/// is real. Getting this wrong costs a place in the queue, not a result.
fn looks_like_media(url: &str) -> bool {
    // Static assets are the things that crowd out real links on a big page.
    const ASSET_SUFFIXES: [&str; 12] = [
        ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
        ".woff", ".woff2", ".ttf",
    ];
    let lower = url.to_ascii_lowercase();
    let path = lower.split(['?', '#']).next().unwrap_or(&lower);
    if ASSET_SUFFIXES.iter().any(|s| path.ends_with(s)) {
        return false;
    }

    // Shapes that show up in the URLs of media pages across many sites. Not a
    // site list — that would go stale the moment one changed.
    const HINTS: [&str; 10] = [
        "watch", "video", "embed", "/v/", "player", "episode", "clip", "media",
        "stream", "listen",
    ];
    HINTS.iter().any(|h| lower.contains(h))
}

/// Asks yt-dlp, in one process, which of these URLs it can actually fetch.
///
/// `--use-extractors default,-generic` is what makes this cheap: without it
/// every link would fall through to the generic extractor, which *downloads
/// the page* to look for embeds. With it, a URL that matches no known site is
/// rejected on its shape, before any request. Measured at three URLs: the two
/// unknown ones cost no network time at all.
///
/// `--ignore-errors` keeps one dead link from ending the batch, and `--print`
/// means only the ones that worked produce a line.
async fn probe_candidates(urls: &[String]) -> Result<Vec<Found>, String> {
    let dir = std::env::temp_dir();
    let list_path = dir.join(format!("yt2mp-scan-{}.txt", uuid::Uuid::new_v4()));

    tokio::fs::write(&list_path, urls.join("\n"))
        .await
        .map_err(|_| "Couldn't start the deep scan.".to_string())?;

    // Tab-separated because titles routinely contain every other separator
    // worth choosing. NA is yt-dlp's own placeholder for a field a site did
    // not provide.
    let args = vec![
        "--flat-playlist".into(),
        "--ignore-errors".into(),
        "--no-warnings".into(),
        "--use-extractors".into(),
        "default,-generic".into(),
        // Keeps one channel or playlist link from expanding into hundreds of
        // rows that were never on the page being scanned.
        "--playlist-items".into(),
        ITEMS_PER_COLLECTION.into(),
        // A dead host must not hold the whole batch open; the default wait is
        // far longer than anything this feature can afford.
        "--socket-timeout".into(),
        "10".into(),
        "-a".into(),
        list_path.to_string_lossy().into_owned(),
        "--print".into(),
        "%(webpage_url)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(extractor_key)s".into(),
    ];

    // Measured: ~1.2s per link yt-dlp actually recognises, and rejections are
    // free. MAX_CANDIDATES of real links is the worst case, and this leaves
    // room around it rather than cutting a scan off just before it finishes.
    const DEEP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(240);

    // Partial, not plain: --ignore-errors makes yt-dlp exit non-zero whenever
    // any input failed, and in a batch harvested from a page most inputs are
    // meant to fail. Treating that exit code as fatal discarded every result
    // of a scan that had in fact worked.
    let result =
        ytdlp::run_ytdlp_partial(args, crate::platform::Platform::Other, DEEP_TIMEOUT).await;

    let _ = tokio::fs::remove_file(&list_path).await;

    // A batch where every URL failed still reaches here as an error, and that
    // is an ordinary outcome: it means the page had no media links on it. An
    // empty list is the honest answer to that, not a failure.
    let stdout = result.unwrap_or_default();

    Ok(stdout.lines().filter_map(parse_printed).collect())
}

/// One `--print` line into a result. Returns None for anything malformed
/// rather than guessing, since a half-parsed row would offer a download that
/// cannot work.
fn parse_printed(line: &str) -> Option<Found> {
    let mut parts = line.split('\t');
    let url = parts.next()?.trim();
    if !url.starts_with("http") {
        return None;
    }

    let title = parts.next().unwrap_or("").trim();
    let duration = parts.next().unwrap_or("").trim();
    let uploader = parts.next().unwrap_or("").trim();
    let site = parts.next().unwrap_or("").trim();

    Some(Found {
        url: url.to_string(),
        title: clean_field(title).unwrap_or_else(|| "Untitled".to_string()),
        duration: duration.parse().unwrap_or(0.0),
        uploader: clean_field(uploader).unwrap_or_default(),
        site: clean_field(site).unwrap_or_default(),
        how: Origin::Linked,
    })
}

/// yt-dlp prints the literal string "NA" for a field the site did not supply.
/// Showing that to someone is worse than showing nothing.
fn clean_field(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() || t == "NA" || t == "None" {
        None
    } else {
        Some(t.to_string())
    }
}

/// Builds a result from yt-dlp's JSON, used by the quick pass.
fn found_from(value: &serde_json::Value, how: Origin) -> Option<Found> {
    let url = value
        .get("webpage_url")
        .or_else(|| value.get("url"))
        .and_then(|v| v.as_str())?;

    if !url.starts_with("http") {
        return None;
    }

    Some(Found {
        url: url.to_string(),
        title: value
            .get("title")
            .and_then(|v| v.as_str())
            .and_then(clean_field)
            .unwrap_or_else(|| "Untitled".to_string()),
        duration: value.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0),
        uploader: value
            .get("uploader")
            .or_else(|| value.get("channel"))
            .and_then(|v| v.as_str())
            .and_then(clean_field)
            .unwrap_or_default(),
        site: value
            .get("extractor_key")
            .and_then(|v| v.as_str())
            .and_then(clean_field)
            .unwrap_or_default(),
        how,
    })
}

/// Merges quick and deep results, keeping the first sighting of each URL.
///
/// Order matters: quick results come first because an embedded player is the
/// thing the page was built around, while a link in the body might be a
/// footer. Beyond that the harvest order is preserved, which follows the page.
pub fn merge(quick: Vec<Found>, deep: Vec<Found>) -> Vec<Found> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();

    for item in quick.into_iter().chain(deep) {
        // Compare on a normalised URL so the same video linked twice with and
        // without a trailing slash does not become two rows.
        let key = item.url.trim_end_matches('/').to_string();
        if seen.insert(key) {
            out.push(item);
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> url_lite::Base {
        url_lite::Base::of("https://example.com/docs/page.html").unwrap()
    }

    #[test]
    fn absolute_links_survive_unchanged() {
        let got = base().resolve("https://youtube.com/watch?v=x");
        assert_eq!(got.as_deref(), Some("https://youtube.com/watch?v=x"));
    }

    #[test]
    fn root_relative_links_attach_to_the_host() {
        assert_eq!(
            base().resolve("/videos/1").as_deref(),
            Some("https://example.com/videos/1")
        );
    }

    #[test]
    fn path_relative_links_attach_to_the_directory() {
        assert_eq!(
            base().resolve("clip.html").as_deref(),
            Some("https://example.com/docs/clip.html")
        );
    }

    #[test]
    fn protocol_relative_links_inherit_the_scheme() {
        assert_eq!(
            base().resolve("//cdn.example.com/v").as_deref(),
            Some("https://cdn.example.com/v")
        );
    }

    #[test]
    fn non_page_schemes_are_dropped() {
        for raw in ["mailto:a@b.com", "javascript:void(0)", "#top", ""] {
            assert_eq!(base().resolve(raw), None, "should have dropped {raw}");
        }
    }

    #[test]
    fn harvest_finds_both_hrefs_and_iframe_sources() {
        // The iframe case is the one that matters: embeds live in src, and a
        // harvester that only read href would miss exactly what this feature
        // is for.
        let html = r#"
            <a href="/watch/1">one</a>
            <iframe src="https://www.youtube.com/embed/abc"></iframe>
            <a href='https://vimeo.com/123'>three</a>
        "#;
        let links = harvest_links(html, &base());

        assert!(links.iter().any(|l| l == "https://example.com/watch/1"));
        assert!(links.iter().any(|l| l == "https://www.youtube.com/embed/abc"));
        assert!(links.iter().any(|l| l == "https://vimeo.com/123"));
    }

    #[test]
    fn the_same_link_twice_is_collected_once() {
        let html = r#"<a href="/a">x</a><a href="/a">y</a>"#;
        let links = harvest_links(html, &base());
        assert_eq!(links.iter().filter(|l| l.ends_with("/a")).count(), 1);
    }

    #[test]
    fn printed_lines_become_results() {
        let got = parse_printed("https://youtu.be/x\tA Title\t212\tSomebody\tYoutube").unwrap();
        assert_eq!(got.url, "https://youtu.be/x");
        assert_eq!(got.title, "A Title");
        assert_eq!(got.duration, 212.0);
        assert_eq!(got.uploader, "Somebody");
        assert_eq!(got.site, "Youtube");
    }

    #[test]
    fn yt_dlps_na_placeholder_never_reaches_the_user() {
        let got = parse_printed("https://youtu.be/x\tA Title\tNA\tNA\tYoutube").unwrap();
        assert_eq!(got.duration, 0.0);
        assert_eq!(got.uploader, "");
    }

    #[test]
    fn malformed_lines_are_skipped_rather_than_guessed() {
        assert!(parse_printed("not-a-url\tTitle\t1\tx\ty").is_none());
        assert!(parse_printed("").is_none());
    }

    #[test]
    fn escaped_ampersands_are_decoded_before_the_url_is_used() {
        // A well-formed page writes this link exactly this way, so this is the
        // normal case rather than a malformed one.
        let html = r#"<a href="https://site.com/watch?v=x&amp;t=90">x</a>"#;
        let links = harvest_links(html, &base());
        assert!(links.iter().any(|l| l == "https://site.com/watch?v=x&t=90"));
    }

    #[test]
    fn json_only_listings_still_yield_links() {
        // Measured: a YouTube channel page carries no href for its videos at
        // all — they exist only in the embedded JSON.
        let html = r#"{"videoId":"dQw4w9WgXcQ","other":1}"#;
        let links = harvest_links(html, &base());
        assert!(links
            .iter()
            .any(|l| l == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
    }

    #[test]
    fn a_value_that_is_not_an_id_never_becomes_a_link() {
        let html = r#"{"videoId":"short"}{"videoId":"way-too-long-to-be-real"}"#;
        assert!(find_all_video_ids(html).is_empty());
    }

    #[test]
    fn assets_rank_below_probable_media_links() {
        assert!(looks_like_media("https://s.com/watch?v=1"));
        assert!(looks_like_media("https://s.com/embed/abc"));
        assert!(!looks_like_media("https://s.com/app.js"));
        assert!(!looks_like_media("https://s.com/logo.png"));
        // The query string must not make an asset look like a video.
        assert!(!looks_like_media("https://s.com/main.css?v=watch"));
    }

    #[test]
    fn merge_prefers_the_embedded_sighting_and_drops_repeats() {
        let one = Found {
            url: "https://youtu.be/x".into(),
            title: "Embedded".into(),
            duration: 1.0,
            uploader: String::new(),
            site: "Youtube".into(),
            how: Origin::Embedded,
        };
        let two = Found {
            url: "https://youtu.be/x/".into(),
            title: "Linked".into(),
            how: Origin::Linked,
            ..one.clone()
        };

        let merged = merge(vec![one], vec![two]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].how, Origin::Embedded);
    }
}

/// Exercised by `cargo test -- --ignored --nocapture`, not in the normal run:
/// these go out to the live internet, so they belong to a person checking the
/// feature by hand rather than to CI, which must not fail because a site was
/// slow or a page changed.
#[cfg(test)]
mod live {
    use super::*;

    #[tokio::test]
    #[ignore = "hits the network"]
    async fn a_page_of_videos_yields_its_videos() {
        let found = deep("https://www.youtube.com/@RickAstleyYT/videos")
            .await
            .expect("the scan should not error");

        println!("found {} item(s)", found.len());
        for f in found.iter().take(10) {
            println!("  {} [{}s] {}", f.title, f.duration, f.url);
        }

        assert!(
            !found.is_empty(),
            "a channel's video page should yield videos"
        );
    }

    #[tokio::test]
    #[ignore = "hits the network"]
    async fn a_page_with_no_media_says_so_rather_than_failing() {
        let found = deep("https://example.com/").await.expect("not an error");
        println!("example.com yielded {} item(s)", found.len());
        assert!(found.is_empty());
    }
}
