"use client";

import {useState} from "react";

// A single shell command shown in a mono box with a copy button. Clicking
// copies the raw command (without the leading "$") to the clipboard and
// briefly confirms.
export default function CopyCommand({command}: {command: string}) {
    const [copied, setCopied] = useState(false);

    async function copy() {
        try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
        } catch {
            // clipboard blocked (e.g. insecure context) — leave the text selectable
        }
    }

    return (
        <div className="cmd">
            <code className="cmd-text">{command}</code>
            <button type="button" className="cmd-copy" onClick={copy} aria-label="Copy command">
                {copied ? "copied" : "copy"}
            </button>
        </div>
    );
}
