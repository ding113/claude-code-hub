import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Drizzle db mock — use vi.fn() with resolved promise chains
// ---------------------------------------------------------------------------

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockSelect = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/drizzle/db", () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    select: mockSelect,
    transaction: mockTransaction,
  },
}));

vi.mock("@/drizzle/schema", () => ({
  modelGroups: { id: "id", name: "name", isSingleton: "isSingleton", description: "description" },
  modelGroupMembers: {
    id: "id",
    modelGroupId: "modelGroupId",
    model: "model",
    createdAt: "createdAt",
  },
}));

vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Mock chain builders — each method returns `this` so chains can be awaited
// by vi.fn returning a promise from the final method
// ---------------------------------------------------------------------------

function makeSelectChain(data: unknown) {
  const p = Promise.resolve(data);
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    [Symbol.toStringTag]: "SelectChain",
    // make it awaitable via thenable without triggering biome noThenProperty
    ...(Object.create(p) as object),
  };
}

function wrapInPromise<T extends object>(chain: T, resolveWith: unknown): T & Promise<unknown> {
  return Object.assign(Promise.resolve(resolveWith), chain) as T & Promise<unknown>;
}

function selectChain(data: unknown) {
  const base = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
    innerJoin: vi.fn(),
  };
  const promise = Promise.resolve(data);
  const chain = Object.assign(promise, base);
  base.from.mockReturnValue(chain);
  base.where.mockReturnValue(chain);
  base.limit.mockReturnValue(chain);
  base.orderBy.mockReturnValue(chain);
  base.innerJoin.mockReturnValue(chain);
  return chain;
}

function insertChain(data: unknown) {
  const base = {
    values: vi.fn(),
    returning: vi.fn(),
    onConflictDoNothing: vi.fn(),
  };
  const promise = Promise.resolve(data);
  const chain = Object.assign(promise, base);
  base.values.mockReturnValue(chain);
  base.returning.mockReturnValue(chain);
  base.onConflictDoNothing.mockReturnValue(chain);
  return chain;
}

function updateChain(data: unknown) {
  const base = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  const promise = Promise.resolve(data);
  const chain = Object.assign(promise, base);
  base.set.mockReturnValue(chain);
  base.where.mockReturnValue(chain);
  base.returning.mockReturnValue(chain);
  return chain;
}

