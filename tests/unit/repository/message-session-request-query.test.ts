import { beforeEach, describe, expect, test, vi } from "vitest";
import { messageRequest } from "@/drizzle/schema";
import { keys as keysTable } from "@/drizzle/schema";
import {
  findAdjacentSessionRequests,
  findAdjacentRequestSequences,
  findRequestsBySessionId,
  findRequestsBySessionIdentity,
  findSessionRequestLocator,
  listPhysicalSessionSourcesForIdentity,
} from "@/repository/message";
import { createDrizzleQuery, sqlText } from "./message-query-test-support";

const boundary = vi.hoisted(() => {
  const writerDb = { execute: vi.fn<(query: unknown) => Promise<readonly unknown[]>>() };
  return {
    select: vi.fn<(selection?: unknown) => unknown>(),
    execute: vi.fn<(query: unknown) => Promise<readonly unknown[]>>(),
    ledgerOnly: vi.fn<() => Promise<boolean>>(),
    getWriterDb: vi.fn(() => writerDb),
  };
});

vi.mock("@/drizzle/db", () => ({
  db: { select: boundary.select, execute: boundary.execute },
  getMessageWriterDb: boundary.getWriterDb,
}));
vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => ({ MESSAGE_REQUEST_WRITE_MODE: "sync" }),
  isDevelopment: () => false,
}));
vi.mock("@/lib/ledger-fallback", () => ({ isLedgerOnlyMode: boundary.ledgerOnly }));

type MessageRow = typeof messageRequest.$inferSelect;
type RequestRow = Pick<
  MessageRow,
  | "id"
  | "model"
  | "statusCode"
  | "costUsd"
  | "createdAt"
  | "inputTokens"
  | "outputTokens"
  | "errorMessage"
  | "sessionId"
> & { readonly sequence: MessageRow["requestSequence"] };

const firstCreatedAt = new Date("2026-05-04T10:00:00.000Z");
const secondCreatedAt = new Date("2026-05-04T10:01:00.000Z");

