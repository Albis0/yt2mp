//! Spotify links, downloaded from YouTube Music.
//!
//! Spotify's own audio is DRM-protected and yt-dlp has no Spotify extractor,
//! so the audio comes from YouTube Music: the track's name, artists and
//! length are read from Spotify's public embed page, the same song is looked
//! up in YouTube Music's "Songs" search (label uploads, the same master as
//! Spotify's, not music videos or fan re-uploads), and the result is checked
//! before anything downloads.
//!
//! The check is the whole point. Taking the first search hit is how a
//! Spotify link turns into a cover, a live take or a sped-up edit. Every
//! candidate is scored on title, artist and length, and when Groq
//! verification keys are configured a model makes the final call on the
//! top few. Nothing that fails both is downloaded: "not found" beats the
//! wrong song.

use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::Duration;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                  (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const TIMEOUT: Duration = Duration::from_secs(12);

/// Length difference past which a candidate is not the same recording,
/// whatever its title says. Radio edits and album versions differ by a few
/// seconds; a different arrangement differs by more.
const MAX_LENGTH_GAP: f64 = 20.0;

/// Lowest score accepted without the model's say-so.
const ACCEPT: f64 = 0.62;

/// A score this high is taken even if the model says "none of these": the
/// title, the artist and the length all agree, and a model answer is
/// cheaper to be wrong than that.
const CERTAIN: f64 = 0.9;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Track,
    Album,
    Playlist,
}

impl Kind {
    fn path(self) -> &'static str {
        match self {
            Kind::Track => "track",
            Kind::Album => "album",
            Kind::Playlist => "playlist",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Link {
    pub kind: Kind,
    pub id: String,
}

#[derive(Debug, Clone)]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artists: Vec<String>,
    /// Seconds.
    pub duration: f64,
    pub cover: Option<String>,
}

impl Track {
    pub fn artist_line(&self) -> String {
        self.artists.join(", ")
    }

    /// "Artist - Title", the file name people expect for a song.
    pub fn file_title(&self) -> String {
        if self.artists.is_empty() {
            self.title.clone()
        } else {
            format!("{} - {}", self.artist_line(), self.title)
        }
    }

    pub fn url(&self) -> String {
        format!("https://open.spotify.com/track/{}", self.id)
    }
}

pub struct Collection {
    pub id: String,
    pub title: String,
    pub tracks: Vec<Track>,
}

/// One YouTube Music "Songs" result.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub video_id: String,
    pub title: String,
    pub artists: String,
    pub album: Option<String>,
    pub duration: Option<f64>,
}

impl Candidate {
    pub fn watch_url(&self) -> String {
        format!("https://www.youtube.com/watch?v={}", self.video_id)
    }

    fn describe(&self) -> String {
        let mut s = format!("{} — {}", self.title, self.artists);
        if let Some(album) = &self.album {
            s.push_str(&format!(" — {album}"));
        }
        if let Some(d) = self.duration {
            s.push_str(&format!(" — {}", clock(d)));
        }
        s
    }
}

fn clock(seconds: f64) -> String {
    let s = seconds.round() as u64;
    format!("{}:{:02}", s / 60, s % 60)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())
}

// ---------- Links ----------

/// Reads a Spotify link: `open.spotify.com/(intl-xx/)(embed/)track/<id>`,
/// the same for albums and playlists, or a `spotify:track:<id>` URI.
pub fn parse(url: &str) -> Option<Link> {
    let url = url.trim();
    if let Some(rest) = url.strip_prefix("spotify:") {
        let mut parts = rest.split(':');
        return link_from(parts.next()?, parts.next()?);
    }

    let after = url.split_once("://")?.1;
    let (host, path) = after.split_once('/').unwrap_or((after, ""));
    let host = host.to_ascii_lowercase();
    if host != "open.spotify.com" && host != "play.spotify.com" {
        return None;
    }
    let path = path.split(['?', '#']).next().unwrap_or("");
    let mut segs = path.split('/').filter(|s| !s.is_empty()).peekable();
    if segs.peek().is_some_and(|s| s.starts_with("intl-")) {
        segs.next();
    }
    if segs.peek() == Some(&"embed") {
        segs.next();
    }
    link_from(segs.next()?, segs.next()?)
}

fn link_from(kind: &str, id: &str) -> Option<Link> {
    let kind = match kind {
        "track" => Kind::Track,
        "album" => Kind::Album,
        "playlist" => Kind::Playlist,
        _ => return None,
    };
    let valid = id.len() >= 16 && id.chars().all(|c| c.is_ascii_alphanumeric());
    valid.then(|| Link { kind, id: id.to_string() })
}

