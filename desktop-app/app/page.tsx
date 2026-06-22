import DownloadForm from "@/components/DownloadForm";

export default function Home() {
  return (
    <div className="page">
      <main className="main-content">
        <h1 className="brand">
          yt<span className="brand-accent">2</span>mp
        </h1>
        <p className="tagline">Paste a YouTube link, download it as MP3 or MP4.</p>
        <DownloadForm />
      </main>
    </div>
  );
}
