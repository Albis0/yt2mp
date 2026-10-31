"use client";

import {useEffect, useRef, useState, type ReactNode} from "react";

type Target = {name: string; href: string; icon: ReactNode};

// The hero's Download button. On an Android phone it simply downloads the APK.
// Anywhere else one click splits it: the three platform icons sitting inside
// the pill grow out into their own buttons, one per download.
export default function DownloadSplit({targets, fallbackHref}: {targets: Target[]; fallbackHref: string}) {
    const [open, setOpen] = useState(false);
    const [android, setAndroid] = useState(false);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setAndroid(/android/i.test(navigator.userAgent));
    }, []);

    useEffect(() => {
        if (!open) return;
        const away = (e: Event) => {
            if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("pointerdown", away);
        document.addEventListener("keydown", away);
        return () => {
            document.removeEventListener("pointerdown", away);
            document.removeEventListener("keydown", away);
        };
    }, [open]);

    if (android) {
        const apk = targets.find((t) => t.name === "Android")!;
        return (
            <a className="btn btn-solid" href={apk.href} download>
                Download
                <span className="dl-os-inline">{apk.icon}</span>
            </a>
        );
    }

    // Closed: any tap opens the split instead of following the link.
    const guard = (e: React.MouseEvent) => {
        if (!open) {
            e.preventDefault();
            setOpen(true);
        }
    };

    return (
        <div ref={root} className={`dl${open ? " open" : ""}`} role="group" aria-label="Download yt2mp">
            <a className="dl-main" href={fallbackHref} onClick={guard} aria-expanded={open}>
                Download
            </a>
            {targets.map((t, i) => (
                <a
                    key={t.name}
                    className="dl-os"
                    data-os={t.name.toLowerCase()}
                    href={t.href}
                    title={t.name}
                    aria-label={`Download for ${t.name}`}
                    style={{transitionDelay: `${open ? 50 + i * 50 : 0}ms`}}
                    onClick={guard}
                    tabIndex={open ? 0 : -1}
                >
                    {t.icon}
                </a>
            ))}
        </div>
    );
}
