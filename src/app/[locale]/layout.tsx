import type { Metadata } from "next";
import "../globals.css";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Footer } from "@/components/customs/footer";
import { Toaster } from "@/components/ui/sonner";
import { type Locale, locales } from "@/i18n/config";
import { logger } from "@/lib/logger";
import {
  resolveLayoutTimeZone,
  resolveSiteMetadataSource,
} from "@/lib/public-status/layout-metadata";
import { DEFAULT_SITE_TITLE } from "@/lib/site-title";
import { AppProviders } from "../providers";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const headersStore = await headers();
  const isPublicStatusRequest = headersStore.get("x-cch-public-status") === "1";

  try {
    const metadata = await resolveSiteMetadataSource({ isPublicStatusRequest });
    const title = metadata?.siteTitle?.trim() || DEFAULT_SITE_TITLE;
    const description = metadata?.siteDescription?.trim() || DEFAULT_SITE_TITLE;

    // Generate alternates for all locales
    const alternates: Record<string, string> = {};
    const baseUrl = process.env.APP_URL || "http://localhost:13500";

    locales.forEach((loc) => {
      alternates[loc] = `${baseUrl}/${loc}`;
    });

    return {
      title,
      description,
      alternates: {
        canonical: `${baseUrl}/${locale}`,
        languages: alternates,
      },
      openGraph: {
        title,
        description,
        locale,
        alternateLocale: locales.filter((l) => l !== locale),
      },
    };
  } catch (error) {
    logger.error("Failed to load metadata", { error });
    return {
      title: DEFAULT_SITE_TITLE,
      description: DEFAULT_SITE_TITLE,
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
  const headersStore = await headers();
  const isPublicStatusRequest = headersStore.get("x-cch-public-status") === "1";

  // Validate locale
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  // Load translation messages
  const messages = await getMessages();
  const timeZone = await resolveLayoutTimeZone({ isPublicStatusRequest });
  // Create a stable `now` timestamp to avoid SSR/CSR hydration mismatch for relative time
  const now = new Date();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="antialiased">
        <NextIntlClientProvider messages={messages} timeZone={timeZone} now={now}>
          <AppProviders>
            <div className="flex min-h-[var(--cch-viewport-height,100vh)] flex-col bg-background text-foreground">
              <div className="flex-1">{children}</div>
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
