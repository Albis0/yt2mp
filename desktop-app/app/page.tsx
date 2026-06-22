import Image from "next/image";
import DownloadForm from "@/components/DownloadForm";

export default function Home() {
  return (
    <div className="page">
      <header className="app-header">
        <Image
          className="app-logo"
          src="/icon.png"
          alt=""
          width={40}
          height={40}
          priority
        />
        <div className="app-title">
          <h1 className="brand">
            yt<span className="brand-accent">2</span>mp
          </h1>
          <p className="tagline">Paste a YouTube link, preview it, save MP3 or MP4.</p>
        </div>
      </header>
      <main className="main-content">
        <DownloadForm />
      </main>
    </div>
  );
}
