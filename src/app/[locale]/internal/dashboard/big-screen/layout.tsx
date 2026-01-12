import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

type BigScreenParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<BigScreenParams> | BigScreenParams;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "bigScreen" });
  return {
    title: t("pageTitle"),
    description: t("pageDescription"),
  };
}

export default function BigScreenLayout({ children }: { children: React.ReactNode }) {
  // 全屏布局，移除所有导航栏、侧边栏等元素
  return <>{children}</>;
}
