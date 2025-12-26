import { describe, expect, test } from "vitest";
import { planIncrementalSync } from "../incremental-sync";

type LocalItem = { key: string; value: number; isUserOverride?: boolean };
type RemoteItem = { key: string; value: number };

describe("remote-config/incremental-sync", () => {
  test("plans inserts, skips user overrides, and detects unchanged", () => {
    const plan = planIncrementalSync<LocalItem, RemoteItem>({
      local: [
        { key: "a", value: 1 },
        { key: "b", value: 2, isUserOverride: true },
      ],
      remote: [
        { key: "a", value: 1 },
        { key: "b", value: 3 },
        { key: "c", value: 4 },
      ],
      getKey: (item) => item.key,
      isUserOverride: (item) => item.isUserOverride === true,
      areEqual: (local, remote) => local.value === remote.value,
      merge: (local, remote) => ({
        key: remote.key,
        value: remote.value,
        isUserOverride: local?.isUserOverride ?? false,
      }),
    });

    expect(plan.inserts.map((i) => i.key)).toEqual(["c"]);
    expect(plan.updates).toHaveLength(0);
    expect(plan.skippedUserOverrides.map((i) => i.key)).toEqual(["b"]);
    expect(plan.unchanged.map((i) => i.key)).toEqual(["a"]);
  });

  test("plans updates for non-user-override changes", () => {
    const plan = planIncrementalSync<LocalItem, RemoteItem>({
      local: [{ key: "a", value: 1 }],
      remote: [{ key: "a", value: 2 }],
      getKey: (item) => item.key,
      isUserOverride: (item) => item.isUserOverride === true,
      areEqual: (local, remote) => local.value === remote.value,
      merge: (local, remote) => ({
        key: remote.key,
        value: remote.value,
        isUserOverride: local?.isUserOverride ?? false,
      }),
    });

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.before.value).toBe(1);
    expect(plan.updates[0]?.after.value).toBe(2);
  });

  test("plans deletes when enabled", () => {
    const plan = planIncrementalSync<LocalItem, RemoteItem>({
      local: [
        { key: "a", value: 1 },
        { key: "d", value: 9 },
      ],
      remote: [{ key: "a", value: 1 }],
      getKey: (item) => item.key,
      isUserOverride: (item) => item.isUserOverride === true,
      areEqual: (local, remote) => local.value === remote.value,
      merge: (local, remote) => ({
        key: remote.key,
        value: remote.value,
        isUserOverride: local?.isUserOverride ?? false,
      }),
      allowDeletes: true,
    });

    expect(plan.deletes.map((i) => i.key)).toEqual(["d"]);
  });
});
