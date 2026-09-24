import type { NextConfig } from "next";

/**
 * Product photos come from Supabase Storage. Only this project's public
 * Storage path is allowed through next/image, so the optimiser cannot be used
 * to fetch arbitrary URLs.
 */
const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321");

const nextConfig: NextConfig = {
  // A phone on the same Wi-Fi reaches `npm run dev:lan` at the PC's private
  // IP (README, "Testing on a phone"). Development only; a production build
  // ignores it. `*` is one label of the hostname, so these cover the private
  // IPv4 ranges.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
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
};

export default nextConfig;
