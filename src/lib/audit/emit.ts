import * as authModule from "@/lib/auth";
import { createAuditLogAsync } from "@/repository/audit-log";
import type { AuditCategory } from "@/types/audit-log";
import { redactSensitive } from "./redact";
import { resolveRequestContext } from "./request-context";

// Tolerant accessor: some action tests partially mock "@/lib/auth" without
// exporting getScopedAuthSession. We treat a missing export as "no session".
function safeGetScopedAuthSession(): ReturnType<typeof authModule.getScopedAuthSession> | null {
  try {
    const fn = (authModule as { getScopedAuthSession?: typeof authModule.getScopedAuthSession })
      .getScopedAuthSession;
    return typeof fn === "function" ? fn() : null;
  } catch {
    return null;
  }
}

export interface EmitActionAuditArgs {
  category: AuditCategory;
  action: string;
  targetType?: string;
  targetId?: string | number | null;
  targetName?: string | null;
  before?: unknown;
  after?: unknown;
  success: boolean;
  errorMessage?: string | null;
  redactExtraKeys?: string[];
}

/**
 * Fire-and-forget audit log emit for a server action. Operator identity is
 * captured from the scoped auth session; IP + UA from the request-context
 * AsyncLocalStorage populated by the action adapter.
 *
 * Before/after values are redacted for sensitive fields (keys, secrets, etc.)
 * before persistence.
 */
export function emitActionAudit(args: EmitActionAuditArgs): void {
  // Launch the audit pipeline asynchronously. This stays fire-and-forget
  // from the caller's perspective; the inner implementation can `await`
  // `next/headers` for the Next.js Server Action fallback.
  void emitAsync(args);
}

async function emitAsync(args: EmitActionAuditArgs): Promise<void> {
  const session = safeGetScopedAuthSession();
  // Prefer the adapter-populated ALS; fall back to next/headers for direct
  // Server Actions that bypass the OpenAPI adapter (system-settings form,
  // any future "use server" form action, etc).
  const { ip, userAgent } = await resolveRequestContext();

  await createAuditLogAsync({
    actionCategory: args.category,
    actionType: args.action,
    targetType: args.targetType ?? null,
    targetId: args.targetId != null ? String(args.targetId) : null,
    targetName: args.targetName ?? null,
    beforeValue:
      args.before !== undefined ? redactSensitive(args.before, args.redactExtraKeys) : null,
    afterValue: args.after !== undefined ? redactSensitive(args.after, args.redactExtraKeys) : null,
    operatorUserId: session?.user.id ?? null,
    operatorUserName: session?.user.name ?? null,
    operatorKeyId: session?.key.id ?? null,
    operatorKeyName: session?.key.name ?? null,
    operatorIp: ip,
    userAgent,
    success: args.success,
    errorMessage: args.errorMessage ?? null,
  });
}
