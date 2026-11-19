import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fonts are committed (latin variable subsets, SIL OFL 1.1, see ./fonts/README.md) so builds and the desktop app need no network.
const inter = localFont({
  src: "./fonts/Inter-latin-wght.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});
// The calibration face: monospace, so label widths are exact. Not preloaded: only calibration frames use it.
const calMono = localFont({
  src: "./fonts/JetBrainsMono-latin-wght.woff2",
  variable: "--font-cal-mono",
  weight: "100 800",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "Pixel Lab",
  description: "LED pixel mapping and content templates for live events.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${calMono.variable} dark h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
