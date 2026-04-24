import type { PublicStatusTimelineBucket } from "@/lib/public-status/payload";
import { type DisplayState, deriveDisplayState } from "./derive-display-state";

export interface FilledTimelineCell {
  bucket: PublicStatusTimelineBucket;
  displayState: DisplayState;
  inferred: boolean;
}

export function fillDisplayTimeline(timeline: PublicStatusTimelineBucket[]): FilledTimelineCell[] {
  const derived: DisplayState[] = timeline.map((bucket) => deriveDisplayState(bucket));

  const knownIndices: number[] = [];
  derived.forEach((state, index) => {
    if (state !== "no_data") {
      knownIndices.push(index);
    }
  });

  if (knownIndices.length === 0) {
    return timeline.map((bucket) => ({ bucket, displayState: "no_data", inferred: false }));
  }

  const filled: DisplayState[] = derived.slice();
  const firstKnown = knownIndices[0];
  const lastKnown = knownIndices[knownIndices.length - 1];

  for (let i = 0; i < firstKnown; i++) {
    filled[i] = derived[firstKnown];
  }
  for (let i = lastKnown + 1; i < filled.length; i++) {
    filled[i] = derived[lastKnown];
  }

  for (let cursor = 0; cursor < knownIndices.length - 1; cursor++) {
    const leftIdx = knownIndices[cursor];
    const rightIdx = knownIndices[cursor + 1];
    const leftState = derived[leftIdx];
    const rightState = derived[rightIdx];

    for (let i = leftIdx + 1; i < rightIdx; i++) {
      if (leftState === rightState) {
        filled[i] = leftState;
      } else {
        const distLeft = i - leftIdx;
        const distRight = rightIdx - i;
        filled[i] = distLeft <= distRight ? leftState : rightState;
      }
    }
  }

  return timeline.map((bucket, index) => ({
    bucket,
    displayState: filled[index],
    inferred: derived[index] === "no_data" && filled[index] !== "no_data",
  }));
}
