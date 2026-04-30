"use client";

import { apiClient } from "@/lib/api-client/v1/client";
import { ApiError } from "@/lib/api-client/v1/errors";
import type { ActionResult } from "./types";

export function toActionResult<T = any>(promise: Promise<T>): Promise<ActionResult<T>> {
  return promise
    .then((data) => ({ ok: true as const, data }) as ActionResult<T>)
    .catch(
      (error): ActionResult<T> => ({
        ok: false as const,
        error: error instanceof Error ? error.message : "Request failed",
        errorCode: error instanceof ApiError ? error.errorCode : undefined,
        errorParams: error instanceof ApiError ? toActionErrorParams(error.errorParams) : undefined,
      })
    );
}

export function toVoidActionResult(promise: Promise<unknown>): Promise<ActionResult> {
  return promise
    .then(() => ({ ok: true as const }) as ActionResult)
    .catch(
      (error): ActionResult => ({
        ok: false as const,
        error: error instanceof Error ? error.message : "Request failed",
        errorCode: error instanceof ApiError ? error.errorCode : undefined,
        errorParams: error instanceof ApiError ? toActionErrorParams(error.errorParams) : undefined,
      })
    );
}

export function searchParams(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    if (value instanceof Date) {
      search.set(key, value.toISOString());
    } else if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.map(String).join(","));
    } else if (["string", "number", "boolean"].includes(typeof value)) {
      search.set(key, String(value));
    }
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

export function unwrapItems<T>(body: { items?: T[] } | T[]): T[] {
  return Array.isArray(body) ? body : (body.items ?? []);
}

export interface LegacyCursor {
  createdAt: string;
  id: number;
}

export function normalizeLegacyCursor(value: unknown): LegacyCursor | null {
  if (!value) return null;
  if (typeof value === "string") return decodeLegacyCursorToken(value);
  if (typeof value !== "object") return null;

  const cursor = value as { createdAt?: unknown; id?: unknown };
  if (typeof cursor.createdAt !== "string") return null;

  const id = typeof cursor.id === "number" ? cursor.id : Number(cursor.id);
  return Number.isSafeInteger(id) && id > 0 ? { createdAt: cursor.createdAt, id } : null;
}

export function legacyCursorQueryEntries(value: unknown): [string, string | number][] {
  const cursor = normalizeLegacyCursor(value);
  return cursor
    ? [
        ["cursorCreatedAt", cursor.createdAt],
        ["cursorId", cursor.id],
      ]
    : [];
}

export function apiGet<T = any>(path: string): Promise<T> {
  return apiClient.get<T>(path);
}

export function apiPost<T = any>(
  path: string,
  body?: unknown,
  options?: Parameters<typeof apiClient.post>[2]
): Promise<T> {
  return apiClient.post<T>(path, body, options);
}

export function apiPut<T = any>(path: string, body?: unknown): Promise<T> {
  return apiClient.put<T>(path, body);
}

export function apiPatch<T = any>(path: string, body?: unknown): Promise<T> {
  return apiClient.patch<T>(path, body);
}

export async function apiPatchWithHeaders<T = any>(
  path: string,
  body?: unknown
): Promise<{ body: T; headers: Headers }> {
  let responseHeaders = new Headers();
  const responseBody = await apiClient.patch<T>(path, body, {
    onResponse: (response) => {
      responseHeaders = response.headers;
    },
  });
  return { body: responseBody, headers: responseHeaders };
}

export function apiDelete<T = void>(path: string): Promise<T> {
  return apiClient.delete<T>(path);
}

export async function apiDeleteWithHeaders<T = void>(
  path: string
): Promise<{ body: T; headers: Headers }> {
  let responseHeaders = new Headers();
  const body = await apiClient.delete<T>(path, {
    onResponse: (response) => {
      responseHeaders = response.headers;
    },
  });
  return { body, headers: responseHeaders };
}

export async function apiFetchWithHeaders<T = any>(
  path: string,
  options: Parameters<typeof fetch>[1] & { body?: unknown } = {}
): Promise<{ body: T; headers: Headers }> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  const hasBody = options.body !== undefined;
  if (hasBody) headers.set("Content-Type", "application/json");

  const response = await fetch(path, {
    ...options,
    credentials: options.credentials ?? "include",
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(response.statusText || "Request failed");
  }

  const body = response.status === 204 ? undefined : await response.json();
  return { body: body as T, headers: response.headers };
}

export function mergeHeadersIntoBody<T extends object>(
  body: T,
  headers: Headers,
  names: string[]
): T {
  const headerValues = Object.fromEntries(
    names.flatMap((name) => {
      const value = headers.get(name);
      return value ? [[toCamelCase(name), value]] : [];
    })
  );
  return { ...body, ...headerValues };
}

function toCamelCase(header: string): string {
  return header
    .toLowerCase()
    .split("-")
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/*
 * Legacy action-style compatibility helpers intentionally default to `any`.
 * The old Server Actions were consumed directly by UI files with inferred,
 * wide return shapes; this layer preserves that migration boundary while the
 * new REST hooks mature per resource.
 */
export function apiPostLegacy<T = any>(path: string, body?: unknown): Promise<T> {
  return apiClient.post<T>(path, body);
}

function toActionErrorParams(
  params: Record<string, unknown> | undefined
): Record<string, string | number> | undefined {
  if (!params) return undefined;
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] =>
      typeof entry[1] === "string" || typeof entry[1] === "number"
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function decodeLegacyCursorToken(token: string): LegacyCursor | null {
  try {
    if (typeof globalThis.atob !== "function") return null;

    const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(globalThis.atob(padded), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;

    return parsed && typeof parsed === "object" ? normalizeLegacyCursor(parsed) : null;
  } catch {
    return null;
  }
}
