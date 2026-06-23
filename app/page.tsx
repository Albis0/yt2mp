import Image from "next/image";
import AdSidebar from "@/components/AdSidebar";

// Primary download: GitHub Releases. Fast CDN, no size warnings, and "latest"
// always points at the newest published release.
const GITHUB_URL =
    "https://github.com/Albis0/yt2mp/releases/latest/download/yt2mp.Setup.0.2.0.exe";

// Mirror: Google Drive. The installer is large enough that Drive shows a
// "can't scan for viruses" page on the normal link; the
// drive.usercontent.google.com host with confirm=t serves the .exe directly.
const DRIVE_URL =
    "https://drive.usercontent.google.com/download?id=1qhIZLx50r7vCBT5mHZ1r0Z2NCIU73JYQ&export=download&confirm=t";

const REPO_URL = "https://github.com/Albis0/yt2mp";
const LICENSE_URL = "https://github.com/Albis0/yt2mp/blob/main/LICENSE";
const METADEFENDER_URL =
    "https://metadefender.com/results/file/YnpJMk1EWXlNekZKTUZkVVR6Rk9WV28xWkVsd1YwWlBZMGhNX21kYWFzYTdlMGQ0Y2U1Ng/threats-prevented";

// SHA256 of the current installer (yt2mp Setup 0.2.0.exe), so visitors can verify
// what they downloaded without leaving the page.
const INSTALLER_SHA256 =
    "4f6056135aee5cb8df0647a24465d001090220621cb3b18c4444c490b8a23771";

// A static waveform — bar heights chosen by hand so it reads as audio, not a
// random chart. Rendered as ambient motion behind the hero.
const WAVE = [
    18, 34, 52, 30, 64, 88, 56, 40, 72, 96, 60, 38, 26, 48, 80, 100, 70, 44, 28, 54,
    76, 92, 58, 36, 22, 46, 68, 84, 50, 32, 60, 90, 66, 42, 24, 38, 56, 74, 40, 20,
];

export default function Home() {
    return (
        <div className="page">
            <main className="main-content">
                <div className="hero" aria-hidden={false}>
                    <div className="wave" aria-hidden="true">
                        {WAVE.map((h, i) => (
                            <span
                                key={i}
                                className="wave-bar"
                                style={{
                                    height: `${h}%`,
                                    animationDelay: `${(i % 10) * 0.09}s`,
                                }}
                            />
                        ))}
                    </div>

                    <div className="hero-mark">
                        <Image
                            src="/icon.png"
                            alt="yt2mp"
                            width={96}
                            height={96}
                            priority
                        />
                    </div>

                    <h1 className="brand">
                        yt<span className="brand-accent">2</span>mp
                    </h1>
                    <p className="tagline">
                        Pull the audio or video out of any YouTube link — clean, ad-free,
                        and running entirely on your own machine.
                    </p>

                    <div className="download-cta">
                        <a className="download-btn" href={GITHUB_URL}>
                            <span className="download-btn-icon" aria-hidden="true">
                                ↓
                            </span>
                            Download for Windows
                        </a>
                        <p className="download-note">
                            Free · Windows 10/11 · ~210&nbsp;MB · yt-dlp + ffmpeg bundled
                        </p>
                        <div className="source-icons">
                            <a
                                className="source-icon"
                                href={DRIVE_URL}
                                title="Download from Google Drive"
                                aria-label="Download from Google Drive"
                            >
                                <svg viewBox="0 0 87.3 78" width="22" height="22" aria-hidden="true">
                                    <path
                                        fill="#0066da"
                                        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
                                    />
                                    <path
                                        fill="#00ac47"
                                        d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z"
                                    />
                                    <path
                                        fill="#ea4335"
                                        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
                                    />
                                    <path
                                        fill="#00832d"
                                        d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z"
                                    />
                                    <path
                                        fill="#2684fc"
                                        d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
                                    />
                                    <path
                                        fill="#ffba00"
                                        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
                                    />
                                </svg>
                                <span>Drive</span>
                            </a>
                            <a
                                className="source-icon"
                                href={REPO_URL}
                                target="_blank"
                                rel="noreferrer"
                                title="View source on GitHub"
                                aria-label="View source on GitHub"
                            >
                                <svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor" aria-hidden="true">
                                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                                </svg>
                                <span>GitHub</span>
                            </a>
                        </div>
                    </div>
                </div>

                <ul className="features">
                    <li className="feature">
                        <span className="feature-key">Local</span>
                        <p>
                            Runs on your computer, not a shared server. No queue, no upload
                            cap, no &quot;come back later.&quot;
                        </p>
                    </li>
                    <li className="feature">
                        <span className="feature-key">Clean</span>
                        <p>
                            No ads, no fake download buttons, no redirects. Paste a link,
                            pick MP3 or MP4, done.
                        </p>
                    </li>
                    <li className="feature">
                        <span className="feature-key">Ready</span>
                        <p>
                            yt-dlp and ffmpeg ship inside the app. Nothing else to install
                            or configure.
                        </p>
                    </li>
                </ul>

                <footer className="site-footer">
                    <p className="footer-trust">
                        {METADEFENDER_URL ? (
                            <a href={METADEFENDER_URL} target="_blank" rel="noreferrer">
                                Virus scan (MetaDefender)
                            </a>
                        ) : (
                            <span className="footer-muted">Virus scan: coming soon</span>
                        )}
                        <span className="footer-dot">·</span>
                        <a href={REPO_URL} target="_blank" rel="noreferrer">
                            Source on GitHub
                        </a>
                        <span className="footer-dot">·</span>
                        <a href={LICENSE_URL} target="_blank" rel="noreferrer">
                            GPL-3.0
                        </a>
                    </p>
                    <p className="footer-hash">
                        SHA256 (yt2mp Setup 0.2.0.exe):{" "}
                        <code>{INSTALLER_SHA256}</code>
                    </p>
                    <p className="footer-disclaimer">
                        Free, open-source software provided as is, without warranty. You
                        are responsible for what you download; only save content you have
                        the right to. Downloading from YouTube may violate its Terms of
                        Service.
                    </p>
                </footer>
            </main>
            <AdSidebar />
        </div>
    );
}
