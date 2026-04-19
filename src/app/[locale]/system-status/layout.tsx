import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { getTranslations } from "next-intl/server";

type SystemStatusLayoutParams = { locale: string };

const systemStatusDisplay = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-system-status-display",
  display: "swap",
});

const systemStatusMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-system-status-mono",
  display: "swap",
});

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
  return (
    <div className={`${systemStatusDisplay.variable} ${systemStatusMono.variable}`}>{children}</div>
  );
}
