import { cookies } from "next/headers";
import { defaultLocale, localeCookieName } from "@/i18n/config";
import { getLocaleFromValue } from "@/i18n/pathname";
import { redirect } from "@/i18n/routing";

// 根路径没有根 layout（各语言的根 layout 位于 [locale]/layout.tsx），因此用 Route Handler 按语言 cookie 跳转
export async function GET() {
  const cookieStore = await cookies();
  const locale = getLocaleFromValue(cookieStore.get(localeCookieName)?.value) || defaultLocale;

  redirect({ href: "/dashboard", locale });
}
