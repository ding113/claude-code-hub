import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCurrentEndpointStatus } from "@/lib/endpoint-availability";

export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await getCurrentEndpointStatus();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Current endpoint availability API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
