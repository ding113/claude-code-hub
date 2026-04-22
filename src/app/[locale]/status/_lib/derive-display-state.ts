import type {
  PublicStatusModelSnapshot,
  PublicStatusTimelineBucket,
  PublicStatusTimelineState,
} from "@/lib/public-status/payload";

export const DEGRADED_THRESHOLD = 50;

export type DisplayState = PublicStatusTimelineState;

export function deriveDisplayState(bucket: PublicStatusTimelineBucket): DisplayState {
  if (bucket.state === "failed") {
    return "failed";
  }
  if (bucket.state === "no_data") {
    return "no_data";
  }
  const pct = bucket.availabilityPct;
  if (pct === null) {
    return bucket.state === "degraded" ? "degraded" : "operational";
  }
  if (pct < DEGRADED_THRESHOLD) {
    return "degraded";
  }
  return "operational";
}

export function deriveLatestModelState(
  model: Pick<PublicStatusModelSnapshot, "timeline" | "latestState">
): DisplayState {
  for (let index = model.timeline.length - 1; index >= 0; index--) {
    const bucket = model.timeline[index];
    if (bucket.state !== "no_data") {
      return deriveDisplayState(bucket);
    }
  }
  return model.latestState ?? "no_data";
}
