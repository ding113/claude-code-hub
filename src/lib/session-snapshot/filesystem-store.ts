import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { logger } from "@/lib/logger";
import type {
  SessionSnapshotData,
  SessionSnapshotKey,
  SessionSnapshotStore,
  StoredSessionSnapshotEnvelope,
} from "./types";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const DEFAULT_MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_PENDING_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_DIRECTORY_BYTES = 10 * 1024 * 1024 * 1024;
const FILE_LOCK_WAIT_MS = 2_000;
const FILE_LOCK_STALE_MS = 60_000;
const TEMP_FILE_STALE_MS = 10 * 60_000;

interface FilesystemStoreOptions {
  root: string;
  maxSnapshotBytes?: number;
  maxPendingBytes?: number;
  maxDirectoryBytes?: number;
  cleanupIntervalMs?: number;
}

interface PendingWrite {
  key: SessionSnapshotKey;
  patch: SessionSnapshotData;
  bytes: number;
  ttlSeconds: number;
  completion: () => void;
}

interface SnapshotFileEntry {
  path: string;
  size: number;
  expiresAt: number;
}

export class FilesystemSessionSnapshotStore implements SessionSnapshotStore {
  private readonly root: string;
  private readonly maxSnapshotBytes: number;
  private readonly maxPendingBytes: number;
  private readonly maxDirectoryBytes: number;
  private readonly cleanupIntervalMs: number;
  private readonly queue: PendingWrite[] = [];
  private readonly keyTails = new Map<string, Promise<void>>();
  private pendingBytes = 0;
  private accepting = true;
  private started = false;
  private draining = false;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private lastDropWarningAt = 0;

  constructor(options: FilesystemStoreOptions) {
    this.root = path.resolve(options.root);
    this.maxSnapshotBytes = options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES;
    this.maxPendingBytes = options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES;
    this.maxDirectoryBytes = options.maxDirectoryBytes ?? DEFAULT_MAX_DIRECTORY_BYTES;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;
  }

  enqueuePatch(key: SessionSnapshotKey, patch: SessionSnapshotData, ttlSeconds: number): boolean {
    if (!this.accepting || ttlSeconds <= 0 || key.sequence <= 0) return false;

    let serialized: Buffer;
    try {
      serialized = Buffer.from(JSON.stringify(patch), "utf8");
    } catch (error) {
      this.warnDropped("serialization_failed", error);
      return false;
    }

    if (serialized.byteLength > this.maxSnapshotBytes) {
      this.warnDropped("snapshot_too_large", { bytes: serialized.byteLength });
      return false;
    }
    if (this.pendingBytes + serialized.byteLength > this.maxPendingBytes) {
      this.warnDropped("pending_budget_exceeded", {
        bytes: serialized.byteLength,
        pendingBytes: this.pendingBytes,
      });
      return false;
    }

    const filePath = this.resolveFilePath(key);
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const prior = this.keyTails.get(filePath) ?? Promise.resolve();
    const tail = prior.then(() => completion);
    this.keyTails.set(filePath, tail);
    void tail.finally(() => {
      if (this.keyTails.get(filePath) === tail) this.keyTails.delete(filePath);
    });

    this.pendingBytes += serialized.byteLength;
    this.queue.push({
      key,
      patch,
      bytes: serialized.byteLength,
      ttlSeconds,
      completion: complete,
    });
    void this.start().then(() => this.drain());
    return true;
  }

  async get(key: SessionSnapshotKey): Promise<SessionSnapshotData | null> {
    if (!this.accepting) return null;
    await this.start();
    const filePath = this.resolveFilePath(key);
    await this.keyTails.get(filePath);
    const envelope = await this.readEnvelope(filePath);
    if (!envelope) return null;
    if (envelope.expiresAt <= Date.now()) {
      await unlink(filePath).catch(() => undefined);
      return null;
    }
    return envelope.data;
  }

