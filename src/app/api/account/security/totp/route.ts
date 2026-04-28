import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientIpWithFreshSettings } from "@/lib/ip";
import { logger } from "@/lib/logger";
import { createCsrfOriginGuard } from "@/lib/security/csrf-origin-guard";
import {
  buildTotpAuthUri,
  generateBase32Secret,
  verifyTotp,
  verifyTotpAndGetCounter,
} from "@/lib/security/totp";
import {
  getTotpSecretKeySource,
  isTotpSecretEncryptionConfigured,
} from "@/lib/security/totp-secret-encryption";
import { createAuditLogAsync } from "@/repository/audit-log";
import {
  disableTotp,
  getSecuritySubjectId,
  getUserSecuritySettings,
  saveTotpEnabled,
  saveTotpLastUsedCounter,
  saveTotpSetupPending,
  type UserSecuritySettings,
} from "@/repository/user-security-settings";

export const runtime = "nodejs";

const csrfGuard = createCsrfOriginGuard({
  allowedOrigins: [],
  allowSameOrigin: true,
  enforceInDevelopment: true,
});

const SETUP_SECRET_TTL_MS = 10 * 60 * 1000;

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

async function resolveClientIp(request: NextRequest): Promise<string> {
  const platformIp = (request as unknown as { ip?: string }).ip;
  if (platformIp) return platformIp;

  return (await getClientIpWithFreshSettings(request.headers)) ?? "unknown";
}

async function recordTotpAudit(
  request: NextRequest,
  context: NonNullable<Awaited<ReturnType<typeof getSecurityContext>>>,
  actionType: string,
  success: boolean,
  errorMessage?: string
) {
  let operatorIp = "unknown";
  try {
    operatorIp = await resolveClientIp(request);
  } catch (error) {
    logger.warn("TOTP audit IP resolution failed", {
      subjectId: context.subjectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await createAuditLogAsync({
      actionCategory: "auth",
      actionType,
      targetType: "security_settings",
      targetId: context.subjectId,
      operatorUserId: context.session.user.id,
      operatorUserName: context.session.user.name,
      operatorKeyId: context.session.key?.id ?? null,
      operatorKeyName: context.session.key?.name ?? null,
      operatorIp,
      userAgent: request.headers.get("user-agent"),
      success,
      errorMessage,
    });
  } catch (error) {
    logger.error("TOTP audit write failed", {
      subjectId: context.subjectId,
      actionType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function otpInvalidResponse() {
  return noStore(NextResponse.json({ errorCode: "OTP_INVALID" }, { status: 400 }));
}

async function verifyCurrentTotpForMutation(
  subjectId: string,
  settings: UserSecuritySettings,
  code: string
): Promise<boolean> {
  if (!settings.totpSecret) {
    return false;
  }

  const otpResult = verifyTotpAndGetCounter({ secret: settings.totpSecret, code });
  if (!otpResult) {
    return false;
  }

  if (settings.totpLastUsedCounter != null && otpResult.counter <= settings.totpLastUsedCounter) {
    return false;
  }

  return saveTotpLastUsedCounter(subjectId, otpResult.counter);
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
    if (!isTotpSecretEncryptionConfigured()) {
      logger.warn("TOTP setup rejected: encryption key is not configured", {
        subjectId: context.subjectId,
      });
      await recordTotpAudit(request, context, "totp.setup", false, "ENCRYPTION_NOT_CONFIGURED");
      return noStore(
        NextResponse.json({ errorCode: "TOTP_ENCRYPTION_NOT_CONFIGURED" }, { status: 503 })
      );
    }
    if (getTotpSecretKeySource() === "admin-token") {
      logger.warn(
        "TOTP setup is using ADMIN_TOKEN fallback for secret encryption; set TOTP_SECRET_ENCRYPTION_KEY before rotating ADMIN_TOKEN",
        { subjectId: context.subjectId }
      );
    }

    const secret = generateBase32Secret();
    const expiresAt = new Date(Date.now() + SETUP_SECRET_TTL_MS);
    const otpauthUri = buildTotpAuthUri({
      secret,
      accountName: context.session.user.name,
    });

    await saveTotpSetupPending(context.subjectId, secret, expiresAt);
    logger.info("TOTP setup secret issued", {
      subjectId: context.subjectId,
      expiresAt: expiresAt.toISOString(),
    });
    await recordTotpAudit(request, context, "totp.setup", true);

    return noStore(NextResponse.json({ secret, otpauthUri, expiresAt: expiresAt.toISOString() }));
  }

  if (body?.action === "enable") {
    const otpCode = typeof body.otpCode === "string" ? body.otpCode.trim() : "";
    const oldOtpCode = typeof body.oldOtpCode === "string" ? body.oldOtpCode.trim() : "";
    const settings = await getUserSecuritySettings(context.subjectId);
    const now = Date.now();

    if (
      !settings.totpPendingSecret ||
      !settings.totpPendingExpiresAt ||
      settings.totpPendingExpiresAt.getTime() <= now
    ) {
      await recordTotpAudit(request, context, "totp.enable", false, "SETUP_EXPIRED");
      return noStore(NextResponse.json({ errorCode: "SETUP_EXPIRED" }, { status: 400 }));
    }

    if (!verifyTotp({ secret: settings.totpPendingSecret, code: otpCode })) {
      await recordTotpAudit(request, context, "totp.enable", false, "OTP_INVALID");
      return otpInvalidResponse();
    }

    if (settings.totpEnabled) {
      if (!settings.totpSecret) {
        await recordTotpAudit(request, context, "totp.enable", false, "OTP_NOT_CONFIGURED");
        return noStore(NextResponse.json({ errorCode: "OTP_NOT_CONFIGURED" }, { status: 503 }));
      }

      if (!(await verifyCurrentTotpForMutation(context.subjectId, settings, oldOtpCode))) {
        await recordTotpAudit(request, context, "totp.enable", false, "CURRENT_OTP_INVALID");
        return otpInvalidResponse();
      }
    }

    const boundAt = await saveTotpEnabled(context.subjectId, settings.totpPendingSecret);
    logger.info("TOTP enabled", { subjectId: context.subjectId });
    await recordTotpAudit(request, context, "totp.enable", true);

    return noStore(NextResponse.json({ enabled: true, boundAt: boundAt.toISOString() }));
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

  const body = await request.json().catch(() => ({}));
  const otpCode = typeof body?.otpCode === "string" ? body.otpCode.trim() : "";
  const settings = await getUserSecuritySettings(context.subjectId);

  if (settings.totpEnabled) {
    if (!settings.totpSecret) {
      await recordTotpAudit(request, context, "totp.disable", false, "OTP_NOT_CONFIGURED");
      return noStore(NextResponse.json({ errorCode: "OTP_NOT_CONFIGURED" }, { status: 503 }));
    }

    if (!(await verifyCurrentTotpForMutation(context.subjectId, settings, otpCode))) {
      await recordTotpAudit(request, context, "totp.disable", false, "OTP_INVALID");
      return otpInvalidResponse();
    }
  }

  await disableTotp(context.subjectId);
  logger.info("TOTP disabled", { subjectId: context.subjectId });
  await recordTotpAudit(request, context, "totp.disable", true);

  return noStore(NextResponse.json({ enabled: false }));
}