describe("message repository session request queries", () => {
  beforeEach(() => {
    boundary.select.mockReset();
    boundary.execute.mockReset();
    boundary.ledgerOnly.mockReset();
  });

  test("returns the default page in ascending sequence order", async () => {
    const count = createDrizzleQuery([{ count: 2 }]);
    const rows = createDrizzleQuery<readonly RequestRow[]>([
      {
        id: 31,
        sessionId: "session-requests",
        sequence: null,
        model: "model-a",
        statusCode: 200,
        costUsd: "0.100000000000000",
        createdAt: firstCreatedAt,
        inputTokens: 10,
        outputTokens: 5,
        errorMessage: null,
      },
      {
        id: 32,
        sessionId: "session-requests",
        sequence: 3,
        model: "model-b",
        statusCode: 429,
        costUsd: "0.200000000000000",
        createdAt: secondCreatedAt,
        inputTokens: 20,
        outputTokens: 8,
        errorMessage: "rate limited",
      },
    ]);
    boundary.select.mockReturnValueOnce(count).mockReturnValueOnce(rows);

    const result = await findRequestsBySessionId("session-requests");

    expect(result).toEqual({
      total: 2,
      requests: [
        {
          id: 31,
          sourceSessionId: "session-requests",
          sequence: 1,
          model: "model-a",
          statusCode: 200,
          costUsd: "0.100000000000000",
          createdAt: firstCreatedAt,
          inputTokens: 10,
          outputTokens: 5,
          errorMessage: null,
        },
        {
          id: 32,
          sourceSessionId: "session-requests",
          sequence: 3,
          model: "model-b",
          statusCode: 429,
          costUsd: "0.200000000000000",
          createdAt: secondCreatedAt,
          inputTokens: 20,
          outputTokens: 8,
          errorMessage: "rate limited",
        },
      ],
    });
    expect(count.trace.from).toEqual([messageRequest]);
    expect(rows.trace.from).toEqual([messageRequest]);
    expect(sqlText(rows.trace.where)).toContain("session-requests");
    expect(sqlText(rows.trace.where)).toContain("deleted_at");
    expect(sqlText(rows.trace.orderBy)).toContain("request_sequence asc");
    expect(rows.trace.limit).toEqual([20]);
    expect(rows.trace.offset).toEqual([0]);
  });

  test("applies descending order and explicit pagination", async () => {
    const count = createDrizzleQuery([{ count: 5 }]);
    const rows = createDrizzleQuery<readonly RequestRow[]>([
      {
        id: 35,
        sessionId: "session-desc",
        sequence: 5,
        model: null,
        statusCode: null,
        costUsd: null,
        createdAt: secondCreatedAt,
        inputTokens: null,
        outputTokens: null,
        errorMessage: null,
      },
    ]);
    boundary.select.mockReturnValueOnce(count).mockReturnValueOnce(rows);

    const result = await findRequestsBySessionId("session-desc", {
      limit: 1,
      offset: 2,
      order: "desc",
    });

    expect(result.total).toBe(5);
    expect(result.requests.map(({ sequence }) => sequence)).toEqual([5]);
    expect(sqlText(rows.trace.orderBy)).toContain("request_sequence desc");
    expect(rows.trace.limit).toEqual([1]);
    expect(rows.trace.offset).toEqual([2]);
  });

  test("preserves the physical source Session for requests aggregated by prefix identity", async () => {
    const count = createDrizzleQuery([{ count: 2 }]);
    const rows = createDrizzleQuery<readonly RequestRow[]>([
      {
        id: 41,
        sessionId: "physical-a",
        sequence: 1,
        model: "model-a",
        statusCode: 200,
        costUsd: "0",
        createdAt: firstCreatedAt,
        inputTokens: 10,
        outputTokens: 5,
        errorMessage: null,
      },
      {
        id: 42,
        sessionId: "physical-b",
        sequence: 1,
        model: "model-b",
        statusCode: 200,
        costUsd: "0",
        createdAt: secondCreatedAt,
        inputTokens: 20,
        outputTokens: 8,
        errorMessage: null,
      },
    ]);
    boundary.select.mockReturnValueOnce(count).mockReturnValueOnce(rows);

    const result = await findRequestsBySessionIdentity("pfx:scope:fingerprint");

    expect(
      result.requests.map(({ sourceSessionId, sequence }) => ({ sourceSessionId, sequence }))
    ).toEqual([
      { sourceSessionId: "physical-a", sequence: 1 },
      { sourceSessionId: "physical-b", sequence: 1 },
    ]);
    expect(sqlText(count.trace.where)).toContain("is_replay");
    expect(sqlText(count.trace.where)).toContain("false");
    expect(sqlText(rows.trace.where)).toContain("pfx:scope:fingerprint");
    expect(sqlText(rows.trace.where)).toContain("is_replay");
    expect(sqlText(rows.trace.where)).toContain("false");
  });

  test("resolves an exact request locator inside a prefix identity", async () => {
    const locator = createDrizzleQuery([
      {
        requestId: 203,
        sourceSessionId: "physical-a",
        requestSequence: 3,
        identityKind: "prefix_affinity",
        scopeTag: "scope",
        fingerprint: "fingerprint",
      },
    ]);
    boundary.select.mockReturnValueOnce(locator);

    await expect(
      findSessionRequestLocator("pfx:scope:fingerprint", {
        requestId: 203,
        sourceSessionId: "physical-a",
        requestSequence: 3,
      })
    ).resolves.toEqual({
      requestId: 203,
      sourceSessionId: "physical-a",
      requestSequence: 3,
      identityKind: "prefix_affinity",
      scopeTag: "scope",
      fingerprint: "fingerprint",
    });

    const where = sqlText(locator.trace.where);
    expect(where).toContain("pfx:scope:fingerprint");
    expect(where).toContain("physical-a");
    expect(where).toContain("= 3");
    expect(where).toContain("= 203");
    expect(where).toContain("deleted_at");
  });

  test("lists distinct physical Session and Provider pairs for prefix termination", async () => {
    const sources = createDrizzleQuery([
      { sessionId: "physical-a", providerId: 41, finalProviderId: 42, userId: 7, keyId: 17 },
      { sessionId: "physical-a", providerId: 0, finalProviderId: 0, userId: 7, keyId: 17 },
      { sessionId: "physical-a", providerId: 42, finalProviderId: 42, userId: 7, keyId: 17 },
      { sessionId: "physical-a", providerId: 44, finalProviderId: 44, userId: 9, keyId: 19 },
      { sessionId: "physical-b", providerId: 43, finalProviderId: 43, userId: 8, keyId: 18 },
    ]);
    boundary.select.mockReturnValueOnce(sources);

    await expect(listPhysicalSessionSourcesForIdentity("pfx:scope:fingerprint")).resolves.toEqual([
      { sessionId: "physical-a", userId: 7, keyId: 17, providerIds: [41, 42] },
      { sessionId: "physical-a", userId: 9, keyId: 19, providerIds: [44] },
      { sessionId: "physical-b", userId: 8, keyId: 18, providerIds: [43] },
    ]);

    expect(sqlText(sources.trace.where)).toContain("pfx:scope:fingerprint");
    expect(sqlText(sources.trace.where)).toContain("session_id");
    expect(sqlText(sources.trace.where)).toContain("is_replay");
    expect(sqlText(sources.trace.where)).toContain("false");
    expect(sqlText(sources.trace.where)).toContain("deleted_at");
    expect(sqlText(sources.trace.where)).toContain("latest.created_at desc");
    expect(sources.trace.innerJoins.map(({ source }) => source)).toEqual([keysTable]);
    const selection = sqlText(boundary.select.mock.calls.at(0)?.at(0)).toLowerCase();
    expect(selection).toContain("provider_chain");
    expect(selection).toContain("-> -1");
    expect(selection).toContain("coalesce");
  });

  test("returns adjacent neighbors using session-scoped sequence predicates", async () => {
    const previous = createDrizzleQuery([{ sequence: 4 }]);
    const next = createDrizzleQuery([{ sequence: 9 }]);
    boundary.select.mockReturnValueOnce(previous).mockReturnValueOnce(next);

    const result = await findAdjacentRequestSequences("session-neighbors", 6);

    expect(result).toEqual({ prevSequence: 4, nextSequence: 9 });
    expect(previous.trace.from).toEqual([messageRequest]);
    expect(next.trace.from).toEqual([messageRequest]);
    expect(sqlText(previous.trace.where)).toContain("session-neighbors");
    expect(sqlText(previous.trace.where)).toContain("request_sequence < 6");
    expect(sqlText(next.trace.where)).toContain("request_sequence > 6");
    expect(sqlText(boundary.select.mock.calls.at(0)?.at(0))).toContain("max");
    expect(sqlText(boundary.select.mock.calls.at(1)?.at(0))).toContain("min");
  });

  test("returns null neighbors when neither adjacent sequence exists", async () => {
    boundary.select
      .mockReturnValueOnce(createDrizzleQuery([{ sequence: null }]))
      .mockReturnValueOnce(createDrizzleQuery<readonly { readonly sequence: number | null }[]>([]));

    const result = await findAdjacentRequestSequences("session-isolated", 1);

    expect(result).toEqual({ prevSequence: null, nextSequence: null });
  });

  test("returns adjacent requests across physical sources on the public identity timeline", async () => {
    const current = createDrizzleQuery([{ requestId: 302, createdAt: secondCreatedAt }]);
    const previous = createDrizzleQuery([
      { requestId: 301, sourceSessionId: "physical-a", requestSequence: 2 },
    ]);
    const next = createDrizzleQuery([
      { requestId: 303, sourceSessionId: "physical-b", requestSequence: 1 },
    ]);
    boundary.select
      .mockReturnValueOnce(current)
      .mockReturnValueOnce(previous)
      .mockReturnValueOnce(next);

    await expect(findAdjacentSessionRequests("pfx:scope:fingerprint", 302)).resolves.toEqual({
      prevRequest: { requestId: 301, sourceSessionId: "physical-a", requestSequence: 2 },
      nextRequest: { requestId: 303, sourceSessionId: "physical-b", requestSequence: 1 },
    });
    expect(sqlText(current.trace.where)).toContain("pfx:scope:fingerprint");
    expect(sqlText(current.trace.where)).toContain("= 302");
    expect(sqlText(current.trace.where)).toContain("is_replay");
    expect(sqlText(current.trace.where)).toContain("false");
    expect(sqlText(previous.trace.where)).toContain("created_at");
    expect(sqlText(previous.trace.where)).toContain("is_replay");
    expect(sqlText(previous.trace.where)).toContain("false");
    expect(sqlText(previous.trace.orderBy)).toContain("created_at desc");
    expect(sqlText(previous.trace.orderBy)).toContain("id desc");
    expect(sqlText(next.trace.where)).toContain("created_at");
    expect(sqlText(next.trace.where)).toContain("is_replay");
    expect(sqlText(next.trace.where)).toContain("false");
    expect(sqlText(next.trace.orderBy)).toContain("created_at asc");
    expect(sqlText(next.trace.orderBy)).toContain("id asc");
    expect(previous.trace.limit).toEqual([1]);
    expect(next.trace.limit).toEqual([1]);
  });
});
