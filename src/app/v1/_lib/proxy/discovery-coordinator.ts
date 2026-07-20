/**
 * Pure state machine for bounded provider discovery.
 *
 * The coordinator deliberately has no network or timer dependencies. The
 * forwarder owns attempts and calls these methods at event boundaries. This
 * keeps cancellation and stale-event handling deterministic and testable.
 */

export type DiscoveryAttemptKind = "normal" | "fallback";
export type DiscoveryState =
  | "STICKY_PROBING"
  | "DISCOVERY_RACING"
  | "FALLBACK_READY_HELD"
  | "FALLBACK_ACTIVE"
  | "WINNER_COMMITTED"
  | "TERMINAL_FAILED";

export type DiscoveryAttempt = {
  id: string;
  providerId: number;
  priority: number;
  kind: DiscoveryAttemptKind;
  ready: boolean;
  pending: boolean;
  round: number;
  launchOrder: number;
};

export type DiscoveryAction =
  | { type: "commit_normal"; attemptId: string }
  | { type: "promote_fallback"; attemptId: string }
  | { type: "cancel"; attemptIds: string[]; promoteAttemptId?: string }
  | {
      type: "launch";
      slots: number;
      cancelAttemptIds?: string[];
      promoteAttemptId?: string;
    }
  | { type: "none" }
  | { type: "terminal_failure" };

export type DiscoveryCoordinatorOptions = {
  concurrency: number;
  maxRounds: number;
};

function compareAttempts(a: DiscoveryAttempt, b: DiscoveryAttempt): number {
  return a.priority - b.priority || a.launchOrder - b.launchOrder;
}

export class DiscoveryCoordinator {
  readonly concurrency: number;
  readonly maxRounds: number;
  state: DiscoveryState = "DISCOVERY_RACING";
  round = 1;
  private attempts = new Map<string, DiscoveryAttempt>();
  private requestEpoch = 0;
  private roundEpoch = 0;

  constructor(options: DiscoveryCoordinatorOptions) {
    this.concurrency = Math.max(1, Math.floor(options.concurrency));
    this.maxRounds = Math.max(1, Math.floor(options.maxRounds));
  }

  get epochs(): { requestEpoch: number; roundEpoch: number } {
    return { requestEpoch: this.requestEpoch, roundEpoch: this.roundEpoch };
  }

  beginRound(): { requestEpoch: number; roundEpoch: number; round: number } {
    this.roundEpoch += 1;
    if (!this.isTerminal) this.state = "DISCOVERY_RACING";
    return { ...this.epochs, round: this.round };
  }

  addAttempt(attempt: DiscoveryAttempt): boolean {
    if (this.isTerminal || this.attempts.has(attempt.id)) return false;
    this.attempts.set(attempt.id, { ...attempt, round: this.round });
    return true;
  }

  removeAttempt(id: string): void {
    this.attempts.delete(id);
  }

  get isTerminal(): boolean {
    return this.state === "WINNER_COMMITTED" || this.state === "TERMINAL_FAILED";
  }

  get activeAttempts(): DiscoveryAttempt[] {
    return Array.from(this.attempts.values()).filter((attempt) => attempt.pending);
  }

  get snapshot(): DiscoveryAttempt[] {
    return Array.from(this.attempts.values()).map((attempt) => ({ ...attempt }));
  }

  /** Ignore events from a cancelled request or an old round. */
  acceptsEpoch(requestEpoch: number, roundEpoch: number): boolean {
    return requestEpoch === this.requestEpoch && roundEpoch === this.roundEpoch;
  }

  markReady(
    id: string,
    requestEpoch = this.requestEpoch,
    roundEpoch = this.roundEpoch
  ): DiscoveryAction {
    if (!this.acceptsEpoch(requestEpoch, roundEpoch) || this.isTerminal) return { type: "none" };
    const attempt = this.attempts.get(id);
    if (!attempt?.pending) return { type: "none" };
    attempt.ready = true;
    if (attempt.kind === "fallback") {
      const pendingNormal = Array.from(this.attempts.values()).some(
        (candidate) => candidate.pending && candidate.kind === "normal"
      );
      if (!pendingNormal) {
        attempt.pending = false;
        this.state = "FALLBACK_ACTIVE";
        return { type: "promote_fallback", attemptId: attempt.id };
      }
      return { type: "none" };
    }
    return this.chooseReadyNormal();
  }

  /** Convert a timed-out Sticky attempt into the request's fallback lane. */
  demoteToFallback(
    id: string,
    requestEpoch = this.requestEpoch,
    roundEpoch = this.roundEpoch
  ): boolean {
    if (!this.acceptsEpoch(requestEpoch, roundEpoch) || this.isTerminal) return false;
    const attempt = this.attempts.get(id);
    if (!attempt?.pending) return false;
    attempt.kind = "fallback";
    this.state = "FALLBACK_READY_HELD";
    return true;
  }

  markFailed(
    id: string,
    requestEpoch = this.requestEpoch,
    roundEpoch = this.roundEpoch
  ): DiscoveryAction {
    if (!this.acceptsEpoch(requestEpoch, roundEpoch) || this.isTerminal) return { type: "none" };
    const attempt = this.attempts.get(id);
    if (!attempt) return { type: "none" };
    attempt.pending = false;
    attempt.ready = false;
    return this.afterAttemptState();
  }

