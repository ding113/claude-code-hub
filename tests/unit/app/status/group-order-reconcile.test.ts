import { describe, expect, it } from "vitest";
import { reconcileOrder } from "@/app/[locale]/status/_lib/group-order-store";

describe("reconcileOrder", () => {
  it("returns current order when stored is empty", () => {
    expect(reconcileOrder([], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("preserves stored order for groups still present", () => {
    expect(reconcileOrder(["c", "a", "b"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
  });

  it("drops slugs that are no longer present", () => {
    expect(reconcileOrder(["a", "removed", "b"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("appends newly added slugs at the tail", () => {
    expect(reconcileOrder(["a", "b"], ["a", "b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
  });

  it("handles add and remove together", () => {
    expect(reconcileOrder(["b", "old", "a"], ["a", "b", "new"])).toEqual(["b", "a", "new"]);
  });

  it("returns empty when current is empty", () => {
    expect(reconcileOrder(["a", "b"], [])).toEqual([]);
  });
});
