import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUsers } from "@/actions/users";
import { getSession } from "@/lib/auth";
import type { User } from "@/types/user";
import { UsersPageSkeleton } from "./_components/users-skeleton";
import { UsersPageClient } from "./users-page-client";

export default async function UsersPage() {
  const session = await getSession();

  // Redirect unauthenticated users
  if (!session) {
    redirect("/login");
  }

  return (
    <Suspense fallback={<UsersPageSkeleton />}>
      <UsersPageContent currentUser={session.user} />
    </Suspense>
  );
}

async function UsersPageContent({ currentUser }: { currentUser: User }) {
  const users = await getUsers();
  return <UsersPageClient users={users} currentUser={currentUser} />;
}
