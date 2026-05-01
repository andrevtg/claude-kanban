import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Agent SDK is reached only through the worker subprocess. Listing it
  // here ensures Next.js never tries to bundle it into a client/server bundle.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  // tsconfig uses NodeNext, so source files import siblings with a `.js`
  // specifier. Teach the bundler to resolve those to `.ts`/`.tsx` on disk.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".mjs", ".cjs"],
  },
};

export default nextConfig;
