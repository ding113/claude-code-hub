import { PROVIDER_BATCH_PATCH_ERROR_CODES } from "@/lib/provider-batch-patch-error-codes";

export function getProviderBatchErrorTranslationKey(errorCode?: string) {
  switch (errorCode) {
    case PROVIDER_BATCH_PATCH_ERROR_CODES.NOTHING_TO_APPLY:
      return "errors.nothingToApply" as const;
    case PROVIDER_BATCH_PATCH_ERROR_CODES.PREVIEW_EXPIRED:
      return "errors.previewExpired" as const;
    case PROVIDER_BATCH_PATCH_ERROR_CODES.PREVIEW_STALE:
      return "errors.previewStale" as const;
    case PROVIDER_BATCH_PATCH_ERROR_CODES.IDEMPOTENCY_CONFLICT:
      return "errors.idempotencyConflict" as const;
    case PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED:
      return "errors.undoExpired" as const;
    case PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_CONFLICT:
      return "errors.undoConflict" as const;
    case PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_STALE:
      return "errors.undoStale" as const;
    default:
      return null;
  }
}
