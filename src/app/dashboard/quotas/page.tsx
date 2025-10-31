import { redirect } from "next/navigation";

export default function QuotasPage() {
  redirect("/dashboard/quotas/users");
}
