# Security Policy

## Supported versions

Only the **latest release** is supported. Older releases are removed from the
[releases page](https://github.com/Albis0/yt2mp/releases) when a new one ships,
and the app updates itself, so "upgrade to the current version" is the fix for
anything found in an older build.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Anything older | No — update instead |

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/Albis0/yt2mp/security/advisories/new)
(Security tab → Advisories → Report a vulnerability). That creates a private
thread visible only to you and the maintainer.

Please include:

- What the flaw lets an attacker do, and what access they need to start.
- Steps to reproduce, or a proof of concept.
- The app version and OS.

You will get a first response within a week. This is a spare-time project with
one maintainer, so a fix may take longer than that — you will be told where it
stands rather than left waiting. If a report turns out to be valid and you want
credit in the release notes, say so and you will get it.

## What is in scope

The desktop app and the release pipeline:

- Anything letting a **pasted link** cause code execution, arbitrary file
  writes outside the chosen download folder, or path traversal.
- **Browser cookie handling.** With the Instagram feature enabled the app reads
  a live browser session. Any way that data could leak — written to disk
  unencrypted, sent anywhere, exposed to another process — is in scope.
- **The updater.** Signature verification is what stands between a user and a
  malicious binary. Anything weakening it is the highest-severity report this
  project can receive.
- **The bundled binaries** (yt-dlp, ffmpeg, quickjs) as they are fetched and
  invoked — a way to make the app fetch or run something else is in scope.
- API keys or tokens leaking from the built installer.

## What is out of scope

- **Vulnerabilities in yt-dlp or ffmpeg themselves.** Report those upstream:
  [yt-dlp](https://github.com/yt-dlp/yt-dlp/security),
  [ffmpeg](https://ffmpeg.org/security.html). The app can only ship a newer
  version, which is what "Update yt-dlp" in Settings does.
- **Antivirus false positives on the installer.** The `.exe` is unsigned and
  spawns yt-dlp, which some engines flag heuristically. Real, but not a
  vulnerability — see the README's virus-scan section.
- **The landing page**, which is static and holds no user data.
- Anything requiring an attacker to already have code execution on the user's
  machine, or physical access to an unlocked session.
- Reports that a site's terms of service can be broken with this tool. That is
  a licensing question, not a security one.
