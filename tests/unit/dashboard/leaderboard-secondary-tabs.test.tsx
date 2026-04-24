/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeaderboardSecondaryTabs } from "@/app/[locale]/dashboard/leaderboard/_components/leaderboard-secondary-tabs";

describe("LeaderboardSecondaryTabs", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  });

  it("renders cost and cache-hit tabs for grouped scopes", async () => {
    const onSecondaryChange = vi.fn();

    await act(async () => {
      root!.render(
        <LeaderboardSecondaryTabs
          activePrimaryTab="provider"
          activeSecondaryTab="cost"
          onSecondaryChange={onSecondaryChange}
          labels={{
            cost: "Cost",
            cacheHit: "Cache Hit",
          }}
        />
      );
    });

    const triggers = Array.from(
      container!.querySelectorAll<HTMLElement>("[data-testid^='leaderboard-secondary-tab-']")
    );
    expect(container!.querySelector("[data-testid='leaderboard-secondary-tabs']")).not.toBeNull();
    expect(triggers.map((node) => node.dataset.testid)).toEqual([
      "leaderboard-secondary-tab-cost",
      "leaderboard-secondary-tab-cache-hit",
    ]);

    await act(async () => {
      triggers[1]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      triggers[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSecondaryChange).toHaveBeenCalledWith("cacheHit");
  });

  it("renders no secondary tabs for model", async () => {
    await act(async () => {
      root!.render(
        <LeaderboardSecondaryTabs
          activePrimaryTab="model"
          activeSecondaryTab={null}
          onSecondaryChange={vi.fn()}
          labels={{
            cost: "Cost",
            cacheHit: "Cache Hit",
          }}
        />
      );
    });

    expect(container!.querySelector("[data-testid='leaderboard-secondary-tabs']")).toBeNull();
  });
});
