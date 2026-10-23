import { describe, expect, it } from "vitest";
import {
  currentMinimaxModelOptions,
  isDirectMinimaxUrl,
  MINIMAX_TEXT_DEFAULTS,
} from "@/lib/minimax-model-options";

const select = (names: string[]) => currentMinimaxModelOptions(names, (name) => name);

describe("MiniMax discovery options", () => {
  it("offers Flash first and M3 without advertising legacy text models", () => {
    const catalog = [
      "MiniMax-M2.7",
      "MiniMax-M3",
      "MiniMax-M1",
      "MiniMax-M3.1-Flash",
      "MiniMax-Text-01",
    ];
    expect(select(catalog)).toEqual(MINIMAX_TEXT_DEFAULTS);
    expect(catalog).toHaveLength(5);
  });

  it("retains advertised gateway IDs without inventing an unsupported Flash route", () => {
    expect(
      select([
        "minimax/minimax-m2.7",
        "minimax/minimax-m3",
        "minimax/minimax-m3.1-flash",
        "minimax/minimax-m3.1-flash:free",
        "minimax-m3.1-flash-free",
      ])
    ).toEqual(["minimax/minimax-m3.1-flash:free", "minimax-m3.1-flash-free", "minimax/minimax-m3"]);
    expect(select(["minimax/minimax-m3"])).toEqual(["minimax/minimax-m3"]);
  });

  it("preserves custom aliases, non-MiniMax models and media in their original order", () => {
    const names = [
      "my-minimax-model",
      "MiniMax-M2.7-custom",
      "gpt-5.5",
      "MiniMax-H3",
      "MiniMax-Hailuo-2.3",
      "speech-2.8-hd",
      "music-3.0",
      "image-01",
    ];
    expect(select(names)).toEqual(names);
  });

  it.each([
    ["https://api.minimax.io/anthropic", true],
    ["https://api.minimaxi.com/v1", true],
    ["https://api.minimax.io.example.com/v1", false],
    ["https://openrouter.ai/api/v1", false],
    ["not-a-url", false],
    [undefined, false],
  ])("recognizes only an exact direct MiniMax endpoint: %s", (url, expected) => {
    expect(isDirectMinimaxUrl(url)).toBe(expected);
  });
});
