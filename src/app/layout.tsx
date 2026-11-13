import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
// The calibration face: monospace, so label widths are exact. Not preloaded: only calibration frames use it.
const calMono = JetBrains_Mono({ variable: "--font-cal-mono", subsets: ["latin"], preload: false });

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
