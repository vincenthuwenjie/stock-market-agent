import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./data/influencer-and-press-collection-agent/**/*"],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