  async start(): Promise<void> {
    if (this.stopPromise) await this.stopPromise;
    if (this.started && this.accepting) return;
    if (this.startPromise) return await this.startPromise;

    this.startPromise = (async () => {
      this.accepting = true;
      await this.ensureRoot();
      this.started = true;
      if (this.cleanupIntervalMs > 0) {
        this.cleanupTimer = setInterval(() => {
          void this.cleanup().catch((error) => {
            logger.warn("[SessionSnapshot] Filesystem cleanup failed", { error });
          });
        }, this.cleanupIntervalMs);
        this.cleanupTimer.unref?.();
      }
      void this.cleanup().catch((error) => {
        logger.warn("[SessionSnapshot] Initial filesystem cleanup failed", { error });
      });
    })();

    try {
      await this.startPromise;
    } catch (error) {
      this.accepting = false;
      logger.error("[SessionSnapshot] Filesystem store failed to start", {
        root: this.root,
        error,
      });
      throw error;
    } finally {
      this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return await this.stopPromise;
    this.accepting = false;
    this.stopPromise = (async () => {
      if (this.startPromise) {
        await this.startPromise.catch(() => undefined);
      }
      if (this.cleanupTimer) clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      await Promise.race([this.waitForDrain(), delay(5_000)]);
      this.started = false;
    })();

    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  async cleanup(): Promise<void> {
    await this.ensureRoot();
    const cleanupLock = path.join(this.root, ".cleanup.lock");
    if (!(await this.acquireCleanupLock(cleanupLock))) return;

    try {
      const entries = await this.collectSnapshotFiles(path.join(this.root, "v1"));
      const now = Date.now();
      const remaining: SnapshotFileEntry[] = [];
      for (const entry of entries) {
        if (entry.expiresAt <= now) {
          await unlink(entry.path).catch(() => undefined);
        } else {
          remaining.push(entry);
        }
      }

      let totalBytes = remaining.reduce((sum, entry) => sum + entry.size, 0);
      if (totalBytes > this.maxDirectoryBytes) {
        remaining.sort((a, b) => a.expiresAt - b.expiresAt);
        for (const entry of remaining) {
          if (totalBytes <= this.maxDirectoryBytes) break;
          await unlink(entry.path).catch(() => undefined);
          totalBytes -= entry.size;
        }
      }
    } finally {
      await rm(cleanupLock, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async drain(): Promise<void> {
    if (this.draining || !this.started) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (!job) break;
        this.pendingBytes = Math.max(0, this.pendingBytes - job.bytes);
        try {
          await this.writePatch(job);
        } catch (error) {
          logger.warn("[SessionSnapshot] Filesystem write dropped", {
            error,
            kind: job.key.kind,
            phase: job.key.phase,
            sequence: job.key.sequence,
          });
        } finally {
          job.completion();
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length > 0) void this.drain();
    }
  }

  private async waitForDrain(): Promise<void> {
    while (this.draining || this.queue.length > 0) {
      await delay(10);
    }
  }

  private async writePatch(job: PendingWrite): Promise<void> {
    const filePath = this.resolveFilePath(job.key);
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const release = await this.acquireFileLock(`${filePath}.lock`);
    if (!release) throw new Error("snapshot file lock timeout");

    try {
      const existing = await this.readEnvelope(filePath);
      const now = Date.now();
      const envelope: StoredSessionSnapshotEnvelope = {
        version: 1,
        expiresAt: now + job.ttlSeconds * 1000,
        updatedAt: now,
        data: {
          ...(existing && existing.expiresAt > now ? existing.data : {}),
          ...job.patch,
        },
      };
      const payload = Buffer.from(JSON.stringify(envelope), "utf8");
      if (payload.byteLength > this.maxSnapshotBytes) {
        throw new Error(`snapshot exceeds ${this.maxSnapshotBytes} bytes`);
      }
      const compressed = await gzipAsync(payload, { level: 1 });
      const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
      const handle = await open(tempPath, "wx", 0o600);
      try {
        await handle.writeFile(compressed);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await chmod(tempPath, 0o600);
      await utimes(tempPath, now / 1000, envelope.expiresAt / 1000);
      await rename(tempPath, filePath);
    } finally {
      await release();
    }
  }

  private async readEnvelope(filePath: string): Promise<StoredSessionSnapshotEnvelope | null> {
    try {
      const fileStat = await lstat(filePath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) return null;
      const compressed = await readFile(filePath);
      const decompressed = await gunzipAsync(compressed, {
        maxOutputLength: this.maxSnapshotBytes,
      });
      const parsed: unknown = JSON.parse(decompressed.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const envelope = parsed as Partial<StoredSessionSnapshotEnvelope>;
      if (
        envelope.version !== 1 ||
        typeof envelope.expiresAt !== "number" ||
        typeof envelope.updatedAt !== "number" ||
        !envelope.data ||
        typeof envelope.data !== "object" ||
        Array.isArray(envelope.data)
      ) {
        return null;
      }
      return envelope as StoredSessionSnapshotEnvelope;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      logger.warn("[SessionSnapshot] Filesystem read ignored invalid snapshot", {
        filePath,
        error,
      });
      return null;
    }
  }

  private resolveFilePath(key: SessionSnapshotKey): string {
    const sessionHash = createHash("sha256").update(key.sessionId).digest("hex");
    const relative = path.join(
      "v1",
      sessionHash.slice(0, 2),
      sessionHash,
      String(key.sequence),
      `${key.kind}-${key.phase}.json.gz`
    );
    const resolved = path.resolve(this.root, relative);
    if (!resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new Error("snapshot path escapes configured root");
    }
    return resolved;
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const rootStat = await lstat(this.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("session snapshot root must be a real directory");
    }
    await chmod(this.root, 0o700);
  }

  private async acquireFileLock(lockPath: string): Promise<(() => Promise<void>) | null> {
    const deadline = Date.now() + FILE_LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        return async () => {
          await rm(lockPath, { recursive: true, force: true });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const lockStat = await stat(lockPath).catch(() => null);
        if (lockStat && Date.now() - lockStat.mtimeMs > FILE_LOCK_STALE_MS) {
          await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
          continue;
        }
        await delay(10);
      }
    }
    return null;
  }

  private async acquireCleanupLock(lockPath: string): Promise<boolean> {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockStat = await stat(lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > FILE_LOCK_STALE_MS) {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        return await this.acquireCleanupLock(lockPath);
      }
      return false;
    }
  }

  private async collectSnapshotFiles(directory: string): Promise<SnapshotFileEntry[]> {
    const entries: SnapshotFileEntry[] = [];
    const children = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      const childPath = path.join(directory, child.name);
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        entries.push(...(await this.collectSnapshotFiles(childPath)));
        continue;
      }
      if (!child.isFile()) continue;
      const fileStat = await stat(childPath).catch(() => null);
      if (!fileStat) continue;
      if (child.name.includes(".tmp-")) {
        if (Date.now() - fileStat.mtimeMs > TEMP_FILE_STALE_MS) {
          await unlink(childPath).catch(() => undefined);
        }
        continue;
      }
      if (!child.name.endsWith(".json.gz")) continue;
      entries.push({ path: childPath, size: fileStat.size, expiresAt: fileStat.mtimeMs });
    }
    return entries;
  }

  private warnDropped(reason: string, details: unknown): void {
    const now = Date.now();
    if (now - this.lastDropWarningAt < 30_000) return;
    this.lastDropWarningAt = now;
    logger.warn("[SessionSnapshot] Filesystem snapshot dropped", { reason, details });
  }
}
