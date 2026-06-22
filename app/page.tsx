import AdSidebar from "@/components/AdSidebar";

const LATEST_RELEASE_URL = "https://github.com/Albis0/yt2mp/releases/latest";

export default function Home() {
  return (
    <div className="page">
      <main className="main-content">
        <h1 className="brand">
          yt<span className="brand-accent">2</span>mp
        </h1>
        <p className="tagline">
          A clean, ad-free YouTube to MP3/MP4 downloader — now a desktop app.
        </p>
        <div className="download-cta">
          <a className="download-btn" href={LATEST_RELEASE_URL}>
            Download for Windows
          </a>
          <p className="download-note">
            Runs entirely on your computer — no upload limits, no waiting on a
            shared server.
          </p>
        </div>
      </main>
      <AdSidebar />
    </div>
  );
}
