import type { NextConfig } from "next";

/**
 * Product photos come from Supabase Storage. Only this project's public
 * Storage path is allowed through next/image, so the optimiser cannot be used
 * to fetch arbitrary URLs.
 */
const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321");

const nextConfig: NextConfig = {
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
