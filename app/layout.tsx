import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "只属于我们的烟火",
    template: "%s · Firework Night",
  },
  description: "在实时 3D 湖畔，为喜欢的人放一场可以写字、画图案的专属烟花。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
