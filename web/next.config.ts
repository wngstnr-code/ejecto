import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The repo has a single env file at its root (see docs/build-and-deploy.md).
loadEnvConfig(path.resolve(__dirname, ".."));

// GitHub Pages serves the site under /<repo>. Set NEXT_PUBLIC_BASE_PATH=/ejecto for that build.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  agentRules: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
