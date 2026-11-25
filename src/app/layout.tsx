import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BenchMark · A clearer view of your lab",
  description: "Scan products, track remaining quantities, and collaborate with your lab.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "BenchMark" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#174c3c" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
