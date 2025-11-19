// This page has been deprecated. Key-level quotas are now managed at user level.
// Users should visit /dashboard/quotas/users instead.
// Redirecting to user quotas page...

import { redirect } from "next/navigation";

export default async function KeysQuotaPage() {
  redirect("/dashboard/quotas/users");
}
