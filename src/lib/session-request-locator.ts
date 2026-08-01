import { BUSINESS_ERRORS } from "@/lib/utils/error-messages";
import { normalizeRequestSequence } from "@/lib/utils/request-sequence";
import { findSessionRequestLocator } from "@/repository/message";

type SessionRequestLocator = NonNullable<Awaited<ReturnType<typeof findSessionRequestLocator>>>;
type SessionRequestLocatorErrorCode =
  | typeof BUSINESS_ERRORS.SESSION_REQUEST_SOURCE_MISMATCH
  | typeof BUSINESS_ERRORS.SESSION_REQUEST_SELECTOR_INCOMPLETE;
type SessionRequestLocatorResult =
  | { ok: true; locator: SessionRequestLocator }
  | { ok: false; error: string; errorCode: SessionRequestLocatorErrorCode };

export async function resolveSessionRequestLocator(
  identity: string,
  requestSequence?: number,
  sourceSessionId?: string
): Promise<SessionRequestLocatorResult> {
  const normalizedSequence = normalizeRequestSequence(requestSequence);
  const identityLocator = await findSessionRequestLocator(identity);

  if (!identityLocator) {
    return {
      ok: false,
      error: "Request source does not belong to this session.",
      errorCode: BUSINESS_ERRORS.SESSION_REQUEST_SOURCE_MISMATCH,
    };
  }

  if (
    identityLocator.identityKind === "prefix_affinity" &&
    ((normalizedSequence !== null && !sourceSessionId) ||
      (normalizedSequence === null && sourceSessionId))
  ) {
    return {
      ok: false,
      error: "Prefix Session requests must specify both the physical source and request sequence.",
      errorCode: BUSINESS_ERRORS.SESSION_REQUEST_SELECTOR_INCOMPLETE,
    };
  }

  const locator =
    normalizedSequence !== null || sourceSessionId
      ? await findSessionRequestLocator(identity, {
          requestSequence: normalizedSequence ?? undefined,
          sourceSessionId,
        })
      : identityLocator;

  return locator
    ? { ok: true, locator }
    : {
        ok: false,
        error: "Request source does not belong to this session.",
        errorCode: BUSINESS_ERRORS.SESSION_REQUEST_SOURCE_MISMATCH,
      };
}
