import type { NextConfig } from "next";

const config: NextConfig = {
  // @tab/shared ships TypeScript source with no build step.
  transpilePackages: ["@tab/shared"],
  // Cybersource SDK relies on node internals/dynamic requires; keep it out of the bundle.
  serverExternalPackages: ["cybersource-rest-client"],
};

export default config;
