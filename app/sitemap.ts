import type {MetadataRoute} from "next";
import {SITE_URL} from "@/lib/site";

// Single-page site: one entry. lastModified tracks the release so crawlers
// re-fetch when a new version ships rather than on every deploy.
export default function sitemap(): MetadataRoute.Sitemap {
    return [
        {
            url: SITE_URL,
            lastModified: new Date(),
            changeFrequency: "monthly",
            priority: 1,
        },
    ];
}
