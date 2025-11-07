import { redirect } from "@/i18n/routing";

export default function Home() {
  redirect("/dashboard" as any);
}
