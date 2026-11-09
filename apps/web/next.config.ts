import type { NextConfig } from "next";

// As PaperTrail: Next bundles @repo/types (its built CommonJS dist/) for the browser. Sentry's wrapper is Phase 32.
const nextConfig: NextConfig = {
  transpilePackages: ["@repo/types"],
};

export default nextConfig;
