import { NextResponse } from "next/server";
import { clearAuthCookie, withNoStoreHeaders } from "@/lib/auth";

export async function POST() {
  await clearAuthCookie();
  return withNoStoreHeaders(NextResponse.json({ ok: true }));
}
