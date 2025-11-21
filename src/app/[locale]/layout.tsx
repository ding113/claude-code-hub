import type { Metadata } from "next";
import "../globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Footer } from "@/components/customs/footer";
import { AppProviders } from "../providers";
import { getSystemSettings } from "@/repository/system-config";
import { logger } from "@/lib/logger";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { locales, type Locale } from "@/i18n/config";
import { notFound } from "next/navigation";

const FALLBACK_TITLE = "Claude Code Hub";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  try {
    const settings = await getSystemSettings();
    const title = settings.siteTitle?.trim() || FALLBACK_TITLE;

    // Generate alternates for all locales
    const alternates: Record<string, string> = {};
    const baseUrl = process.env.APP_URL || "http://localhost:13500";

    locales.forEach((loc) => {
      alternates[loc] = `${baseUrl}/${loc}`;
    });

    return {
      title,
      description: title,
      alternates: {
        canonical: `${baseUrl}/${locale}`,
        languages: alternates,
      },
      openGraph: {
        title,
        description: title,
        locale,
        alternateLocale: locales.filter((l) => l !== locale),
      },
    };
  } catch (error) {
    logger.error("Failed to load system settings for metadata", { error });
    return {
      title: FALLBACK_TITLE,
      description: FALLBACK_TITLE,
    };
  }
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  // Validate locale
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  // Load translation messages
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="antialiased">
        <NextIntlClientProvider messages={messages}>
          <AppProviders>
            <div className="flex min-h-screen flex-col bg-background text-foreground">
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
            <Toaster />
          </AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}
