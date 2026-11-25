import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.BENCHMARK_TEST_BUILD === "1" ? ".next-test" : ".next",
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        { key: "Cache-Control", value: "private, no-store" },
      ],
    }];
  },
};

export default config;
