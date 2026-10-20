"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const [redisContainer, manifestPath, expectedBytesArg, modeArg] = process.argv.slice(2);
if (!redisContainer || !manifestPath) {
  throw new Error(
    "usage: inspect-redis.cjs REDIS_CONTAINER SESSION_MANIFEST [EXPECTED_RESPONSE_BYTES] [active|expired]"
  );
}

const mode = modeArg || "active";
if (mode !== "active" && mode !== "expired") {
  throw new Error("inspection mode must be active or expired");
}

const expectedResponseBytes = parsePositiveInteger(
  expectedBytesArg || "5242880",
  "EXPECTED_RESPONSE_BYTES"
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.sessionIds) || !Number.isInteger(manifest.requestSequence)) {
  throw new Error("session manifest must contain sessionIds and requestSequence");
}

const inspectBundleLua = `
local bundle = KEYS[1]
local old_key_count = redis.call("EXISTS", KEYS[2], KEYS[3], KEYS[4])
if redis.call("EXISTS", bundle) == 0 then
  return { 0, "", "", "", "", 0, 0, 0, "", "", "", "", "", "", 0, -2, old_key_count }
end

local raw_body_bytes = 0
local body_field_count = 0
for _, field in ipairs(redis.call("HKEYS", bundle)) do
  if string.sub(field, 1, 5) == "body:" then
    body_field_count = body_field_count + 1
    raw_body_bytes = raw_body_bytes + redis.call("HSTRLEN", bundle, field)
  end
end

local dangling_refs = 0
for _, view in ipairs({ "legacy", "before", "after" }) do
  local ref = redis.call("HGET", bundle, "ref:" .. view)
  if ref and redis.call("HEXISTS", bundle, "body:" .. ref) == 0 then
    dangling_refs = dangling_refs + 1
  end
end

return {
  1,
  redis.call("HGET", bundle, "schema") or "",
  redis.call("HGET", bundle, "layout") or "",
  redis.call("HGET", bundle, "total_bytes") or "",
  redis.call("HGET", bundle, "over_budget") or "",
  body_field_count,
  raw_body_bytes,
  redis.call("HLEN", bundle),
  redis.call("HGET", bundle, "present:legacy") or "",
  redis.call("HGET", bundle, "present:before") or "",
  redis.call("HGET", bundle, "present:after") or "",
  redis.call("HGET", bundle, "ref:legacy") or "",
  redis.call("HGET", bundle, "ref:before") or "",
  redis.call("HGET", bundle, "ref:after") or "",
  dangling_refs,
  redis.call("PTTL", bundle),
  old_key_count
}
`;

