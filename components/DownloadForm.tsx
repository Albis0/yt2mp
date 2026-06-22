"use client";

import {useState} from "react";
import type {VideoInfo} from "@/lib/ytdlp";
import ResultCard from "./ResultCard";

export default function DownloadForm() {
    const [url, setUrl] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<VideoInfo | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setInfo(null);

        if (!url.trim()) return;

        setLoading(true);
        try {
            const res = await fetch("/api/info", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({url: url.trim()}),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error ?? "Something went wrong.");
                return;
            }
            setInfo(data);
        } catch {
            setError("Could not connect to the server.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="download-form-wrap">
            <form className="download-form" onSubmit={handleSubmit}>
                <input type="text" placeholder="Paste a YouTube link..." value={url} onChange={(e) => setUrl(e.target.value)} className="url-input" autoFocus />
                <button type="submit" className="submit-btn" disabled={loading}>
                    {loading ? "Fetching..." : "Fetch"}
                </button>
            </form>

            {error ?
                <p className="error-text">{error}</p>
            :   null}
            {info ?
                <ResultCard info={info} url={url.trim()} />
            :   null}
        </div>
    );
}
