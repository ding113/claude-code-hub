/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeaderboardPrimaryTabs } from "@/app/[locale]/dashboard/leaderboard/_components/leaderboard-primary-tabs";

describe("LeaderboardPrimaryTabs", () => {
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

  it("renders user provider model tabs for admin", async () => {
    const onPrimaryChange = vi.fn();

    await act(async () => {
      root!.render(
        <LeaderboardPrimaryTabs
          isAdmin
          activePrimaryTab="user"
          onPrimaryChange={onPrimaryChange}
          labels={{
            user: "User",
            provider: "Provider",
            model: "Model",
          }}
        />
      );
    });

    const triggers = Array.from(
      container!.querySelectorAll<HTMLElement>("[data-testid^='leaderboard-primary-tab-']")
    );
    expect(container!.querySelector("[data-testid='leaderboard-primary-tabs']")).not.toBeNull();
    expect(triggers.map((node) => node.dataset.testid)).toEqual([
      "leaderboard-primary-tab-user",
      "leaderboard-primary-tab-provider",
      "leaderboard-primary-tab-model",
    ]);

    await act(async () => {
      triggers[2]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      triggers[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onPrimaryChange).toHaveBeenCalledWith("model");
  });

  it("renders only user tab for non-admin", async () => {
    await act(async () => {
      root!.render(
        <LeaderboardPrimaryTabs
          isAdmin={false}
          activePrimaryTab="user"
          onPrimaryChange={vi.fn()}
          labels={{
            user: "User",
            provider: "Provider",
            model: "Model",
          }}
        />
      );
    });

    expect(container!.querySelector("[data-testid='leaderboard-primary-tab-user']")).not.toBeNull();
    expect(container!.querySelector("[data-testid='leaderboard-primary-tab-provider']")).toBeNull();
    expect(container!.querySelector("[data-testid='leaderboard-primary-tab-model']")).toBeNull();
  });
});
