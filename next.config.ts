import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Agent SDK is reached only through the worker subprocess. Listing it
  // here ensures Next.js never tries to bundle it into a client/server bundle.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
