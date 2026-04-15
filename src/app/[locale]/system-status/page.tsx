import { logger } from "@/lib/logger";
import {
  getPublicSystemStatusSnapshot,
  type PublicSystemStatusSnapshot,
} from "@/lib/system-status";
import { SystemStatusView } from "./_components/system-status-view";

type SystemStatusPageParams = { locale: string };

export const dynamic = "force-dynamic";

export default async function SystemStatusPage({
  params,
}: {
  params: Promise<SystemStatusPageParams> | SystemStatusPageParams;
}) {
  const { locale } = await params;

  let initialData: PublicSystemStatusSnapshot | null = null;

  try {
    initialData = await getPublicSystemStatusSnapshot();
  } catch (error) {
    logger.error("Failed to load initial public system status snapshot", { error });
  }

  return <SystemStatusView locale={locale} initialData={initialData} />;
}
