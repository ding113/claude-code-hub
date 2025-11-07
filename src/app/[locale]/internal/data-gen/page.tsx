import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { DataGeneratorPage } from "./_components/data-generator-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    redirect("/login" as any);
  }

  return <DataGeneratorPage />;
}
