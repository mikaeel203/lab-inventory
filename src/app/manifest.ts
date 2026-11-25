import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BenchMark", short_name: "BenchMark", description: "Your lab, accounted for.",
    start_url: "/", display: "standalone", background_color: "#f5f6f2", theme_color: "#174c3c",
    icons: [
      { src: "/icon192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