/// Short share links (spotify.link, spotify.app.link) redirect to the real
/// one. Anything else is read as it is.
pub async fn resolve(url: &str) -> Result<Link, String> {
    if let Some(link) = parse(url) {
        return Ok(link);
    }
    let res = client()?
        .get(url.trim())
        .send()
        .await
        .map_err(|_| "Couldn't open that Spotify link.".to_string())?;
    if let Some(link) = parse(res.url().as_str()) {
        return Ok(link);
    }
    // Some share links land on a page that redirects in its markup instead.
    let body = res.text().await.unwrap_or_default();
    body.split("https://open.spotify.com/")
        .skip(1)
        .find_map(|rest| parse(&format!("https://open.spotify.com/{}", rest.split('"').next()?)))
        .ok_or_else(|| "That isn't a Spotify song, album or playlist link.".to_string())
}

// ---------- Spotify metadata ----------

/// The `entity` object from Spotify's embed page, which carries the track
/// or the whole track list without a login or an API key.
async fn embed_entity(link: &Link) -> Result<Value, String> {
    let url = format!("https://open.spotify.com/embed/{}/{}", link.kind.path(), link.id);
    let html = client()?
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| "Couldn't reach Spotify. Check the link, or try again.".to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    entity_from_html(&html)
}

fn entity_from_html(html: &str) -> Result<Value, String> {
    const OPEN: &str = r#"<script id="__NEXT_DATA__" type="application/json">"#;
    let unreadable = || "Spotify's page has changed. Check for updates in Settings.".to_string();
    let start = html.find(OPEN).ok_or_else(unreadable)? + OPEN.len();
    let end = html[start..].find("</script>").ok_or_else(unreadable)? + start;
    let data: Value = serde_json::from_str(&html[start..end]).map_err(|_| unreadable())?;
    data.pointer("/props/pageProps/state/data/entity")
        .cloned()
        .ok_or_else(|| "That Spotify link doesn't exist, or it's private.".to_string())
}

fn largest_image(entity: &Value) -> Option<String> {
    let images = entity
        .pointer("/visualIdentity/image")
        .or_else(|| entity.pointer("/coverArt/sources"))?
        .as_array()?;
    images
        .iter()
        .max_by_key(|i| i.get("maxWidth").or_else(|| i.get("width")).and_then(Value::as_u64))
        .and_then(|i| i.get("url"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").trim().to_string()
}

pub async fn track(id: &str) -> Result<Track, String> {
    let entity = embed_entity(&Link { kind: Kind::Track, id: id.to_string() }).await?;
    track_from_entity(&entity, id)
}

fn track_from_entity(e: &Value, id: &str) -> Result<Track, String> {
    let title = Some(text(e, "title"))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| text(e, "name"));
    if title.is_empty() {
        return Err("That Spotify link doesn't exist, or it's private.".into());
    }
    let artists = e
        .get("artists")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|x| text(x, "name")).filter(|n| !n.is_empty()).collect())
        .unwrap_or_default();
    Ok(Track {
        id: id.to_string(),
        title,
        artists,
        duration: e.get("duration").and_then(Value::as_f64).unwrap_or(0.0) / 1000.0,
        cover: largest_image(e),
    })
}

