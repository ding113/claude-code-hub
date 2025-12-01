import { redirect } from "next/navigation";
import { getUsers } from "@/actions/users";
import { getSession } from "@/lib/auth";
import { UsersPageClient } from "./users-page-client";

export default async function UsersPage() {
  const session = await getSession();

  // Redirect unauthenticated users
  if (!session) {
    redirect("/login");
  }

  const users = await getUsers();

  return <UsersPageClient users={users} currentUser={session.user} />;
}
