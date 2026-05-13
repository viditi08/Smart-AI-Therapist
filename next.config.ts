import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /** Prefer this app as tracing root when other lockfiles exist nearby. */
  outputFileTracingRoot: root,
  /**
   * Do not set `transpilePackages: ["@google/genai"]`: it merges node + web
   * entrypoints and can trigger dev/runtime "__webpack_modules__[id] is not a function"
   * with stale `.next`. Client uses `@google/genai/web` (prebuilt `dist/web`).
   */
};

export default nextConfig;
