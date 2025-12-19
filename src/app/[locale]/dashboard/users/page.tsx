import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { UsersPageClient } from "./users-page-client";

export default async function UsersPage() {
  const session = await getSession();

  // Redirect unauthenticated users
  if (!session) {
    redirect("/login");
  }

  return <UsersPageClient currentUser={session.user} />;
}