function deleteChain(data: unknown) {
  const base = {
    where: vi.fn(),
  };
  const promise = Promise.resolve(data);
  const chain = Object.assign(promise, base);
  base.where.mockReturnValue(chain);
  return chain;
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("model-group repository", () => {
  const now = new Date("2025-01-01T00:00:00Z");

  const sampleGroup = {
    id: 1,
    name: "gpt-group",
    description: null,
    isSingleton: false,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // createModelGroup
  // -------------------------------------------------------------------------

  describe("createModelGroup", () => {
    it("inserts a row and returns it", async () => {
      mockInsert.mockReturnValue(insertChain([sampleGroup]));

      const { createModelGroup } = await import("@/repository/model-group");
      const result = await createModelGroup({ name: "gpt-group" });

      expect(mockInsert).toHaveBeenCalledOnce();
      expect(result).toEqual(sampleGroup);
    });

    it("trims the name", async () => {
      const ic = insertChain([{ ...sampleGroup, name: "trimmed" }]);
      mockInsert.mockReturnValue(ic);

      const { createModelGroup } = await import("@/repository/model-group");
      await createModelGroup({ name: "  trimmed  " });

      const valuesArg = (ic.values as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(valuesArg.name).toBe("trimmed");
    });

    it("sets isSingleton=true when provided", async () => {
      mockInsert.mockReturnValue(insertChain([{ ...sampleGroup, isSingleton: true }]));

      const { createModelGroup } = await import("@/repository/model-group");
      const result = await createModelGroup({ name: "g", isSingleton: true });

      expect(result.isSingleton).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // updateModelGroup
  // -------------------------------------------------------------------------

  describe("updateModelGroup", () => {
    it("updates and returns the updated row", async () => {
      mockUpdate.mockReturnValue(updateChain([{ ...sampleGroup, name: "new-name" }]));

      const { updateModelGroup } = await import("@/repository/model-group");
      const result = await updateModelGroup(1, { name: "new-name" });

      expect(result.name).toBe("new-name");
    });

    it("throws when the row does not exist", async () => {
      mockUpdate.mockReturnValue(updateChain([]));

      const { updateModelGroup } = await import("@/repository/model-group");
      await expect(updateModelGroup(999, { name: "x" })).rejects.toThrow("not found");
    });
  });

  // -------------------------------------------------------------------------
  // deleteModelGroup
  // -------------------------------------------------------------------------

  describe("deleteModelGroup", () => {
    it("calls delete with the id", async () => {
      mockDelete.mockReturnValue(deleteChain(undefined));

      const { deleteModelGroup } = await import("@/repository/model-group");
      await deleteModelGroup(1);

      expect(mockDelete).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // listModelGroups
  // -------------------------------------------------------------------------

  describe("listModelGroups", () => {
    it("returns empty array when no groups", async () => {
      mockSelect.mockReturnValue(selectChain([]));

      const { listModelGroups } = await import("@/repository/model-group");
      const result = await listModelGroups();

      expect(result).toEqual([]);
    });

    it("returns groups with members", async () => {
      let callCount = 0;
      mockSelect.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return selectChain([sampleGroup]);
        return selectChain([{ modelGroupId: 1, model: "gpt-4" }]);
      });

      const { listModelGroups } = await import("@/repository/model-group");
      const result = await listModelGroups();

      expect(result[0].members).toContain("gpt-4");
    });
  });

  // -------------------------------------------------------------------------
  // getModelGroup
  // -------------------------------------------------------------------------

  describe("getModelGroup", () => {
    it("returns null when not found", async () => {
      mockSelect.mockReturnValue(selectChain([]));

      const { getModelGroup } = await import("@/repository/model-group");
      const result = await getModelGroup(999);

      expect(result).toBeNull();
    });

    it("returns group with members", async () => {
      let callCount = 0;
      mockSelect.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return selectChain([sampleGroup]);
        return selectChain([{ modelGroupId: 1, model: "claude-3" }]);
      });

      const { getModelGroup } = await import("@/repository/model-group");
      const result = await getModelGroup(1);

      expect(result).not.toBeNull();
      expect(result?.members).toContain("claude-3");
    });
  });

  // -------------------------------------------------------------------------
  // findModelGroupIdByModel
  // -------------------------------------------------------------------------

  describe("findModelGroupIdByModel", () => {
    it("returns null when model has no group", async () => {
      mockSelect.mockReturnValue(selectChain([]));

      const { findModelGroupIdByModel } = await import("@/repository/model-group");
      const result = await findModelGroupIdByModel("no-such-model");

      expect(result).toBeNull();
    });

    it("returns groupId when model is found", async () => {
      mockSelect.mockReturnValue(selectChain([{ modelGroupId: 5 }]));

      const { findModelGroupIdByModel } = await import("@/repository/model-group");
      const result = await findModelGroupIdByModel("gpt-4");

      expect(result).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // addModelGroupMember — conflict detection (D6)
  // -------------------------------------------------------------------------

  describe("addModelGroupMember", () => {
    it("succeeds when model has no existing group", async () => {
      mockSelect.mockReturnValue(selectChain([]));
      mockInsert.mockReturnValue(insertChain(undefined));

      const { addModelGroupMember } = await import("@/repository/model-group");
      await expect(addModelGroupMember(1, "gpt-4")).resolves.toBeUndefined();
    });

    it("is a no-op when model already belongs to the same group", async () => {
      mockSelect.mockReturnValue(selectChain([{ modelGroupId: 1, groupName: "g1" }]));

      const { addModelGroupMember } = await import("@/repository/model-group");
      await expect(addModelGroupMember(1, "gpt-4")).resolves.toBeUndefined();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("throws ModelGroupMemberConflictError when model belongs to a different group", async () => {
      mockSelect.mockReturnValue(selectChain([{ modelGroupId: 2, groupName: "other-group" }]));

      const { addModelGroupMember, ModelGroupMemberConflictError } = await import(
        "@/repository/model-group"
      );
      await expect(addModelGroupMember(1, "gpt-4")).rejects.toThrow(ModelGroupMemberConflictError);
    });

    it("conflict error contains the conflicting group info", async () => {
      mockSelect.mockReturnValue(selectChain([{ modelGroupId: 99, groupName: "conflict-grp" }]));

      const { addModelGroupMember, ModelGroupMemberConflictError } = await import(
        "@/repository/model-group"
      );

      let caught: unknown;
      try {
        await addModelGroupMember(1, "gpt-4");
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ModelGroupMemberConflictError);
      const err = caught as InstanceType<typeof ModelGroupMemberConflictError>;
      expect(err.conflictGroupId).toBe(99);
      expect(err.conflictGroupName).toBe("conflict-grp");
    });
  });

  // -------------------------------------------------------------------------
  // removeModelGroupMember
  // -------------------------------------------------------------------------

  describe("removeModelGroupMember", () => {
    it("deletes the member row", async () => {
      mockDelete.mockReturnValue(deleteChain(undefined));

      const { removeModelGroupMember } = await import("@/repository/model-group");
      await removeModelGroupMember(1, "gpt-4");

      expect(mockDelete).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // listModelGroupMembers
  // -------------------------------------------------------------------------

  describe("listModelGroupMembers", () => {
    it("returns list of model strings", async () => {
      mockSelect.mockReturnValue(selectChain([{ model: "gpt-4" }, { model: "gpt-4o" }]));

      const { listModelGroupMembers } = await import("@/repository/model-group");
      const result = await listModelGroupMembers(1);

      expect(result).toEqual(["gpt-4", "gpt-4o"]);
    });
  });

  // -------------------------------------------------------------------------
  // createSingletonModelGroup
  // -------------------------------------------------------------------------

  describe("createSingletonModelGroup", () => {
    it("creates a group and inserts a single member in a transaction", async () => {
      const txInsertResult = insertChain([{ ...sampleGroup, isSingleton: true }]);
      const tx = {
        insert: vi.fn().mockReturnValue(txInsertResult),
      };

      mockTransaction.mockImplementation(async (fn: (tx: typeof tx) => Promise<unknown>) => {
        return fn(tx);
      });

      const { createSingletonModelGroup } = await import("@/repository/model-group");
      const result = await createSingletonModelGroup("claude-3", "claude-singleton");

      expect(mockTransaction).toHaveBeenCalledOnce();
      expect(tx.insert).toHaveBeenCalledTimes(2);
      expect(result.isSingleton).toBe(true);
    });

    it("uses model name as group name when no name provided", async () => {
      const txInsertResult = insertChain([{ ...sampleGroup, name: "my-model", isSingleton: true }]);
      const tx = {
        insert: vi.fn().mockReturnValue(txInsertResult),
      };

      mockTransaction.mockImplementation(async (fn: (tx: typeof tx) => Promise<unknown>) => {
        return fn(tx);
      });

      const { createSingletonModelGroup } = await import("@/repository/model-group");
      await createSingletonModelGroup("my-model");

      const firstInsertValues = (txInsertResult.values as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(firstInsertValues.name).toBe("my-model");
    });
  });
});
