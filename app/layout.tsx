import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "只属于我们的烟火",
    template: "%s · Firework Night",
  },
  description: "坐在实时 3D 魔法王城的露台，为喜欢的人编排一场可以写字、画图案的专属烟花。",
  openGraph: {
    title: "只属于我们的烟火",
    description: "坐在星月王城的露台，为喜欢的人放一场专属烟花。",
    type: "website",
    images: [{ url: "/og-castle.png", width: 1536, height: 900, alt: "魔法王城露台上的双人烟花夜" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "只属于我们的烟火",
    description: "坐在星月王城的露台，为喜欢的人放一场专属烟花。",
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
