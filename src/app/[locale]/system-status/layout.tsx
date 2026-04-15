import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

type SystemStatusLayoutParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<SystemStatusLayoutParams> | SystemStatusLayoutParams;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "systemStatus" });

  return {
    title: t("pageTitle"),
    description: t("pageDescription"),
  };
}

export default function SystemStatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
