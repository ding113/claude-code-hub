"use strict";

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");

const [appUrl, mockStatsUrl, scenarioPrefix, wavesArg, perWaveArg, intervalArg] =
  process.argv.slice(2);

if (!appUrl || !mockStatsUrl || !scenarioPrefix) {
  throw new Error(
    "usage: drive-disconnect-waves.cjs APP_URL MOCK_STATS_URL SCENARIO_PREFIX " +
      "[WAVES] [REQUESTS_PER_WAVE] [INTERVAL_MS]"
  );
}

const parsedAppUrl = parseHttpUrl(appUrl, "APP_URL");
const parsedMockStatsUrl = parseHttpUrl(mockStatsUrl, "MOCK_STATS_URL");
const normalizedScenarioPrefix = parseScenarioPrefix(scenarioPrefix);
const waves = parseBoundedInteger(wavesArg || "8", "WAVES", 1, 255);
const perWave = parseBoundedInteger(perWaveArg || "8", "REQUESTS_PER_WAVE", 1, 255);
const intervalMs = parseBoundedInteger(intervalArg || "10000", "INTERVAL_MS", 0, 3600000);
const abortDelayMs = parseBoundedInteger(
  process.env.CCH_ABORT_DELAY_MS || "250",
  "CCH_ABORT_DELAY_MS",
  0,
  60000
);
const requestMode = parseEnum(process.env.CCH_REQUEST_MODE || "disconnect", "CCH_REQUEST_MODE", [
  "disconnect",
  "complete",
]);
const completionTimeoutMs = parseBoundedInteger(
  process.env.CCH_COMPLETION_TIMEOUT_MS || "60000",
  "CCH_COMPLETION_TIMEOUT_MS",
  1,
  3600000
);
const mockReceiptTimeoutMs = parseBoundedInteger(
  process.env.CCH_MOCK_RECEIPT_TIMEOUT_MS || "30000",
  "CCH_MOCK_RECEIPT_TIMEOUT_MS",
  1,
  3600000
);
const model = (process.env.CCH_REQUEST_MODEL || "gpt-5.6").trim();
if (!model || model.length > 256) {
  throw new Error("CCH_REQUEST_MODEL must contain between 1 and 256 characters");
}
const key = readApiKey();
const sessionManifestPath = process.env.CCH_SESSION_MANIFEST?.trim() || null;
const manifestSessionIds = [];

function parseHttpUrl(raw, name) {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return url;
}

function parseScenarioPrefix(raw) {
  if (!/^[a-z0-9_-]{1,64}$/i.test(raw)) {
    throw new Error("SCENARIO_PREFIX must match [a-z0-9_-] and contain 1 to 64 characters");
  }
  return raw;
}

function parseBoundedInteger(raw, name, minimum, maximum) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseEnum(raw, name, values) {
  if (!values.includes(raw)) {
    throw new Error(`${name} must be one of: ${values.join(", ")}`);
  }
  return raw;
}

function readApiKey() {
  const direct = process.env.CCH_API_KEY?.trim();
  if (direct) return direct;
  const keyFile = process.env.CCH_API_KEY_FILE;
  if (keyFile) {
    const value = fs.readFileSync(keyFile, "utf8").trim();
    if (value) return value;
  }
  throw new Error("set CCH_API_KEY or CCH_API_KEY_FILE before running the fixture");
}

