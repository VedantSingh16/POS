import type { NextConfig } from "next";

const posAssetPrefix = process.env.POS_ASSET_PREFIX?.trim();

const nextConfig: NextConfig = {
  output: "standalone",
  // The shared package is TypeScript source in this workspace.
  transpilePackages: ["@pos/shared"],
  assetPrefix: posAssetPrefix || undefined,
  async rewrites() {
    return {
      afterFiles: [
        { source: "/:lang(en|ar)/app/pos", destination: "/" },
        { source: "/:lang(en|ar)/app/pos/:path*", destination: "/:path*" },
      ],
    };
  },
};

export default nextConfig;
