import { redirect } from "@/i18n/routing";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;
  return redirect({ href: "/dashboard", locale });
}
