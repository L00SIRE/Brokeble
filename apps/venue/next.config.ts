import type { NextConfig } from "next";

const config: NextConfig = {
  // @tab/shared ships TypeScript source with no build step.
  transpilePackages: ["@tab/shared"],
  // Cybersource SDK relies on node internals/dynamic requires; keep it out of the bundle.
  serverExternalPackages: ["cybersource-rest-client"],
  async headers() {
    return [
      {
        source: "/pay/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin" }, // token path never leaks in Referer; origin still sent (UNVERIFIED with Microform)
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
    ];
  },
  // No CSP: it would block Microform's script and iframes unless tuned.
};

export default config;
