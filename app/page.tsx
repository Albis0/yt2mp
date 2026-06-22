import AdSidebar from "@/components/AdSidebar";

// Direct-download link for the Windows installer, hosted on Google Drive. The
// installer is large enough that Drive shows a "can't scan for viruses" warning
// page on the normal link; the drive.usercontent.google.com host with
// confirm=t skips that and serves the .exe directly as an attachment.
const DOWNLOAD_URL =
    "https://drive.usercontent.google.com/download?id=1RBWQJEYGNC9Fn3WZTvBEprTB5a1dWFqK&export=download&confirm=t";

export default function Home() {
    return (
        <div className="page">
            <main className="main-content">
                <h1 className="brand">
                    yt<span className="brand-accent">2</span>mp
                </h1>
                <p className="tagline">A clean, ad-free YouTube to MP3/MP4 downloader — now a desktop app.</p>
                <div className="download-cta">
                    <a className="download-btn" href={DOWNLOAD_URL}>
                        Download for Windows
                    </a>
                    <p className="download-note">Runs entirely on your computer — no upload limits, no waiting on a shared server.</p>
                </div>
            </main>
            <AdSidebar />
        </div>
    );
}