  /** A normal ready result may win only after priority gating is satisfied. */
  private chooseReadyNormal(ignorePriorityGate = false): DiscoveryAction {
    const readyNormal = Array.from(this.attempts.values())
      .filter((attempt) => attempt.pending && attempt.ready && attempt.kind === "normal")
      .sort(compareAttempts);
    if (readyNormal.length === 0) return { type: "none" };
    const bestPriority = readyNormal[0].priority;
    if (!ignorePriorityGate) {
      const higherTierPending = Array.from(this.attempts.values()).some(
        (attempt) =>
          attempt.pending &&
          attempt.kind === "normal" &&
          !attempt.ready &&
          attempt.priority < bestPriority
      );
      if (higherTierPending) return { type: "none" };
    }
    const sameTier = readyNormal.filter((attempt) => attempt.priority === bestPriority);
    const winner = sameTier[0];
    this.state = "WINNER_COMMITTED";
    winner.pending = false;
    return {
      type: "commit_normal",
      attemptId: winner.id,
    };
  }

  /**
   * Close the current SLA window. At a boundary a ready normal always wins;
   * otherwise the best still-pending normal becomes the sole fallback. A
   * fallback that is merely ready is held until no normal can still win.
   */
  onRoundBoundary(requestEpoch = this.requestEpoch, roundEpoch = this.roundEpoch): DiscoveryAction {
    if (!this.acceptsEpoch(requestEpoch, roundEpoch) || this.isTerminal) return { type: "none" };
    const readyAction = this.chooseReadyNormal(true);
    if (readyAction.type === "commit_normal") return readyAction;

    const currentFallback = Array.from(this.attempts.values()).find(
      (attempt) => attempt.pending && attempt.kind === "fallback"
    );
    if (currentFallback?.ready) {
      currentFallback.pending = false;
      this.state = "FALLBACK_ACTIVE";
      return { type: "promote_fallback", attemptId: currentFallback.id };
    }

    const pendingNormal = Array.from(this.attempts.values())
      .filter((attempt) => attempt.pending && attempt.kind === "normal")
      .sort(compareAttempts);
    if (currentFallback && pendingNormal.length > 0) {
      const cancelAttemptIds = pendingNormal.map((attempt) => attempt.id);
      for (const attempt of pendingNormal) attempt.pending = false;
      if (this.round < this.maxRounds) {
        this.round += 1;
        this.roundEpoch += 1;
        this.state = "DISCOVERY_RACING";
        return {
          type: "launch",
          slots: Math.max(1, this.concurrency - 1),
          cancelAttemptIds,
        };
      }
      return { type: "cancel", attemptIds: cancelAttemptIds };
    }
    if (pendingNormal.length === 0) {
      if (currentFallback) {
        this.state = "FALLBACK_READY_HELD";
        return { type: "none" };
      }
      return this.finishOrLaunch();
    }

    const fallback = pendingNormal[0];
    fallback.kind = "fallback";
    this.state = "FALLBACK_READY_HELD";
    const losers = pendingNormal.slice(1).map((attempt) => attempt.id);
    for (const id of losers) this.attempts.get(id)!.pending = false;

    if (this.round < this.maxRounds) {
      this.round += 1;
      this.roundEpoch += 1;
      this.state = "DISCOVERY_RACING";
      return {
        type: "launch",
        slots: Math.max(1, this.concurrency - 1),
        cancelAttemptIds: losers,
        promoteAttemptId: fallback.id,
      };
    }
    return { type: "cancel", attemptIds: losers, promoteAttemptId: fallback.id };
  }

  onDeadline(): DiscoveryAction {
    if (this.isTerminal) return { type: "none" };
    const fallback = Array.from(this.attempts.values()).find(
      (attempt) => attempt.pending && attempt.kind === "fallback" && attempt.ready
    );
    if (fallback) {
      fallback.pending = false;
      this.state = "FALLBACK_ACTIVE";
      return { type: "promote_fallback", attemptId: fallback.id };
    }
    this.state = "TERMINAL_FAILED";
    return { type: "terminal_failure" };
  }

  commitWinner(id: string): DiscoveryAction {
    const attempt = this.attempts.get(id);
    if (!attempt || this.isTerminal) return { type: "none" };
    attempt.pending = false;
    this.state = "WINNER_COMMITTED";
    return {
      type: attempt.kind === "fallback" ? "promote_fallback" : "commit_normal",
      attemptId: id,
    };
  }

  cancelRequest(): DiscoveryAction {
    this.requestEpoch += 1;
    this.roundEpoch += 1;
    const ids = this.activeAttempts.map((attempt) => attempt.id);
    for (const attempt of this.attempts.values()) attempt.pending = false;
    this.state = "TERMINAL_FAILED";
    return { type: "cancel", attemptIds: ids };
  }

  private afterAttemptState(): DiscoveryAction {
    const pending = this.activeAttempts;
    if (pending.length === 0) return this.finishOrLaunch();

    // A higher-priority attempt may have been the only gate preventing a
    // ready lower-priority candidate from winning. Once that attempt fails,
    // re-run the normal winner selection before waiting for another boundary.
    const readyNormal = this.chooseReadyNormal();
    if (readyNormal.type === "commit_normal") return readyNormal;

    const fallback = pending.find((attempt) => attempt.kind === "fallback");
    if (fallback?.ready && pending.every((attempt) => attempt.kind === "fallback")) {
      return this.commitWinner(fallback.id);
    }
    return { type: "none" };
  }

  private finishOrLaunch(): DiscoveryAction {
    if (this.round >= this.maxRounds) {
      this.state = "TERMINAL_FAILED";
      return { type: "terminal_failure" };
    }
    this.round += 1;
    this.roundEpoch += 1;
    this.state = "DISCOVERY_RACING";
    return { type: "launch", slots: Math.max(1, this.concurrency - 1) };
  }
}
