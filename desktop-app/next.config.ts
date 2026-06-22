import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Without this, Next's file tracer walks up to the monorepo root and can
  // sweep up sibling build output (e.g. this project's own release/ folder)
  // into the standalone bundle. Pinning the root to this project keeps the
  // trace scoped to just what the server actually needs.
  outputFileTracingRoot: path.join(__dirname),
  outputFileTracingExcludes: {
    "*": ["release/**", "resources/**", "dist/**"],
  },
};

export default nextConfig;
