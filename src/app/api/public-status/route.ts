import { NextResponse } from "next/server";
import { getPublicStatusSnapshot } from "@/repository/public-status-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getPublicStatusSnapshot();

  if (!snapshot) {
    return NextResponse.json(
      {
        errorCode: "PUBLIC_STATUS_NOT_CONFIGURED",
      },
      { status: 404 }
    );
  }

  return NextResponse.json(snapshot);
}