function parsePositiveInteger(raw, name) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function runDocker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`docker ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function redisCli(args) {
  return runDocker(["exec", redisContainer, "redis-cli", ...args]);
}

function parseInfo(section) {
  const result = {};
  for (const line of redisCli(["--raw", "INFO", section]).split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}

function inspectBundle(sessionId) {
  const sequence = manifest.requestSequence;
  const prefix = `session:${sessionId}:req:${sequence}`;
  const keys = [
    `${prefix}:response-bodies:v1`,
    `${prefix}:response`,
    `${prefix}:snapshot:response:before:body`,
    `${prefix}:snapshot:response:after:body`,
  ];
  const raw = redisCli(["--json", "EVAL", inspectBundleLua, "4", ...keys]);
  const reply = JSON.parse(raw);
  if (!Array.isArray(reply) || reply.length !== 17) {
    throw new Error(`unexpected bundle inspection reply for ${sessionId}`);
  }

  return {
    sessionId,
    exists: Number(reply[0]) === 1,
    schema: String(reply[1]),
    layout: String(reply[2]),
    declaredTotalBytes: Number(reply[3] || 0),
    overBudget: String(reply[4]) === "1",
    bodyFieldCount: Number(reply[5]),
    rawBodyBytes: Number(reply[6]),
    hashFieldCount: Number(reply[7]),
    present: {
      legacy: String(reply[8]) === "1",
      before: String(reply[9]) === "1",
      after: String(reply[10]) === "1",
    },
    refs: {
      legacy: String(reply[11]),
      before: String(reply[12]),
      after: String(reply[13]),
    },
    danglingRefs: Number(reply[14]),
    pttlMs: Number(reply[15]),
    oldBodyKeyCount: Number(reply[16]),
  };
}

const bundles = manifest.sessionIds.map(inspectBundle);
const memory = parseInfo("memory");
const persistence = parseInfo("persistence");
const containerState = JSON.parse(
  runDocker(["inspect", "--format", "{{json .State}}", redisContainer])
);
const existingBundles = bundles.filter((bundle) => bundle.exists);
const ttlValues = existingBundles.map((bundle) => bundle.pttlMs).filter((ttl) => ttl >= 0);
const totalRawBodyBytes = bundles.reduce((total, bundle) => total + bundle.rawBodyBytes, 0);
const totalDeclaredBytes = bundles.reduce((total, bundle) => total + bundle.declaredTotalBytes, 0);
const totalBodyFieldCount = bundles.reduce((total, bundle) => total + bundle.bodyFieldCount, 0);
const totalOldBodyKeyCount = bundles.reduce((total, bundle) => total + bundle.oldBodyKeyCount, 0);
const totalDanglingRefs = bundles.reduce((total, bundle) => total + bundle.danglingRefs, 0);
const identicalThreeViewRefs = bundles.filter(
  (bundle) =>
    bundle.present.legacy &&
    bundle.present.before &&
    bundle.present.after &&
    bundle.refs.legacy !== "" &&
    bundle.refs.legacy === bundle.refs.before &&
    bundle.refs.legacy === bundle.refs.after
).length;
const budgetBytes = expectedResponseBytes * manifest.sessionIds.length;
const invariantFailures = [];

if (bundles.length !== manifest.waves * manifest.requestsPerWave) {
  invariantFailures.push("manifest request count does not match waves times requestsPerWave");
}
if (mode === "active") {
  if (existingBundles.length !== bundles.length)
    invariantFailures.push("one or more bundles are missing");
  if (bundles.some((bundle) => bundle.schema !== "1")) invariantFailures.push("unexpected schema");
  if (bundles.some((bundle) => bundle.layout !== "dedup"))
    invariantFailures.push("unexpected layout");
  if (bundles.some((bundle) => bundle.overBudget))
    invariantFailures.push("one or more bundles are over budget");
  if (totalBodyFieldCount !== bundles.length)
    invariantFailures.push("expected one body field per request");
  if (identicalThreeViewRefs !== bundles.length) {
    invariantFailures.push("legacy, before, and after do not share one body ref for every request");
  }
  if (totalRawBodyBytes > budgetBytes)
    invariantFailures.push("raw body bytes exceed request budget");
  if (bundles.some((bundle) => bundle.rawBodyBytes !== bundle.declaredTotalBytes)) {
    invariantFailures.push("raw body bytes differ from declared total_bytes");
  }
  if (totalOldBodyKeyCount !== 0)
    invariantFailures.push("legacy body keys remain after bundle write");
  if (totalDanglingRefs !== 0) invariantFailures.push("one or more bundle refs are dangling");
} else {
  if (existingBundles.length !== 0) invariantFailures.push("one or more bundles remain after TTL");
  if (totalOldBodyKeyCount !== 0) invariantFailures.push("legacy body keys remain after TTL");
}
if (containerState.OOMKilled) invariantFailures.push("Redis container was OOM-killed");
if (containerState.Status !== "running") invariantFailures.push("Redis container is not running");
if (persistence.rdb_last_bgsave_status !== "ok") invariantFailures.push("last RDB save failed");

process.stdout.write(
  `${JSON.stringify(
    {
      mode,
      manifest: {
        scenarioPrefix: manifest.scenarioPrefix,
        waves: manifest.waves,
        requestsPerWave: manifest.requestsPerWave,
        completedWaves: manifest.completedWaves,
        requestSequence: manifest.requestSequence,
        sessionCount: manifest.sessionIds.length,
      },
      expectedResponseBytes,
      budgetBytes,
      redis: {
        containerState,
        memory: {
          usedMemory: Number(memory.used_memory || 0),
          usedMemoryPeak: Number(memory.used_memory_peak || 0),
        },
        persistence: {
          rdbSaves: Number(persistence.rdb_saves || 0),
          rdbLastBgsaveStatus: persistence.rdb_last_bgsave_status || null,
          rdbLastCowSize: Number(persistence.rdb_last_cow_size || 0),
          rdbBgsaveInProgress: Number(persistence.rdb_bgsave_in_progress || 0),
          rdbLastSaveTime: Number(persistence.rdb_last_save_time || 0),
        },
      },
      summary: {
        bundleCount: existingBundles.length,
        missingBundleCount: bundles.length - existingBundles.length,
        totalRawBodyBytes,
        totalDeclaredBytes,
        totalBodyFieldCount,
        identicalThreeViewRefs,
        totalOldBodyKeyCount,
        totalDanglingRefs,
        minPttlMs: ttlValues.length > 0 ? Math.min(...ttlValues) : null,
        maxPttlMs: ttlValues.length > 0 ? Math.max(...ttlValues) : null,
        invariantFailures,
        passed: invariantFailures.length === 0,
      },
      bundles,
    },
    null,
    2
  )}\n`
);

if (invariantFailures.length > 0) process.exitCode = 1;
