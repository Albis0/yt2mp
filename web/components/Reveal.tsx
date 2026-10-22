"use client";

import {useEffect, useRef} from "react";

// Fades a block in once, the first time it scrolls into view. Without
// JavaScript, or with reduced motion, the block is simply there: the hidden
// state is only ever applied by this component after it has mounted.
export default function Reveal({
    children,
    className = "",
    delay = 0,
}: {
    children: React.ReactNode;
    className?: string;
    delay?: number;
}) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        // Already on screen at load (the top of the page): leave it alone.
        if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;

        el.dataset.reveal = "hidden";
        const seen = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) return;
                el.dataset.reveal = "shown";
                seen.disconnect();
            },
            {threshold: 0.12, rootMargin: "0px 0px -6% 0px"},
        );
        seen.observe(el);
        return () => seen.disconnect();
    }, []);

    return (
        <div ref={ref} className={className} style={delay ? {transitionDelay: `${delay}ms`} : undefined}>
            {children}
        </div>
    );
}
