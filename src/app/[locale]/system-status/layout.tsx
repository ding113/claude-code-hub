import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";

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

const SYSTEM_STATUS_FONT_STACKS: CSSProperties = {
  ["--font-system-status-display-stack" as string]:
    'var(--font-system-status-display), "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif',
  ["--font-system-status-mono-stack" as string]:
    'var(--font-system-status-mono), "SFMono-Regular", Consolas, "Liberation Mono", Menlo, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", monospace',
};

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
    <div
      className={`${systemStatusDisplay.variable} ${systemStatusMono.variable}`}
      style={SYSTEM_STATUS_FONT_STACKS}
    >
      {children}
    </div>
  );
}