pub async fn collection(link: &Link) -> Result<Collection, String> {
    let entity = embed_entity(link).await?;
    let cover = largest_image(&entity);
    let tracks: Vec<Track> = entity
        .get("trackList")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter(|t| t.get("entityType").and_then(Value::as_str) == Some("track"))
                .filter_map(|t| {
                    let id = text(t, "uri").strip_prefix("spotify:track:")?.to_string();
                    Some(Track {
                        id,
                        title: text(t, "title"),
                        artists: text(t, "subtitle")
                            .split(", ")
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(str::to_string)
                            .collect(),
                        duration: t.get("duration").and_then(Value::as_f64).unwrap_or(0.0)
                            / 1000.0,
                        cover: cover.clone(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    if tracks.is_empty() {
        return Err("That Spotify list is empty, or it's private.".into());
    }
    let title = Some(text(&entity, "title"))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| text(&entity, "name"));
    Ok(Collection { id: link.id.clone(), title, tracks })
}

// ---------- YouTube Music search ----------

/// YouTube Music's own search, filtered to "Songs". One request returns the
/// title, artists, album and length of each result, which yt-dlp's flat
/// search does not; without the length there is nothing to check a match
/// against.
pub async fn search_songs(query: &str) -> Result<Vec<Candidate>, String> {
    let body = json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20250101.01.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "query": query,
        // The "Songs" filter.
        "params": "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"
    });
    let value: Value = client()?
        .post("https://music.youtube.com/youtubei/v1/search?prettyPrint=false")
        .header("Origin", "https://music.youtube.com")
        .json(&body)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| "Couldn't reach YouTube Music. Check your connection.".to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    collect_candidates(&value, &mut out);
    Ok(out)
}

fn collect_candidates(v: &Value, out: &mut Vec<Candidate>) {
    match v {
        Value::Object(map) => {
            if let Some(item) = map.get("musicResponsiveListItemRenderer") {
                if let Some(c) = candidate_from(item) {
                    if !out.iter().any(|x| x.video_id == c.video_id) {
                        out.push(c);
                    }
                }
            }
            for child in map.values() {
                collect_candidates(child, out);
            }
        }
        Value::Array(list) => list.iter().for_each(|c| collect_candidates(c, out)),
        _ => {}
    }
}

fn column_runs(item: &Value, index: usize) -> Vec<String> {
    item.pointer(&format!(
        "/flexColumns/{index}/musicResponsiveListItemFlexColumnRenderer/text/runs"
    ))
    .and_then(Value::as_array)
    // Untrimmed: artists arrive as "A", " & ", "B" and the spaces matter.
    .map(|runs| {
        runs.iter()
            .map(|r| r.get("text").and_then(Value::as_str).unwrap_or("").to_string())
            .collect()
    })
    .unwrap_or_default()
}

fn candidate_from(item: &Value) -> Option<Candidate> {
    let video_id = item
        .pointer("/playlistItemData/videoId")
        .and_then(Value::as_str)?
        .to_string();
    let title = column_runs(item, 0).concat();
    // "Artist • Album • 3:34", as runs with "•" separators between.
    let mut segments: Vec<String> = vec![String::new()];
    for run in column_runs(item, 1) {
        if run.trim() == "•" {
            segments.push(String::new());
        } else if let Some(last) = segments.last_mut() {
            last.push_str(&run);
        }
    }
    let mut segments: Vec<String> = segments
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if segments.first().is_some_and(|s| s == "Song") {
        segments.remove(0);
    }
    let duration = segments.last().and_then(|s| parse_clock(s));
    if duration.is_some() {
        segments.pop();
    }
    let artists = if segments.is_empty() { String::new() } else { segments.remove(0) };
    Some(Candidate {
        video_id,
        title,
        artists,
        album: segments.first().cloned(),
        duration,
    })
}

fn parse_clock(s: &str) -> Option<f64> {
    let parts: Vec<u64> = s.split(':').map(|p| p.parse().ok()).collect::<Option<_>>()?;
    match parts.as_slice() {
        [m, s] => Some((m * 60 + s) as f64),
        [h, m, s] => Some((h * 3600 + m * 60 + s) as f64),
        _ => None,
    }
}

// ---------- Matching ----------

/// Words that mark a different recording of the same song. A candidate is
/// only penalised for one when the Spotify title does not have it too.
const OTHER_VERSION: &[&str] = &[
    "live", "cover", "remix", "karaoke", "instrumental", "sped", "slowed", "nightcore", "8d",
    "acoustic", "reverb", "tribute", "lofi", "piano", "orchestral", "mashup", "bootleg",
];

/// Lowercase words, with "(feat. X)" / "[with X]" and punctuation gone.
fn words(s: &str) -> Vec<String> {
    let lower = s.to_lowercase();
    let mut kept = String::new();
    let mut depth = 0i32;
    let mut bracket = String::new();
    for c in lower.chars() {
        match c {
            '(' | '[' => {
                depth += 1;
                bracket.clear();
            }
            ')' | ']' if depth > 0 => {
                depth -= 1;
                let b = bracket.trim();
                // A bracket naming featured artists says nothing about which
                // recording it is; anything else ("Live", "Remix") does.
                if !(b.starts_with("feat") || b.starts_with("ft") || b.starts_with("with ")) {
                    kept.push(' ');
                    kept.push_str(b);
                }
                kept.push(' ');
            }
            _ if depth > 0 => bracket.push(c),
            _ => kept.push(c),
        }
    }
    kept.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty() && *w != "feat" && *w != "ft")
        .map(str::to_string)
        .collect()
}

/// Share of `want`'s words that appear in `have`.
fn coverage(want: &[String], have: &[String]) -> f64 {
    if want.is_empty() {
        return 0.0;
    }
    let have: HashSet<&String> = have.iter().collect();
    want.iter().filter(|w| have.contains(w)).count() as f64 / want.len() as f64
}

/// 0..1: how likely `c` is the same recording as `t`, or `None` when its
/// length rules it out.
pub fn score(t: &Track, c: &Candidate) -> Option<f64> {
    let gap = match c.duration {
        Some(d) if t.duration > 0.0 => (d - t.duration).abs(),
        _ => 10.0,
    };
    if gap > MAX_LENGTH_GAP {
        return None;
    }
    let length = if gap <= 3.0 {
        1.0
    } else if gap <= 8.0 {
        0.7
    } else {
        0.35
    };

    let want = words(&t.title);
    let have = words(&c.title);
    // Both directions: all of Spotify's title present, and not much else.
    let title = 0.65 * coverage(&want, &have) + 0.35 * coverage(&have, &want);

    let main = t.artists.first().map(|a| words(a)).unwrap_or_default();
    let credited = words(&c.artists);
    let artist = coverage(&main, &credited);

    let penalty = OTHER_VERSION
        .iter()
        .filter(|w| have.iter().any(|h| h == *w) && !want.iter().any(|x| x == *w))
        .count() as f64
        * 0.35;

    // The artist is a gate, not just a weight: "Never Gonna Give You Up" by
    // "Rick Roll", three seconds off, is otherwise a near-perfect score.
    // Scripts YouTube Music romanises differently land here too, and are the
    // model's to decide.
    let gate = if artist >= 0.99 { 1.0 } else { 0.6 };
    Some(((0.45 * title + 0.35 * artist + 0.2 * length) * gate - penalty).clamp(0.0, 1.0))
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CheckedBy {
    Model,
    Score,
}

#[derive(Debug, Clone)]
pub struct Match {
    pub candidate: Candidate,
    /// Read by the live test, which reports how each match was decided.
    #[cfg_attr(not(test), allow(dead_code))]
    pub checked_by: CheckedBy,
}

/// Finds `t` on YouTube Music, or says it could not.
pub async fn find(t: &Track) -> Result<Match, String> {
    let main = t.artists.first().cloned().unwrap_or_default();
    let mut found = search_songs(&format!("{} {}", t.artist_line(), t.title)).await?;
    if found.is_empty() {
        found = search_songs(&format!("{} {main}", t.title)).await?;
    }

    let mut ranked: Vec<(f64, Candidate)> = found
        .into_iter()
        .take(10)
        .filter_map(|c| score(t, &c).map(|s| (s, c)))
        .collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
    ranked.truncate(5);

    let not_found = || {
        format!(
            "Couldn't find \"{}\" on YouTube Music. It may not be there, or only as a cover or a live version.",
            t.title
        )
    };
    let Some((best_score, best)) = ranked.first().cloned() else {
        return Err(not_found());
    };

    if crate::groq::can_verify() {
        let described = format!(
            "{} — {} — {}",
            t.title,
            t.artist_line(),
            clock(t.duration)
        );
        let list: Vec<String> = ranked.iter().map(|(_, c)| c.describe()).collect();
        match crate::groq::verify_match(&described, &list).await {
            Ok(crate::groq::Verdict::Same(i)) => {
                return Ok(Match {
                    candidate: ranked[i].1.clone(),
                    checked_by: CheckedBy::Model,
                });
            }
            Ok(crate::groq::Verdict::NoneMatch) if best_score < CERTAIN => {
                return Err(not_found());
            }
            // A certain score overrides a "none", and an unreachable model
            // falls back to the score alone.
            _ => {}
        }
    }

    if best_score >= ACCEPT {
        Ok(Match { candidate: best, checked_by: CheckedBy::Score })
    } else {
        Err(not_found())
    }
}

/// The YouTube address a Spotify track link downloads from.
pub async fn youtube_url(url: &str) -> Result<String, String> {
    let link = resolve(url).await?;
    if link.kind != Kind::Track {
        return Err("Open the list and download its songs one by one.".into());
    }
    let t = track(&link.id).await?;
    Ok(find(&t).await?.candidate.watch_url())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(title: &str, artists: &[&str], duration: f64) -> Track {
        Track {
            id: "x".into(),
            title: title.into(),
            artists: artists.iter().map(|a| a.to_string()).collect(),
            duration,
            cover: None,
        }
    }

    fn c(title: &str, artists: &str, duration: f64) -> Candidate {
        Candidate {
            video_id: "v".into(),
            title: title.into(),
            artists: artists.into(),
            album: None,
            duration: Some(duration),
        }
    }

    #[test]
    fn links_are_read_in_every_shape() {
        let track = Some(Link { kind: Kind::Track, id: "4cOdK2wGLETKBW3PvgPWqT".into() });
        assert_eq!(parse("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"), track);
        assert_eq!(
            parse("https://open.spotify.com/intl-tr/track/4cOdK2wGLETKBW3PvgPWqT?si=abc"),
            track
        );
        assert_eq!(parse("spotify:track:4cOdK2wGLETKBW3PvgPWqT"), track);
        assert_eq!(
            parse("https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT"),
            track
        );
        assert_eq!(
            parse("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M").map(|l| l.kind),
            Some(Kind::Playlist)
        );
        assert_eq!(parse("https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt"), None);
        assert_eq!(parse("https://evil.com/track/4cOdK2wGLETKBW3PvgPWqT"), None);
    }

    /// The results YouTube Music really returned for this song, measured.
    #[test]
    fn the_original_beats_covers_and_other_songs() {
        let song = t("Never Gonna Give You Up", &["Rick Astley"], 213.6);
        let original = score(&song, &c("Never Gonna Give You Up", "Rick Astley", 214.0)).unwrap();
        assert!(original >= CERTAIN, "{original}");

        let tribute = score(&song, &c("Never Gonna Give You Up", "Rick Roll", 217.0)).unwrap();
        let instrumental = score(
            &song,
            &c("Never Gonna Give You Up (Instrumental Version)", "Rick Roll", 217.0),
        )
        .unwrap();
        let other = score(&song, &c("Never Give You Up", "Jerry Butler", 176.0));
        assert!(tribute < ACCEPT, "{tribute}");
        assert!(instrumental < tribute, "{instrumental}");
        assert!(other.is_none(), "37 s longer is a different recording");
    }

    #[test]
    fn featured_artists_do_not_count_against_a_match() {
        let song = t("Stay (with Justin Bieber)", &["The Kid LAROI", "Justin Bieber"], 141.8);
        let s = score(&song, &c("STAY", "The Kid LAROI & Justin Bieber", 142.0)).unwrap();
        assert!(s >= ACCEPT, "{s}");
    }

    #[test]
    fn a_live_take_needs_live_in_the_spotify_title() {
        let studio = t("Yellow", &["Coldplay"], 266.0);
        let live = c("Yellow (Live)", "Coldplay", 270.0);
        let as_studio = score(&studio, &live).unwrap();
        let as_live = score(&t("Yellow - Live", &["Coldplay"], 268.0), &live).unwrap();
        assert!(as_studio < ACCEPT, "{as_studio}");
        assert!(as_live >= ACCEPT, "{as_live}");
    }

    #[test]
    fn search_columns_are_split_into_fields() {
        let item = json!({
            "playlistItemData": { "videoId": "lYBUbBu4W08" },
            "flexColumns": [
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [
                    { "text": "Never Gonna Give You Up" }
                ]}}},
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [
                    { "text": "Rick Astley" }, { "text": " • " },
                    { "text": "Whenever You Need Somebody" }, { "text": " • " },
                    { "text": "3:34" }
                ]}}}
            ]
        });
        let c = candidate_from(&item).unwrap();
        assert_eq!(c.video_id, "lYBUbBu4W08");
        assert_eq!(c.artists, "Rick Astley");
        assert_eq!(c.album.as_deref(), Some("Whenever You Need Somebody"));
        assert_eq!(c.duration, Some(214.0));
    }

    /// Spotify and YouTube Music end to end: a real link, a real search.
    ///
    /// ```text
    /// cargo test --lib -- --ignored --nocapture spotify_finds
    /// ```
    #[tokio::test]
    #[ignore = "hits the network"]
    async fn spotify_finds_the_original_on_youtube_music() {
        crate::groq::init(None, None);
        for (url, expect) in [
            ("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT", "Rick Astley"),
            ("https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b", "The Weeknd"),
        ] {
            let link = resolve(url).await.unwrap();
            let song = track(&link.id).await.unwrap();
            let m = find(&song).await.unwrap();
            eprintln!("{} → {:?} ({:?})", song.file_title(), m.candidate, m.checked_by);
            assert!(m.candidate.artists.contains(expect), "{:?}", m.candidate);
        }
        let list = collection(&parse("https://open.spotify.com/album/5Z9iiGl2FcIfa3BMiv6OIw").unwrap())
            .await
            .unwrap();
        assert_eq!(list.tracks.len(), 10);
    }
}
