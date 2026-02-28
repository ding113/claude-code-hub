import { type MockInstance, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { mockSpawn, mockCreateReadStream } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockCreateReadStream: vi.fn(() => ({ pipe: vi.fn(), on: vi.fn() })),
}));

vi.mock("node:child_process", () => ({
  default: { spawn: mockSpawn },
  spawn: mockSpawn,
}));

vi.mock("node:fs", () => ({
  default: { createReadStream: mockCreateReadStream },
  createReadStream: mockCreateReadStream,
}));

vi.mock("@/drizzle/db", () => ({
  db: { execute: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ..._values: unknown[]) => ({
    strings,
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/database-backup/db-config", () => ({
  getDatabaseConfig: vi.fn(() => ({
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "secret",
    database: "testdb",
  })),
}));

function makeFakeProcess(opts?: { withStdin?: boolean }) {
  return {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: opts?.withStdin ? { write: vi.fn(), end: vi.fn() } : null,
    on: vi.fn(),
    kill: vi.fn(),
  };
}

describe("getDockerComposeExec", () => {
  const saved = process.env.PG_COMPOSE_EXEC;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.PG_COMPOSE_EXEC;
    } else {
      process.env.PG_COMPOSE_EXEC = saved;
    }
  });

  test("returns null when PG_COMPOSE_EXEC is unset", async () => {
    delete process.env.PG_COMPOSE_EXEC;
    const { getDockerComposeExec } = await import("@/lib/database-backup/docker-executor");
    expect(getDockerComposeExec()).toBeNull();
  });

  test("returns null when PG_COMPOSE_EXEC is empty string", async () => {
    process.env.PG_COMPOSE_EXEC = "";
    const { getDockerComposeExec } = await import("@/lib/database-backup/docker-executor");
    expect(getDockerComposeExec()).toBeNull();
  });

  test("parses command with spaces correctly", async () => {
    process.env.PG_COMPOSE_EXEC = "docker compose -f /home/dev/docker-compose.yaml -p cch-dev";
    const { getDockerComposeExec } = await import("@/lib/database-backup/docker-executor");
    expect(getDockerComposeExec()).toEqual([
      "docker",
      "compose",
      "-f",
      "/home/dev/docker-compose.yaml",
      "-p",
      "cch-dev",
    ]);
  });
});

describe("spawnPgTool", () => {
  const saved = process.env.PG_COMPOSE_EXEC;

  beforeEach(() => {
    mockSpawn.mockReset();
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.PG_COMPOSE_EXEC;
    } else {
      process.env.PG_COMPOSE_EXEC = saved;
    }
  });

  test("direct mode: spawns the command directly with merged env", async () => {
    delete process.env.PG_COMPOSE_EXEC;
    const fakeProc = makeFakeProcess();
    mockSpawn.mockReturnValue(fakeProc);

    const { spawnPgTool } = await import("@/lib/database-backup/docker-executor");
    const result = spawnPgTool("pg_dump", ["-h", "localhost"], {
      PGPASSWORD: "secret",
    });

    expect(result).toBe(fakeProc);
    expect(mockSpawn).toHaveBeenCalledWith(
      "pg_dump",
      ["-h", "localhost"],
      expect.objectContaining({
        env: expect.objectContaining({ PGPASSWORD: "secret" }),
      })
    );
  });

  test("docker exec mode: wraps command with docker compose exec", async () => {
    process.env.PG_COMPOSE_EXEC = "docker compose -f /dev/dc.yaml -p proj";
    const fakeProc = makeFakeProcess();
    mockSpawn.mockReturnValue(fakeProc);

    const { spawnPgTool } = await import("@/lib/database-backup/docker-executor");
    const result = spawnPgTool("pg_dump", ["-Fc", "-v"], {
      PGPASSWORD: "secret",
    });

    expect(result).toBe(fakeProc);
    expect(mockSpawn).toHaveBeenCalledWith(
      "docker",
      [
        "compose",
        "-f",
        "/dev/dc.yaml",
        "-p",
        "proj",
        "exec",
        "-T",
        "-e",
        "PGPASSWORD=secret",
        "postgres",
        "pg_dump",
        "-Fc",
        "-v",
      ],
      expect.objectContaining({ env: expect.any(Object) })
    );
  });

  test("docker exec mode with stdin: adds -i flag", async () => {
    process.env.PG_COMPOSE_EXEC = "docker compose -p proj";
    const fakeProc = makeFakeProcess({ withStdin: true });
    mockSpawn.mockReturnValue(fakeProc);

    const { spawnPgTool } = await import("@/lib/database-backup/docker-executor");
    spawnPgTool("pg_restore", ["-d", "mydb"], { PGPASSWORD: "pw" }, { stdin: true });

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    // -T and -i should both be present before "postgres"
    const postgresIdx = spawnArgs.indexOf("postgres");
    const flags = spawnArgs.slice(spawnArgs.indexOf("exec") + 1, postgresIdx);
    expect(flags).toContain("-T");
    expect(flags).toContain("-i");
  });

  test("docker exec mode without PGPASSWORD: no -e flag", async () => {
    process.env.PG_COMPOSE_EXEC = "docker compose -p proj";
    const fakeProc = makeFakeProcess();
    mockSpawn.mockReturnValue(fakeProc);

    const { spawnPgTool } = await import("@/lib/database-backup/docker-executor");
    spawnPgTool("pg_dump", [], {});

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).not.toContain("-e");
  });
});

describe("checkDatabaseConnection", () => {
  test("returns true when db.execute succeeds", async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance).mockResolvedValueOnce([{ "?column?": 1 }]);

    const { checkDatabaseConnection } = await import("@/lib/database-backup/docker-executor");
    expect(await checkDatabaseConnection()).toBe(true);
  });

  test("returns false when db.execute throws", async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance).mockRejectedValueOnce(new Error("connection refused"));

    const { checkDatabaseConnection } = await import("@/lib/database-backup/docker-executor");
    expect(await checkDatabaseConnection()).toBe(false);
  });
});

describe("getDatabaseInfo", () => {
  test("parses SQL result correctly", async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance).mockResolvedValueOnce([
      {
        size: "42 MB",
        table_count: "15",
        version: "PostgreSQL 16.2 on aarch64-apple-darwin",
      },
    ]);

    const { getDatabaseInfo } = await import("@/lib/database-backup/docker-executor");
    const info = await getDatabaseInfo();

    expect(info).toEqual({
      size: "42 MB",
      tableCount: 15,
      version: "PostgreSQL",
    });
  });

  test("returns defaults when row fields are missing", async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance).mockResolvedValueOnce([{}]);

    const { getDatabaseInfo } = await import("@/lib/database-backup/docker-executor");
    const info = await getDatabaseInfo();

    expect(info).toEqual({
      size: "Unknown",
      tableCount: 0,
      version: "Unknown",
    });
  });

  test("returns defaults when result is empty", async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance).mockResolvedValueOnce([]);

    const { getDatabaseInfo } = await import("@/lib/database-backup/docker-executor");
    const info = await getDatabaseInfo();

    expect(info).toEqual({
      size: "Unknown",
      tableCount: 0,
      version: "Unknown",
    });
  });
});
