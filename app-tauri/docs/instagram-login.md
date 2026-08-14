# Instagram / TikTok login

## What was built

A **Settings modal** (gear icon, top-right of the tab strip) whose primary
control is a single button: **"Find my login automatically"**. It tries every
installed browser against a login-gated Instagram post and saves the first one
that is actually signed in. A manual browser list stays available underneath
as an override. The choice persists to `settings.json` in the app config
directory.

- `src-tauri/src/browsers.rs` — detection incl. forks, profile picking
- `src-tauri/src/settings.rs` — storage, validation, `cookie_browser()`
- `src-tauri/src/ytdlp.rs` — `probe_browser()` and outcome classification
- `src-tauri/src/lib.rs` — `find_working_browser`, `detected_browsers`, `browser_label`
- `src/components/SettingsPanel.tsx` — the modal
- `src/lib/api.ts` — bindings (snake_case ↔ camelCase conversion lives here only)

## Browser forks

yt-dlp only knows eight browser names. Forks are handled by passing the base
engine plus an explicit profile path, which is what
`--cookies-from-browser firefox:/path/to/profile` is for:

| Fork | Passed as |
|---|---|
| Zen, LibreWolf, Waterfox, Floorp | `firefox:<profile path>` |
| Opera GX, Arc, Thorium | `chrome:<user data path>` |

For Firefox-family browsers the profile with the **most recently modified
`cookies.sqlite`** is chosen — installs routinely carry several profiles and
all but one are stale.

Probe order puts Firefox-family browsers first, because Chromium browsers lock
their cookie database while running and would fail for a reason unrelated to
whether they hold a login.

## Outcome classification

`probe_browser()` fetches a gated post with `--simulate` and classifies:

| Outcome | Detected from | Meaning shown |
|---|---|---|
| `Works` | exit 0 | signed in — saved |
| `Locked` | "could not copy … cookie database" | close this browser and retry |
| `NotSignedIn` | "empty media response", "not granting access", "login required" | not signed in there |
| `Failed` | anything else | yt-dlp's own first error line |

Reading the cookie *file* is not sufficient evidence — "the file was readable"
and "the site accepts this session" are different questions, and only the
second matters. That is why the probe makes a real request.

## What was deliberately not built

**A username/password login form.** yt-dlp's own documentation advises against
password login for Instagram: logins from an unrecognised client are flagged
and accounts get locked or banned. It is also indistinguishable in shape from
a credential-phishing screen. The cookie approach reaches the same posts
without the app ever handling a credential.

## Scope of cookie use

`platform_args()` only attaches `--cookies-from-browser` when
`needs_login(platform)` is true — Instagram and TikTok. YouTube, X, Twitch and
"other" links never carry the session. This is enforced by the test
`only_login_gated_sites_receive_cookies`.

`YT2MP_COOKIES_FROM` still works and takes precedence over the stored setting,
so existing .env setups keep working and a temporary override is possible.

## Verified on this machine

| Check | Result |
|---|---|
| Detection | Found **Firefox**, **Zen**, **Edge** — Zen correctly resolved to `firefox:…\zen\Profiles\bnjn00y6.Default (release)` |
| Probe order | Firefox-family listed before Edge, as intended |
| Firefox cookie extraction | **Works** — read without error, YouTube fetch succeeded |
| Zen cookie extraction | **Works** — read without error via the profile path |
| Instagram via Firefox | `empty media response` → classified `NotSignedIn` ✓ |
| Instagram via Zen | `empty media response` → classified `NotSignedIn` ✓ |
| Instagram via Edge (running) | `Could not copy Chrome cookie database` → classified `Locked` ✓ |
| Rust tests | 35 passed |
| TypeScript | Clean |

Zen's cookie store was inspected directly: **zero** `instagram.com` cookies,
no `sessionid`. So `NotSignedIn` is the factually correct verdict there, not a
misclassification.

## Root cause of the current Instagram failure (2026-08-13)

**The login works. Instagram's API is refusing yt-dlp's authenticated request.**

Evidence, all from live runs against the user's Zen profile:

```
Extracted 411 cookies from firefox
[debug] [Instagram] Found Instagram account cookies
ERROR: [Instagram] DAqU8ZBRtvW: Video info extraction failed: HTTP Error 400
```

The decisive comparison:

| Request | Result |
|---|---|
| **No cookies** | `Instagram sent an empty media response` |
| **With Zen cookies** | `HTTP Error 400: Bad Request` |

The error *changes* when the session is attached, which means the cookies are
being sent and recognised. Zen's cookie store was re-checked and does contain
`sessionid` and `ds_user_id` — the earlier "0 Instagram cookies" reading was
wrong, produced by a `strings` command that was not installed and silently
returned nothing.

Ruled out:
- **Not the yt-dlp version** — bundled 2026.07.04 is the latest *stable*, and
  nightly 2026.08.04 fails identically.
- **Not the user-agent** — fails with and without the mobile UA.
- **Not a dead probe post** — three different reels all return 400 with
  cookies; the same URLs return "empty media response" without them.
- **Not extractor args** — `api_version=v1` and `app_id=…` both still 400.
- yt-dlp additionally reports Instagram's *user* extractor as
  "marked as broken" upstream.

Nothing in this codebase can fix that. It resolves when yt-dlp ships an
updated Instagram extractor.

### What was changed in response

1. **New outcome `SignedInButBlocked`** (HTTP 400/401 after cookies were
   accepted). Previously this surfaced as a raw `HTTP Error 400` string in the
   results list, and the summary line wrongly told the user to sign in again —
   advice that cannot help someone who is already signed in.
2. **Fixed: a failed browser stayed saved.** The panel showed
   "Currently using Zen" directly above a row saying Zen had failed, because
   the setting was only ever written on success and a stale manual choice
   survived. `find_working_browser` now always writes the result of the check,
   clearing the setting when nothing passed.
3. **Probe now tries two posts.** A single hard-coded reel can be deleted, and
   a deleted post fails for every browser — indistinguishable from "no browser
   is signed in". A second URL is tried unless the first gave a verdict that is
   definitely about the browser (`Works` or `Locked`).

## Open item — no end-to-end success yet

Every classification path was verified against real yt-dlp output, but the
`Works` path has **not** been observed, because no browser on this machine is
signed in to Instagram. Cookie extraction itself is proven working (same flag,
same browsers, YouTube succeeded).

**To confirm the success path**, someone must:
1. Sign in to Instagram in any browser (if Edge/Chrome, fully quit it after).
2. Open the gear → "Find my login automatically".
3. Expect a green ✓ next to that browser, then fetch an Instagram reel.

Until that happens, the success branch is **built and unit-tested but
unobserved in the wild**. The TikTok warning dot is unrelated — an upstream
extractor breakage that cookies will not fix.

## Known sharp edge

Chromium-family browsers (Edge, Chrome, Brave) lock their cookie database
while running, so the user must close the browser before downloading. The
settings panel states this under the choice buttons whenever a browser is
selected. Firefox does not have this restriction.
