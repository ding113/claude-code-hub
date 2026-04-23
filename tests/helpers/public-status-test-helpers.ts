import { readFile } from "node:fs/promises";
import path from "node:path";
import { vi } from "vitest";

export function repoPath(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

export async function readRepoFile(relativePath: string): Promise<string> {
  const absolutePath = repoPath(relativePath);

  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(
      `Missing implementation file ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function importPublicStatusModule<T>(modulePath: string): Promise<T> {
  try {
    return (await import(/* @vite-ignore */ modulePath)) as T;
  } catch (error) {
    throw new Error(
      `Missing or unfinished public-status implementation for ${modulePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export function listStaticImports(source: string): string[] {
  const fromMatches = [...source.matchAll(/from\\s+["']([^"']+)["']/g)].map((match) => match[1]);
  const sideEffectMatches = [...source.matchAll(/import\\s+["']([^"']+)["']/g)].map(
    (match) => match[1]
  );
  const dynamicMatches = [...source.matchAll(/import\\(\\s*["']([^"']+)["']\\s*\\)/g)].map(
    (match) => match[1]
  );
  return Array.from(new Set([...fromMatches, ...sideEffectMatches, ...dynamicMatches]));
}

export function createForbiddenCallSpy(label: string) {
  return vi.fn(() => {
    throw new Error(`Forbidden dependency invoked: ${label}`);
  });
}

export function createRedisClientSpy(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    mget: vi.fn(),
    expire: vi.fn(),
    eval: vi.fn(),
    setnx: vi.fn(),
    ...overrides,
  };
}
