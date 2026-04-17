import { getScopedAuthSession } from "@/lib/auth";
import { createAuditLogAsync } from "@/repository/audit-log";
import type { AuditCategory } from "@/types/audit-log";
import { redactSensitive } from "./redact";
import { getRequestContext } from "./request-context";

export interface AuditTargetResolution {
  type: string;
  id?: string | number | null;
  name?: string | null;
}

export interface WithAuditOptions<TResult> {
  category: AuditCategory;
  action: string;
  /**
   * Static target descriptor OR a function that derives the target from the
   * action's result (e.g. the created row's id / name after a `create`).
   */
  target?: AuditTargetResolution | ((result: TResult) => AuditTargetResolution | undefined);
  /**
   * Snapshot of the row BEFORE the mutation runs. Called exactly once; the
   * returned value is redacted automatically before being stored.
   */
  snapshotBefore?: () => Promise<unknown> | unknown;
  /**
   * Extract the "after" value from the action's result. Defaults to the full
   * result. Returned value is redacted automatically.
   */
  extractAfter?: (result: TResult) => unknown;
  /**
   * Additional sensitive field names to redact from before/after values.
   */
  redactExtraKeys?: string[];
}

/**
 * Wrap a mutation with an audit-log write. Operator identity, IP and UA are
 * pulled from AsyncLocalStorage (populated by the action adapter). Audit
 * writes are fire-and-forget so they never block or fail the mutation.
 *
 * On exception, a failure audit row is emitted before the error is rethrown.
 */
export async function withAudit<T>(options: WithAuditOptions<T>, fn: () => Promise<T>): Promise<T> {
  const before = options.snapshotBefore ? await options.snapshotBefore() : undefined;
  const redactedBefore =
    before !== undefined ? redactSensitive(before, options.redactExtraKeys) : undefined;

  try {
    const result = await fn();
    const target = resolveTarget(options.target, result);
    const after = options.extractAfter !== undefined ? options.extractAfter(result) : result;
    const redactedAfter =
      after !== undefined ? redactSensitive(after, options.redactExtraKeys) : undefined;

    emitAudit({
      category: options.category,
      action: options.action,
      target,
      success: true,
      before: redactedBefore,
      after: redactedAfter,
    });
    return result;
  } catch (error) {
    const target = resolveTarget(options.target, undefined as T);
    emitAudit({
      category: options.category,
      action: options.action,
      target,
      success: false,
      before: redactedBefore,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function resolveTarget<T>(
  target: WithAuditOptions<T>["target"],
  result: T
): AuditTargetResolution | undefined {
  if (!target) return undefined;
  if (typeof target === "function") {
    try {
      return target(result);
    } catch {
      return undefined;
    }
  }
  return target;
}

interface EmitArgs {
  category: AuditCategory;
  action: string;
  target?: AuditTargetResolution;
  success: boolean;
  before?: unknown;
  after?: unknown;
  errorMessage?: string;
}

function emitAudit(args: EmitArgs): void {
  const session = getScopedAuthSession();
  const { ip, userAgent } = getRequestContext();

  createAuditLogAsync({
    actionCategory: args.category,
    actionType: args.action,
    targetType: args.target?.type ?? null,
    targetId: args.target?.id != null ? String(args.target.id) : null,
    targetName: args.target?.name ?? null,
    beforeValue: args.before,
    afterValue: args.after,
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
