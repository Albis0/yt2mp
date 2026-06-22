import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output and bundled binaries — not our source.
    "release/**",
    "resources/**",
    "electron/dist/**",
    // Node CommonJS build scripts use require() by design.
    "scripts/**",
  ]),
]);

export default eslintConfig;
