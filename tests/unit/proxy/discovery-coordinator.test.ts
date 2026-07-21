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
  it("keeps Sticky probing outside the Discovery round counter", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 1 });
    coordinator.startStickyProbe();
    expect(coordinator.state).toBe("STICKY_PROBING");
    expect(coordinator.round).toBe(1);
    expect(coordinator.canRefillCurrentRound).toBe(false);

    coordinator.addAttempt(attempt("sticky", 1));
    expect(coordinator.demoteToFallback("sticky")).toBe(true);
    coordinator.startDiscoveryAfterSticky();

    expect(coordinator.state).toBe("DISCOVERY_RACING");
    expect(coordinator.round).toBe(1);
    expect(coordinator.canRefillCurrentRound).toBe(true);
  });

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
    expect(action).toMatchObject({
      type: "launch",
      promoteAttemptId: "a",
      cancelAttemptIds: ["b"],
    });
    expect(coordinator.snapshot.find((item) => item.id === "a")?.kind).toBe("fallback");
    expect(coordinator.snapshot.filter((item) => item.pending)).toHaveLength(1);
    expect(coordinator.canRefillCurrentRound).toBe(true);
  });

  it("closes refills after the final round boundary", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 1 });
    coordinator.addAttempt(attempt("a", 1));
    coordinator.addAttempt(attempt("b", 2));

    expect(coordinator.onRoundBoundary()).toEqual({
      type: "cancel",
      attemptIds: ["b"],
      promoteAttemptId: "a",
    });
    expect(coordinator.canRefillCurrentRound).toBe(false);
  });

  it("ignores callbacks from an old request epoch", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 2 });
    coordinator.addAttempt(attempt("a", 1));
    const epoch = coordinator.epochs;
    coordinator.cancelRequest();
    expect(coordinator.markReady("a", epoch.requestEpoch, epoch.roundEpoch)).toEqual({
      type: "none",
    });
    expect(coordinator.markFailed("a")).toEqual({ type: "none" });
  });

  it("promotes a ready fallback at the round boundary when no normal is ready", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 2 });
    coordinator.addAttempt(attempt("a", 1, "fallback"));
    expect(coordinator.markReady("a")).toEqual({ type: "promote_fallback", attemptId: "a" });
    expect(coordinator.snapshot.find((item) => item.id === "a")?.kind).toBe("fallback");
  });

  it("keeps Sticky demotion synchronized with the coordinator", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 2 });
    coordinator.addAttempt(attempt("sticky", 1));

    expect(coordinator.demoteToFallback("sticky")).toBe(true);
    expect(coordinator.snapshot.find((item) => item.id === "sticky")).toMatchObject({
      kind: "fallback",
      pending: true,
    });
    expect(coordinator.markReady("sticky")).toEqual({
      type: "promote_fallback",
      attemptId: "sticky",
    });
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

  it("reports normal attempts cancelled when retaining an existing fallback", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 3 });
    coordinator.addAttempt(attempt("fallback", 1, "fallback"));
    coordinator.addAttempt(attempt("normal", 2));
    const action = coordinator.onRoundBoundary();
    expect(action).toEqual({
      type: "launch",
      slots: 1,
      cancelAttemptIds: ["normal"],
    });
  });

  it("retains a lower-priority ready candidate until the higher tier fails", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 2 });
    coordinator.addAttempt(attempt("high", 1));
    coordinator.addAttempt(attempt("low", 10));

    expect(coordinator.markReady("low")).toEqual({ type: "none" });
    expect(coordinator.snapshot.find((item) => item.id === "low")).toMatchObject({
      ready: true,
      pending: true,
    });
    expect(coordinator.markFailed("high")).toEqual({
      type: "commit_normal",
      attemptId: "low",
    });
  });

  it("treats fallback promotion as terminal", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 2 });
    coordinator.addAttempt(attempt("fallback", 1, "fallback"));

    expect(coordinator.markReady("fallback")).toEqual({
      type: "promote_fallback",
      attemptId: "fallback",
    });
    expect(coordinator.state).toBe("FALLBACK_ACTIVE");
    expect(coordinator.isTerminal).toBe(true);
    expect(coordinator.markFailed("fallback")).toEqual({ type: "none" });
  });

  it("records a ready-held fallback without promoting it before the deadline", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 2 });
    coordinator.addAttempt(attempt("fallback", 1, "fallback"));
    coordinator.addAttempt(attempt("normal", 1));

    expect(coordinator.recordReadyHeld("fallback")).toBe(true);
    expect(coordinator.snapshot.find((item) => item.id === "fallback")).toMatchObject({
      kind: "fallback",
      ready: true,
      pending: true,
    });
    expect(coordinator.state).toBe("FALLBACK_READY_HELD");
    expect(coordinator.onDeadline()).toEqual({
      type: "promote_fallback",
      attemptId: "fallback",
    });
  });

  it("rejects ready-held writes for stale, non-fallback, or inactive attempts", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 2 });
    coordinator.addAttempt(attempt("normal", 1));
    coordinator.addAttempt(attempt("fallback", 1, "fallback"));
    const staleEpoch = coordinator.epochs;

    expect(coordinator.recordReadyHeld("normal")).toBe(false);
    coordinator.beginRound();
    expect(
      coordinator.recordReadyHeld("fallback", staleEpoch.requestEpoch, staleEpoch.roundEpoch)
    ).toBe(false);
    coordinator.markFailed("fallback");
    expect(coordinator.recordReadyHeld("fallback")).toBe(false);
  });

  it("keeps coordinator kind in sync when a running Sticky becomes fallback", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 2 });
    coordinator.addAttempt(attempt("sticky", 1));

    expect(coordinator.promoteToFallback("sticky")).toBe(true);
    expect(coordinator.snapshot.find((item) => item.id === "sticky")?.kind).toBe("fallback");
  });

  it("opens a full new round when all normal attempts fail", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 3, maxRounds: 2 });
    coordinator.addAttempt(attempt("a", 1));
    coordinator.addAttempt(attempt("b", 2));

    expect(coordinator.markFailed("a")).toEqual({ type: "none" });
    expect(coordinator.markFailed("b")).toEqual({ type: "launch", slots: 3 });
    expect(coordinator.round).toBe(2);
  });

  it("commits a ready normal candidate at the total deadline", () => {
    const coordinator = new DiscoveryCoordinator({ concurrency: 2, maxRounds: 2 });
    coordinator.addAttempt(attempt("high", 1));
    coordinator.addAttempt(attempt("normal", 2));
    coordinator.markReady("normal");

    expect(coordinator.onDeadline()).toEqual({ type: "commit_normal", attemptId: "normal" });
  });
});
