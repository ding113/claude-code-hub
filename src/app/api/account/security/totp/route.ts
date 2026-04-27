import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createCsrfOriginGuard } from "@/lib/security/csrf-origin-guard";
import { buildTotpAuthUri, generateBase32Secret, verifyTotp } from "@/lib/security/totp";
import {
  disableTotp,
  getSecuritySubjectId,
  getUserSecuritySettings,
  saveTotpEnabled,
} from "@/repository/user-security-settings";

export const runtime = "nodejs";

const csrfGuard = createCsrfOriginGuard({
  allowedOrigins: [],
  allowSameOrigin: true,
  enforceInDevelopment: true,
});

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  return response;
}

async function getSecurityContext() {
  const session = await getSession();
  if (!session) {
    return null;
  }

  return {
    session,
    subjectId: getSecuritySubjectId(session),
  };
}

export async function GET() {
  const context = await getSecurityContext();
  if (!context) {
    return noStore(NextResponse.json({ errorCode: "UNAUTHORIZED" }, { status: 401 }));
  }

  const settings = await getUserSecuritySettings(context.subjectId);
  return noStore(
    NextResponse.json({
      enabled: settings.totpEnabled,
      boundAt: settings.totpBoundAt?.toISOString() ?? null,
    })
  );
}

export async function POST(request: NextRequest) {
  const csrfResult = csrfGuard.check(request);
  if (!csrfResult.allowed) {
    return noStore(NextResponse.json({ errorCode: "CSRF_REJECTED" }, { status: 403 }));
  }

  const context = await getSecurityContext();
  if (!context) {
    return noStore(NextResponse.json({ errorCode: "UNAUTHORIZED" }, { status: 401 }));
  }

  const body = await request.json().catch(() => ({}));

  if (body?.action === "setup") {
    const secret = generateBase32Secret();
    const otpauthUri = buildTotpAuthUri({
      secret,
      accountName: context.session.user.name,
    });

    return noStore(NextResponse.json({ secret, otpauthUri }));
  }

  if (body?.action === "enable") {
    const secret = typeof body.secret === "string" ? body.secret.trim() : "";
    const otpCode = typeof body.otpCode === "string" ? body.otpCode.trim() : "";
    if (!secret || !verifyTotp({ secret, code: otpCode })) {
      return noStore(NextResponse.json({ errorCode: "OTP_INVALID" }, { status: 400 }));
    }

    await saveTotpEnabled(context.subjectId, secret);
    return noStore(NextResponse.json({ enabled: true }));
  }

  return noStore(NextResponse.json({ errorCode: "BAD_REQUEST" }, { status: 400 }));
}

export async function DELETE(request: NextRequest) {
  const csrfResult = csrfGuard.check(request);
  if (!csrfResult.allowed) {
    return noStore(NextResponse.json({ errorCode: "CSRF_REJECTED" }, { status: 403 }));
  }

  const context = await getSecurityContext();
  if (!context) {
    return noStore(NextResponse.json({ errorCode: "UNAUTHORIZED" }, { status: 401 }));
  }

  await disableTotp(context.subjectId);
  return noStore(NextResponse.json({ enabled: false }));
}
