import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @tab/shared ships TypeScript source with no build step.
  transpilePackages: ["@tab/shared"],
};

export default nextConfig;
