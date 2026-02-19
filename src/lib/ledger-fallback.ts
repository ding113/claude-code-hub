import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/drizzle/db";

let cachedResult: boolean | null = null;
let cacheExpiry = 0;

export async function isLedgerOnlyMode(): Promise<boolean> {
  const now = Date.now();
  if (cachedResult !== null && now < cacheExpiry) return cachedResult;

  try {
    const result = await db.execute(
      sql`SELECT EXISTS(SELECT 1 FROM message_request LIMIT 1) AS has_data`
    );
    const hasData = (result as unknown as Array<{ has_data: boolean }>)[0]?.has_data ?? false;
    cachedResult = !hasData;
    cacheExpiry = now + 60_000;
    return cachedResult;
  } catch {
    cachedResult = true;
    cacheExpiry = now + 60_000;
    return true;
  }
}
