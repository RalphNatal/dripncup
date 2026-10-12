import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

import { staticSecurityHeaders } from "./src/lib/security/headers";

/**
 * Product photos come from Supabase Storage. Only this project's public
 * Storage path is allowed through next/image, so the optimiser cannot be used
 * to fetch arbitrary URLs.
 */
const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321");
const production = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // A phone on the same Wi-Fi reaches `npm run dev:lan` at the PC's private
  // IP (README, "Testing on a phone"). Development only; a production build
  // ignores it. `*` is one label of the hostname, so these cover the private
  // IPv4 ranges.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
  poweredByHeader: false,
  // Admin image uploads go through a Server Action (src/lib/admin/images.ts):
  // 5 MB images plus the multipart overhead.
  experimental: {
    serverActions: { bodySizeLimit: "6mb" },
  },
  images: {
    remotePatterns: [
      {
        protocol: supabaseUrl.protocol === "https:" ? "https" : "http",
        hostname: supabaseUrl.hostname,
        port: supabaseUrl.port,
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  /**
   * Security headers on every response; the Content Security Policy is per
   * request (it carries a nonce), so src/proxy.ts sets it. Brand images in
   * public/ are not content-hashed, so they are cached for a week rather
   * than forever (`npm run brand:assets` rewrites them in place). The
   * service worker script must always be re-checked, or an update could
   * hide behind the browser cache.
   */
  async headers() {
    return [
      { source: "/:path*", headers: staticSecurityHeaders({ production }) },
      {
        source: "/:dir(icons|splash)/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      {
        source: "/serwist/:path*",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; object-src 'none'" },
        ],
      },
    ];
  },
};

// Serwist bundles the service worker with esbuild from a route handler
// (src/app/serwist/[path]/route.ts); this keeps esbuild out of the server bundle.
export default withSerwist(nextConfig);
