import type { PublicStatusTimelineBucket } from "@/lib/public-status/payload";

export const CHART_BUCKETS = 60;

export function sliceTimelineForChart<T>(timeline: T[], chartBuckets: number = CHART_BUCKETS): T[] {
  if (timeline.length <= chartBuckets) {
    return timeline;
  }
  return timeline.slice(timeline.length - chartBuckets);
}

export function computeUptimePct(timeline: PublicStatusTimelineBucket[]): number | null {
  let weightedSum = 0;
  let sampleTotal = 0;
  for (const bucket of timeline) {
    if (bucket.sampleCount > 0 && bucket.availabilityPct !== null) {
      weightedSum += bucket.availabilityPct * bucket.sampleCount;
      sampleTotal += bucket.sampleCount;
    }
  }
  if (sampleTotal === 0) {
    return null;
  }
  return Number((weightedSum / sampleTotal).toFixed(2));
}

export function computeAvgTtfb(timeline: PublicStatusTimelineBucket[]): number | null {
  let weightedSum = 0;
  let sampleTotal = 0;
  for (const bucket of timeline) {
    if (bucket.sampleCount > 0 && bucket.ttfbMs !== null) {
      weightedSum += bucket.ttfbMs * bucket.sampleCount;
      sampleTotal += bucket.sampleCount;
    }
  }
  if (sampleTotal === 0) {
    return null;
  }
  return Math.round(weightedSum / sampleTotal);
}
