//! Getting around a broken YouTube cache server.
//!
//! Many ISPs host a Google cache inside their own network, and YouTube sends
//! each viewer's media requests to the one nearest them first. When that box
//! is broken, every download fails before a single byte arrives. Measured on
//! a Turkish connection: extraction worked, the media URL pointed at a cache
//! node inside the ISP, and every TLS client refused its handshake — OpenSSL
//! with "invalid session id", BoringSSL (curl_cffi) with DECODE_ERROR,
//! Windows' own curl with nothing at all. TLS 1.2 simply hung. The same node
//! failed with any SNI, so it is the server, not a filter on the name.
//!
//! Browsers never notice: they fetch video over QUIC, and when that fails
//! too the YouTube player moves on to the next server named in the URL's
//! `mn` list. yt-dlp does neither, so it retried the dead node ten times and
//! gave up with "invalid session id (_ssl.c:1007)".
//!
//! This module does what the player does. Each media URL carries its own
//! fallback list (`mn=<first>,<second>`); the host is `rr<N>---<first>`, and
//! swapping in `<second>` reaches a server outside the broken cache that
//! accepts the same signed request. Verified against the node above: the
//! swapped URL redirected once and served the bytes (HTTP 206).

use std::sync::atomic::{AtomicBool, Ordering};

/// Set once a cache node has failed this session. A broken node stays broken
/// for hours, so every later download goes straight to the fallback instead
/// of burning ten retries to rediscover it.
static CACHE_BROKEN: AtomicBool = AtomicBool::new(false);

pub fn mark_broken() {
    CACHE_BROKEN.store(true, Ordering::Relaxed);
}

pub fn is_broken() -> bool {
    CACHE_BROKEN.load(Ordering::Relaxed)
}

/// True when the connection died during the TLS handshake — the one failure
/// a different server can fix. Covers each TLS stack yt-dlp may use: Python's
/// ssl module (urllib/requests), curl_cffi, and a handshake that just stalls.
pub fn is_tls_failure(err: &str) -> bool {
    let e = err.to_ascii_lowercase();
    e.contains("_ssl.c")
        || e.contains("[ssl:")
        || e.contains("ssl: ")
        || e.contains("tls connect error")
        || e.contains("ssl connect error")
        || e.contains("handshake operation timed out")
        || e.contains("_ssl_handshake")
}

fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v)
}

/// The same media URL on the next server in its own fallback list, or `None`
/// when it is not a googlevideo URL on its first-choice server.
///
/// Only the host changes (plus `fallback_count`, which is what the player
/// sends when it moves on). Everything signed — the path and the rest of the
/// query — is left exactly as YouTube issued it.
pub fn reroute_url(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let (host, tail) = rest.split_once('/')?;
    let (prefix, node) = host.strip_suffix(".googlevideo.com")?.split_once("---")?;
    // `rr3`, `r3`: the per-video index in front of the node name.
    if !prefix.starts_with('r')
        || !prefix
            .trim_start_matches('r')
            .chars()
            .all(|c| c.is_ascii_digit())
    {
        return None;
    }

    let query = tail.split_once('?').map(|(_, q)| q)?;
    let mn = query_param(query, "mn")?
        .replace("%2C", ",")
        .replace("%2c", ",");
    let mut nodes = mn.split(',').filter(|n| !n.is_empty());
    let first = nodes.next()?;
    let second = nodes.next()?;
    // Already on a fallback — nothing further down the list to try.
    if node != first {
        return None;
    }

    let mut out = format!("https://{prefix}---{second}.googlevideo.com/{tail}");
    if query_param(query, "fallback_count").is_none() {
        out.push_str("&fallback_count=1");
    }
    Some(out)
}

/// Rewrites every first-choice googlevideo URL anywhere in a yt-dlp info
/// document, returning how many changed. Walks the whole tree rather than
/// naming fields so a format's `url`, a DASH `fragment_base_url` and any
/// fragment URLs are all caught without tracking yt-dlp's schema.
pub fn reroute_info(value: &mut serde_json::Value) -> usize {
    match value {
        serde_json::Value::String(s) => match reroute_url(s) {
            Some(new) => {
                *s = new;
                1
            }
            None => 0,
        },
        serde_json::Value::Array(items) => items.iter_mut().map(reroute_info).sum(),
        serde_json::Value::Object(map) => map.values_mut().map(reroute_info).sum(),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BROKEN: &str = "https://rr3---sn-u0g3n5u-3t5e.googlevideo.com/videoplayback?expire=1&itag=140&mn=sn-u0g3n5u-3t5e%2Csn-ajnv4c-5p&mvi=3&sig=AB%3D";

    #[test]
    fn a_first_choice_url_moves_to_the_next_server() {
        assert_eq!(
            reroute_url(BROKEN).as_deref(),
            Some("https://rr3---sn-ajnv4c-5p.googlevideo.com/videoplayback?expire=1&itag=140&mn=sn-u0g3n5u-3t5e%2Csn-ajnv4c-5p&mvi=3&sig=AB%3D&fallback_count=1")
        );
    }

    #[test]
    fn a_url_already_on_the_fallback_is_left_alone() {
        let moved = reroute_url(BROKEN).unwrap();
        assert_eq!(reroute_url(&moved), None);
    }

    #[test]
    fn a_url_with_no_fallback_is_left_alone() {
        let single = "https://rr3---sn-abc.googlevideo.com/videoplayback?mn=sn-abc&x=1";
        assert_eq!(reroute_url(single), None);
    }

    #[test]
    fn other_hosts_are_never_touched() {
        for url in [
            "https://manifest.googlevideo.com/api/manifest/hls?mn=a%2Cb",
            "https://i.ytimg.com/vi/x/maxresdefault.jpg",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://evil.example/rr3---a.googlevideo.com/x?mn=a%2Cb",
        ] {
            assert_eq!(reroute_url(url), None, "{url}");
        }
    }

    #[test]
    fn every_url_in_an_info_document_is_rerouted() {
        let mut info = serde_json::json!({
            "title": "x",
            "thumbnail": "https://i.ytimg.com/vi/x/a.jpg",
            "formats": [
                { "url": BROKEN },
                { "url": BROKEN, "fragment_base_url": BROKEN },
                { "url": "https://manifest.googlevideo.com/api/manifest/hls" }
            ],
            "requested_formats": [{ "url": BROKEN }]
        });
        assert_eq!(reroute_info(&mut info), 4);
        assert!(!info.to_string().contains("rr3---sn-u0g3n5u-3t5e"));
        assert_eq!(info["thumbnail"], "https://i.ytimg.com/vi/x/a.jpg");
    }

    #[test]
    fn handshake_failures_are_recognised_from_every_tls_stack() {
        for e in [
            "ERROR: [download] Got error: [SSL: INVALID_SESSION_ID] invalid session id (_ssl.c:1007). Giving up after 10 retries",
            "ERROR: [download] Got error: Failed to perform, curl: (35) TLS connect error: error:10000089:SSL routines:OPENSSL_internal:DECODE_ERROR.",
            "ERROR: [download] Got error: _ssl.c:980: The handshake operation timed out",
        ] {
            assert!(is_tls_failure(e), "{e}");
        }
        for e in [
            "ERROR: HTTP Error 403: Forbidden",
            "ERROR: Video unavailable",
        ] {
            assert!(!is_tls_failure(e), "{e}");
        }
    }
}
