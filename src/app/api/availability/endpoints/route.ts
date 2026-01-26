import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findProviderEndpointsByVendorAndType } from "@/repository";
import type { ProviderType } from "@/types/provider";

const PROVIDER_TYPES: ProviderType[] = [
  "claude",
  "claude-auth",
  "codex",
  "gemini-cli",
  "gemini",
  "openai-compatible",
];

function isProviderType(value: string | null): value is ProviderType {
  if (!value) {
    return false;
  }
  return PROVIDER_TYPES.includes(value as ProviderType);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  const vendorIdRaw = searchParams.get("vendorId");
  const vendorId = vendorIdRaw ? Number.parseInt(vendorIdRaw, 10) : Number.NaN;
  const providerTypeRaw = searchParams.get("providerType");

  if (!Number.isFinite(vendorId) || vendorId <= 0 || !isProviderType(providerTypeRaw)) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  try {
    const endpoints = await findProviderEndpointsByVendorAndType(vendorId, providerTypeRaw);
    return NextResponse.json({ vendorId, providerType: providerTypeRaw, endpoints });
  } catch (error) {
    console.error("Endpoint availability API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
