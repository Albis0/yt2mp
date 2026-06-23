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
    "https://drive.usercontent.google.com/download?id=1RBWQJEYGNC9Fn3WZTvBEprTB5a1dWFqK&export=download&confirm=t";

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
                        <p className="download-mirror">
                            Download not starting?{" "}
                            <a href={DRIVE_URL}>Get it from Google Drive</a> instead.
                        </p>
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
            </main>
            <AdSidebar />
        </div>
    );
}