function transportFor(url) {
  return url.protocol === "https:" ? https : http;
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getJson(rawUrl) {
  return new Promise((resolve, reject) => {
    const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
    const request = transportFor(url).get(url, (response) => {
      const chunks = [];
      response.once("aborted", () => reject(new Error(`GET ${url} response aborted`)));
      response.once("error", reject);
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(`GET ${url} returned ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(mockReceiptTimeoutMs, () => request.destroy(new Error("stats timeout")));
    request.on("error", reject);
  });
}

async function waitForMock(scenario, target) {
  const deadline = Date.now() + mockReceiptTimeoutMs;
  while (Date.now() < deadline) {
    const stats = await getJson(mockStatsUrl);
    if ((stats.counts?.[scenario] || 0) >= target) return stats.counts[scenario];
    await sleep(50);
  }
  throw new Error(`mock receipt timeout for ${scenario}: target=${target}`);
}

function hashScenario(value) {
  return [...value].reduce((hash, char) => (hash * 33 + char.charCodeAt(0)) & 0xff, 0);
}

function writeSessionManifest(completedWaves) {
  if (!sessionManifestPath) return;
  const temporaryPath = `${sessionManifestPath}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(
      {
        scenarioPrefix: normalizedScenarioPrefix,
        waves,
        requestsPerWave: perWave,
        completedWaves,
        requestSequence: 1,
        sessionIds: manifestSessionIds,
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
  fs.renameSync(temporaryPath, sessionManifestPath);
}

function startRequest(scenario, scenarioHash, wave, index) {
  const body = JSON.stringify({
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `CCH_SCENARIO_${scenario} wave-${wave} request-${index}`,
          },
        ],
      },
    ],
    stream: true,
    prompt_cache_key: `cch1408-${scenario}-${wave}-${index}`,
  });
  const url = new URL("/v1/responses", parsedAppUrl);
  const suffix = `${scenarioHash.toString(16).padStart(2, "0")}${(wave + 1)
    .toString(16)
    .padStart(2, "0")}${index.toString(16).padStart(2, "0")}000000`;
  const sessionId = `019c1408-0000-7000-8000-${suffix}`;
  let settleCompletion;
  let rejectCompletion;
  const completion = new Promise((resolve, reject) => {
    settleCompletion = resolve;
    rejectCompletion = reject;
  });
  if (requestMode === "disconnect") completion.catch(() => {});
  const handle = { request: null, response: null, sessionId, completion };
  const request = transportFor(url).request(
    url,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        session_id: sessionId,
      },
    },
    (response) => {
      handle.response = response;
      if ((response.statusCode || 500) >= 400) {
        rejectCompletion(new Error(`POST ${url} returned ${response.statusCode}`));
      }
      response.on("data", () => {});
      response.once("end", settleCompletion);
      response.once("error", rejectCompletion);
      response.once("aborted", () => rejectCompletion(new Error(`POST ${url} response aborted`)));
    }
  );
  handle.request = request;
  request.once("error", rejectCompletion);
  request.end(body);
  return handle;
}

function abortRequests(handles) {
  for (const handle of handles) {
    handle.response?.destroy();
    handle.request?.destroy();
  }
}

async function waitForCompletions(handles) {
  let timeout;
  try {
    await Promise.race([
      Promise.all(handles.map((handle) => handle.completion)),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`response completion timeout after ${completionTimeoutMs}ms`)),
          completionTimeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const scenarioHash = hashScenario(normalizedScenarioPrefix);
  for (let wave = 0; wave < waves; wave += 1) {
    const scenario = `${normalizedScenarioPrefix}-${wave}`;
    const before = (await getJson(parsedMockStatsUrl)).counts?.[scenario] || 0;
    const handles = [];
    for (let index = 0; index < perWave; index += 1) {
      handles.push(startRequest(scenario, scenarioHash, wave, index));
    }

    let received;
    let confirmedAt;
    let abortedAt;
    let completedAt;
    let shouldAbort = requestMode === "disconnect";
    try {
      received = await waitForMock(scenario, before + perWave);
      confirmedAt = Date.now();
      if (requestMode === "complete") {
        await waitForCompletions(handles);
        completedAt = Date.now();
      } else {
        await sleep(abortDelayMs);
        abortedAt = Date.now();
      }
    } catch (error) {
      shouldAbort = true;
      throw error;
    } finally {
      if (shouldAbort) abortRequests(handles);
    }

    const sessionIds = handles.map((handle) => handle.sessionId);
    manifestSessionIds.push(...sessionIds);
    writeSessionManifest(wave + 1);

    process.stdout.write(
      `${JSON.stringify({
        wave,
        scenario,
        sessionIds,
        perWave,
        mockBefore: before,
        mockReceived: received,
        requestMode,
        confirmedAt,
        completedAt,
        abortedAt,
        abortDelayMs: abortedAt === undefined ? null : abortedAt - confirmedAt,
      })}\n`
    );

    if (wave + 1 < waves) await sleep(intervalMs);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
