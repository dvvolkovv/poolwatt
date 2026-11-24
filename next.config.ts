import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // US-01 allows a 20 MB document; the default server-action body limit is
    // 1 MB, which would reject every real licence scan.
    serverActions: { bodySizeLimit: "24mb" },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "cdn.poolwatt.com" },
    ],
  },
};

export default withNextIntl(nextConfig);
