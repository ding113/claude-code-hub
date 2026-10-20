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
  sourceSessionId?: string,
  requestId?: number,
  ownerUserId?: number
): Promise<SessionRequestLocatorResult> {
  const normalizedSequence = normalizeRequestSequence(requestSequence);

  if (requestId !== undefined) {
    const locator = await findSessionRequestLocator(
      identity,
      {
        requestId,
        requestSequence: normalizedSequence ?? undefined,
        sourceSessionId,
      },
      ownerUserId
    );
    return locator
      ? { ok: true, locator }
      : {
          ok: false,
          error: BUSINESS_ERRORS.SESSION_REQUEST_SOURCE_MISMATCH,
          errorCode: BUSINESS_ERRORS.SESSION_REQUEST_SOURCE_MISMATCH,
        };
  }

  const identityLocator = await findSessionRequestLocator(identity, {}, ownerUserId);

  if (!identityLocator) {
    return {
      ok: false,
      error: BUSINESS_ERRORS.SESSION_REQUEST_SOURCE_MISMATCH,
      errorCode: BUSINESS_ERRORS.SESSION_REQUEST_SOURCE_MISMATCH,
    };
  }

  if (
    identityLocator.identityKind === "prefix_affinity" &&
    requestId === undefined &&
    ((normalizedSequence !== null && !sourceSessionId) ||
      (normalizedSequence === null && sourceSessionId))
  ) {
    return {
      ok: false,
      error: BUSINESS_ERRORS.SESSION_REQUEST_SELECTOR_INCOMPLETE,
      errorCode: BUSINESS_ERRORS.SESSION_REQUEST_SELECTOR_INCOMPLETE,
    };
  }

  const locator =
    normalizedSequence !== null || sourceSessionId
      ? await findSessionRequestLocator(
          identity,
          {
            requestSequence: normalizedSequence ?? undefined,
            sourceSessionId,
          },
          ownerUserId
        )
      : identityLocator;

  return locator
    ? { ok: true, locator }
    : {
        ok: false,
        error: BUSINESS_ERRORS.SESSION_REQUEST_SOURCE_MISMATCH,
        errorCode: BUSINESS_ERRORS.SESSION_REQUEST_SOURCE_MISMATCH,
      };
}
