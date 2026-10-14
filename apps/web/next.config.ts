import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The shared package is TypeScript source in this workspace.
  transpilePackages: ["@pos/shared"],
};

export default nextConfig;
