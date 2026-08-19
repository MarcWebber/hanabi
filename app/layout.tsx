import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "花火",
    template: "%s · 花火",
  },
  description: "在月港露台并肩坐下，看一场只属于你们的烟火。",
  openGraph: {
    title: "花火",
    description: "在月港露台并肩坐下，看一场只属于你们的烟火。",
    type: "website",
    images: [{ url: "/og-castle.png", width: 1536, height: 900, alt: "月港露台实时烟花场景" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "花火",
    description: "在月港露台并肩坐下，看一场只属于你们的烟火。",
    images: ["/og-castle.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
