import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Default bottom-left collides with InfoControl's "?" button; top-left is
  // the one corner nothing else in the app anchors to. Dev-only, no effect
  // on production builds.
  devIndicators: { position: "top-left" },
};

export default nextConfig;
