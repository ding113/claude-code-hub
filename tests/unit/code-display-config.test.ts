/**
 * @vitest-environment node
 */

import { describe, expect, test } from "vitest";
import {
  DEFAULT_CODE_DISPLAY_CONFIG,
  parseCodeDisplayConfigFromEnv,
} from "@/components/ui/code-display-config";

describe("parseCodeDisplayConfigFromEnv", () => {
  test("uses defaults when env is empty", () => {
    const cfg = parseCodeDisplayConfigFromEnv({});
    expect(cfg).toEqual(DEFAULT_CODE_DISPLAY_CONFIG);
  });

  test("parses boolean env values with common aliases", () => {
    const cfg = parseCodeDisplayConfigFromEnv({
      CCH_CODEDISPLAY_LARGE_PLAIN: "0",
      CCH_CODEDISPLAY_VIRTUAL_HIGHLIGHT: "yes",
      CCH_CODEDISPLAY_WORKER_ENABLE: "off",
      CCH_CODEDISPLAY_PERF_DEBUG: "1",
    });

    expect(cfg.largePlainEnabled).toBe(false);
    expect(cfg.virtualHighlightEnabled).toBe(true);
    expect(cfg.workerEnabled).toBe(false);
    expect(cfg.perfDebugEnabled).toBe(true);
  });

  test("clamps numeric env values to safe ranges", () => {
    const cfg = parseCodeDisplayConfigFromEnv({
      CCH_CODEDISPLAY_HIGHLIGHT_MAX_CHARS: "10", // min 1000
      CCH_CODEDISPLAY_VIRTUAL_OVERSCAN_LINES: "-1", // min 0
      CCH_CODEDISPLAY_VIRTUAL_CONTEXT_LINES: "999999", // max 5000
      CCH_CODEDISPLAY_VIRTUAL_LINE_HEIGHT_PX: "200", // max 64
      CCH_CODEDISPLAY_MAX_PRETTY_OUTPUT_BYTES: "123", // min 1_000_000
      CCH_CODEDISPLAY_MAX_LINE_INDEX_LINES: "1", // min 10_000
    });

    expect(cfg.highlightMaxChars).toBe(1000);
    expect(cfg.virtualOverscanLines).toBe(0);
    expect(cfg.virtualContextLines).toBe(5000);
    expect(cfg.virtualLineHeightPx).toBe(64);
    expect(cfg.maxPrettyOutputBytes).toBe(1_000_000);
    expect(cfg.maxLineIndexLines).toBe(10_000);
  });

  test("clamps numeric env values to upper bounds", () => {
    const cfg = parseCodeDisplayConfigFromEnv({
      CCH_CODEDISPLAY_HIGHLIGHT_MAX_CHARS: "99999999", // max 5_000_000
      CCH_CODEDISPLAY_MAX_PRETTY_OUTPUT_BYTES: "9999999999", // max 200_000_000
      CCH_CODEDISPLAY_MAX_LINE_INDEX_LINES: "99999999", // max 2_000_000
    });

    expect(cfg.highlightMaxChars).toBe(5_000_000);
    expect(cfg.maxPrettyOutputBytes).toBe(200_000_000);
    expect(cfg.maxLineIndexLines).toBe(2_000_000);
  });
});
