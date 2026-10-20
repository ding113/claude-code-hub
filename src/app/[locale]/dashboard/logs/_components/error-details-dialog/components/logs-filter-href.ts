export function buildLogsFilterHref(identity: string): string {
  const query = new URLSearchParams();
  query.set("sessionId", identity);
  return `/dashboard/logs?${query.toString()}`;
}
