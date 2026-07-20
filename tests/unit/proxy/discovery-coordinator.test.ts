import { describe, expect, it } from "vitest";
import { DiscoveryCoordinator } from "@/app/v1/_lib/proxy/discovery-coordinator";

const attempt = (id: string, priority: number, kind: "normal" | "fallback" = "normal") => ({
  id,
  providerId: Number(id.replace(/\D/g, "")) || 1,
  priority,
  kind,
  ready: false,
  pending: true,
  round: 1,
  launchOrder: Number(id.replace(/\D/g, "")) || 1,
});

describe("DiscoveryCoordinator", () => {
  it("commits the highest priority ready normal attempt", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 2 });
    coordinator.addAttempt(attempt("a", 10));
    coordinator.addAttempt(attempt("b", 1));
    expect(coordinator.markReady("a")).toEqual({ type: "none" });
    expect(coordinator.markReady("b")).toEqual({ type: "commit_normal", attemptId: "b" });
    expect(coordinator.state).toBe("WINNER_COMMITTED");
  });

  it("promotes one pending normal to fallback at a round boundary", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 2 });
    coordinator.addAttempt(attempt("a", 1));
    coordinator.addAttempt(attempt("b", 2));
    const action = coordinator.onRoundBoundary();
    expect(action.type).toBe("cancel");
    expect(coordinator.snapshot.find((item) => item.id === "a")?.kind).toBe("fallback");
    expect(coordinator.snapshot.filter((item) => item.pending)).toHaveLength(1);
  });

  it("ignores callbacks from an old request epoch", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 2 });
    coordinator.addAttempt(attempt("a", 1));
    const epoch = coordinator.epochs;
    coordinator.cancelRequest();
    expect(coordinator.markReady("a", epoch.requestEpoch, epoch.roundEpoch)).toEqual({
      type: "none",
    });
  });

  it("promotes a ready fallback at the round boundary when no normal is ready", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 2 });
    coordinator.addAttempt(attempt("a", 1, "fallback"));
    coordinator.addAttempt(attempt("b", 1, "normal"));
    expect(coordinator.markReady("a")).toEqual({ type: "none" });
    expect(coordinator.onRoundBoundary()).toEqual({ type: "promote_fallback", attemptId: "a" });
    expect(coordinator.snapshot.find((item) => item.id === "a")?.kind).toBe("fallback");
  });

  it("chooses the best ready normal at a boundary", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 3, maxRounds: 1 });
    coordinator.addAttempt(attempt("a", 10));
    coordinator.addAttempt(attempt("b", 1));
    coordinator.addAttempt(attempt("c", 5));
    coordinator.markReady("a");
    coordinator.markReady("c");
    expect(coordinator.onRoundBoundary()).toEqual({ type: "commit_normal", attemptId: "c" });
  });
});
