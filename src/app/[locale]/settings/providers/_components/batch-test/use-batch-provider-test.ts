"use client";

import { useCallback, useRef, useState } from "react";
import { testProviderById } from "@/lib/api-client/v1/actions/providers";

/** Max providers tested in one batch run */
export const BATCH_TEST_MAX_PROVIDERS = 100;
/** Number of providers tested concurrently */
export const BATCH_TEST_CONCURRENCY = 5;

export type BatchTestRowStatus =
  | "pending"
  | "testing"
  | "green"
  | "yellow"
  | "red"
  | "error"
  | "canceled";

export interface BatchTestRowResult {
  status: BatchTestRowStatus;
  latencyMs?: number;
  message?: string;
  responseModel?: string;
  httpStatusCode?: number;
}

interface UnifiedTestData {
  success: boolean;
  status: "green" | "yellow" | "red";
  subStatus: string;
  message: string;
  latencyMs: number;
  httpStatusCode?: number;
  model?: string;
  errorMessage?: string;
}

export interface UseBatchProviderTestResult {
  results: Record<number, BatchTestRowResult>;
  isRunning: boolean;
  run: (providerIds: number[], model?: string) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

/**
 * Client-side concurrency pool that tests providers one by one through the
 * by-id endpoint. Cancelling stops launching new tests; in-flight requests
 * finish naturally and keep their results.
 */
export function useBatchProviderTest(): UseBatchProviderTestResult {
  const [results, setResults] = useState<Record<number, BatchTestRowResult>>({});
  const [isRunning, setIsRunning] = useState(false);
  const cancelRef = useRef(false);
  const runIdRef = useRef(0);

  const setRow = useCallback((providerId: number, row: BatchTestRowResult) => {
    setResults((prev) => ({ ...prev, [providerId]: row }));
  }, []);

  const run = useCallback(
    async (providerIds: number[], model?: string) => {
      const targets = providerIds.slice(0, BATCH_TEST_MAX_PROVIDERS);
      if (targets.length === 0) return;

      const runId = ++runIdRef.current;
      cancelRef.current = false;
      setIsRunning(true);
      setResults(Object.fromEntries(targets.map((id) => [id, { status: "pending" as const }])));

      const trimmedModel = model?.trim() || undefined;
      let cursor = 0;

      const worker = async (): Promise<void> => {
        while (true) {
          if (cancelRef.current || runIdRef.current !== runId) return;
          const index = cursor;
          cursor += 1;
          if (index >= targets.length) return;
          const providerId = targets[index];

          setRow(providerId, { status: "testing" });
          try {
            const result = await testProviderById(
              providerId,
              trimmedModel ? { model: trimmedModel } : undefined
            );
            if (runIdRef.current !== runId) return;
            if (result.ok) {
              const data = result.data as UnifiedTestData;
              setRow(providerId, {
                status: data.status,
                latencyMs: data.latencyMs,
                message: data.errorMessage ?? data.message,
                responseModel: data.model,
                httpStatusCode: data.httpStatusCode,
              });
            } else {
              setRow(providerId, { status: "error", message: result.error });
            }
          } catch (error) {
            if (runIdRef.current !== runId) return;
            setRow(providerId, {
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      };

      const workerCount = Math.min(BATCH_TEST_CONCURRENCY, targets.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      if (runIdRef.current !== runId) return;

      if (cancelRef.current) {
        setResults((prev) => {
          const next = { ...prev };
          for (const id of targets) {
            if (next[id]?.status === "pending") {
              next[id] = { status: "canceled" };
            }
          }
          return next;
        });
      }
      setIsRunning(false);
    },
    [setRow]
  );

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    cancelRef.current = false;
    setResults({});
    setIsRunning(false);
  }, []);

  return { results, isRunning, run, cancel, reset };
}
