import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /** Prefer this app as tracing root when other lockfiles exist nearby. */
  outputFileTracingRoot: root,
};

export default nextConfig;
