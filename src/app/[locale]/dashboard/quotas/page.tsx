import { redirect } from "@/i18n/routing";

export default function QuotasPage() {
  redirect("/dashboard/quotas/users" as any);
}
