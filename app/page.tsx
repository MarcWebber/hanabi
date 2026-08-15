import type { Metadata } from "next";
import { headers } from "next/headers";
import { FireworkExperience } from "@/src/fireworks/FireworkExperience";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const previewImage = `${protocol}://${host}/og.png`;

  return {
    title: "只属于我们的烟火",
    description: "一场可以亲手写字、画图案，也可以两个人一起坐着看的 3D 烟花秀。",
    openGraph: {
      title: "只属于我们的烟火",
      description: "坐近一点，今晚的星光会记得我们。",
      type: "website",
      locale: "zh_CN",
      images: [{ url: previewImage, width: 1672, height: 941, alt: "湖畔双人烟花夜" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "只属于我们的烟火",
      description: "一场可以亲手写字、画图案的实时 3D 烟花秀。",
      images: [previewImage],
    },
  };
}

export default function Home() {
  return <FireworkExperience />;
}
