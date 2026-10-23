import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CLOUD_PRICE_TABLE_URL } from "@/lib/price-sync/cloud-price-table";
import type { CptModelEntry, CptPricingVariant, CptTrack } from "@/lib/price-sync/cpt-schema";
import { Decimal } from "@/lib/utils/currency";

/**
 * Opt-in end-to-end check of long-context (>272K) tier billing against the cloud price table.
 *
 * Sends real requests through a running CCH instance to a local OpenAI-protocol upstream that
 * reports exact usage, then compares each billed request with the cost derived directly from the
 * cloud price table record (cchp.pricing-table/v1): once the input context exceeds the track's
 * threshold, every token of the request uses the tier factor.
 *
 * The CCH instance must have synced the cloud price table and must be able to reach 127.0.0.1.
 *   CCH_LONG_CONTEXT_E2E_BASE_URL=http://127.0.0.1:13500 ADMIN_TOKEN=... \
 *     bunx vitest run --config tests/configs/e2e.config.mts tests/e2e/long-context-billing.test.ts
 */

const BASE_URL = process.env.CCH_LONG_CONTEXT_E2E_BASE_URL;
const ADMIN_TOKEN = process.env.TEST_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN;
const run = BASE_URL && ADMIN_TOKEN ? describe : describe.skip;

const MODELS = ["gpt-6.1-sol", "gpt-6-sol", "gpt-6-astra"];
const THRESHOLD = 272000;

type UsageSpec = { input: number; cached: number; output: number };

type Case = UsageSpec & {
  endpoint: "responses" | "chat";
  stream: boolean;
  serviceTier?: "priority";
};

const CASES: Case[] = [
  { endpoint: "responses", stream: false, input: 272000, cached: 0, output: 2000 },
  { endpoint: "responses", stream: false, input: 272001, cached: 0, output: 2000 },
  { endpoint: "responses", stream: true, input: 400000, cached: 0, output: 5000 },
  { endpoint: "responses", stream: true, input: 400000, cached: 300000, output: 5000 },
  { endpoint: "responses", stream: false, input: 200000, cached: 150000, output: 1000 },
  { endpoint: "chat", stream: false, input: 272001, cached: 0, output: 2000 },
  { endpoint: "chat", stream: true, input: 350000, cached: 200000, output: 3000 },
  {
    endpoint: "responses",
    stream: false,
    input: 300000,
    cached: 0,
    output: 2000,
    serviceTier: "priority",
  },
];

type UsageLogItem = {
  id: number;
  model: string | null;
  costUsd: string | null;
  context1mApplied: boolean | null;
  specialSettings: Array<Record<string, unknown>> | null;
  costBreakdown: {
    long_context?: {
      threshold_tokens: number;
      observed_input_tokens: number;
      input_multiplier?: number;
      output_multiplier?: number;
      cache_read_multiplier?: number;
    };
  } | null;
};

function parseUsageMarker(body: string): UsageSpec {
  const match = /E2E_USAGE input=(\d+) cached=(\d+) output=(\d+)/.exec(body);
  if (!match) throw new Error(`request body has no E2E_USAGE marker: ${body.slice(0, 200)}`);
  return { input: Number(match[1]), cached: Number(match[2]), output: Number(match[3]) };
}

// OpenAI 语义的上游：input_tokens / prompt_tokens 含 cached_tokens
function upstreamResponse(path: string, body: Record<string, unknown>, raw: string) {
  const usage = parseUsageMarker(raw);
  const model = String(body.model);
  const serviceTier = typeof body.service_tier === "string" ? body.service_tier : "default";
  const stream = body.stream === true;

  if (path.endsWith("/responses")) {
    const response = {
      id: `resp_e2e_${Date.now()}`,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model,
      service_tier: serviceTier,
      output: [
        {
          id: "msg_e2e",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "ok", annotations: [] }],
        },
      ],
      usage: {
        input_tokens: usage.input,
        input_tokens_details: { cached_tokens: usage.cached },
        output_tokens: usage.output,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: usage.input + usage.output,
      },
    };
    if (!stream) return { contentType: "application/json", text: JSON.stringify(response) };
    const created = { ...response, status: "in_progress", output: [], usage: null };
    return {
      contentType: "text/event-stream",
      text: [
        ["response.created", { type: "response.created", response: created }],
        ["response.output_text.delta", { type: "response.output_text.delta", delta: "ok" }],
        ["response.completed", { type: "response.completed", response }],
      ]
        .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        .join(""),
    };
  }

  const chatUsage = {
    prompt_tokens: usage.input,
    prompt_tokens_details: { cached_tokens: usage.cached },
    completion_tokens: usage.output,
    total_tokens: usage.input + usage.output,
  };
  const base = { id: "chatcmpl-e2e", created: Math.floor(Date.now() / 1000), model };
  if (!stream) {
    return {
      contentType: "application/json",
      text: JSON.stringify({
        ...base,
        object: "chat.completion",
        service_tier: serviceTier,
        choices: [
          { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
        usage: chatUsage,
      }),
    };
  }
  const chunks = [
    {
      ...base,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant", content: "ok" } }],
    },
    {
      ...base,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: chatUsage,
    },
  ];
  return {
    contentType: "text/event-stream",
    text: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
  };
}

function officialVariant(entry: CptModelEntry): CptPricingVariant {
  const variant = entry.pricing.find((item) => item.official === true && !item.region);
  if (!variant) throw new Error(`${entry.model_name} has no official pricing variant`);
  return variant;
}

// CPT 轨道按优先级排列：取第一条所有 trigger 都满足的轨道
function matchTrack(variant: CptPricingVariant, totalInput: number, serviceTier: string): CptTrack {
  const track = (variant.tracks ?? []).find((candidate) =>
    candidate.triggers.every((trigger) => {
      if (trigger.kind === "input_tokens_above") {
        return totalInput > (trigger.threshold as number);
      }
      if (trigger.kind === "body_matches" && trigger.field === "service_tier") {
        return new RegExp(trigger.pattern as string).test(serviceTier);
      }
      return false;
    })
  );
  if (!track) throw new Error(`no track matched for input ${totalInput}`);
  return track;
}

function chargeRate(variant: CptPricingVariant, track: CptTrack, charge: string): Decimal {
  const factor = track.charge_factors?.[charge] ?? track.factor;
  return new Decimal(variant.charges[charge].price).mul(factor).div(1_000_000);
}

function expectedCost(entry: CptModelEntry, c: Case) {
  const variant = officialVariant(entry);
  const track = matchTrack(variant, c.input, c.serviceTier ?? "default");
  const baseTrack = matchTrack(variant, 0, c.serviceTier ?? "default");
  const total = chargeRate(variant, track, "prompt")
    .mul(c.input - c.cached)
    .plus(chargeRate(variant, track, "cache_read").mul(c.cached))
    .plus(chargeRate(variant, track, "completion").mul(c.output));
  const multiplier = (charge: string) =>
    chargeRate(variant, track, charge)
      .div(chargeRate(variant, baseTrack, charge))
      .toNumber();
  return {
    track,
    total,
    multipliers: {
      input: multiplier("prompt"),
      output: multiplier("completion"),
      cacheRead: multiplier("cache_read"),
    },
  };
}

run("GPT long-context tier billing against the cloud price table", () => {
  const adminHeaders = {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    "Content-Type": "application/json",
  };
  let upstream: http.Server;
  let cloudModels: Map<string, CptModelEntry>;
  let apiKey: string;
  let userId: number;
  const providerIds: number[] = [];

  async function admin<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${BASE_URL}/api/v1${path}`, { ...init, headers: adminHeaders });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`${init?.method ?? "GET"} ${path}: ${response.status} ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  async function latestLogId(): Promise<number> {
    const page = await admin<{ items: UsageLogItem[] }>(`/usage-logs?userId=${userId}&limit=1`);
    return page.items[0]?.id ?? 0;
  }

  async function waitForBilledLog(afterId: number): Promise<UsageLogItem> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const page = await admin<{ items: UsageLogItem[] }>(`/usage-logs?userId=${userId}&limit=1`);
      const item = page.items[0];
      if (item && item.id > afterId && item.costUsd != null && Number(item.costUsd) > 0) {
        return item;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`no billed usage log after id ${afterId}`);
  }

  beforeAll(async () => {
    const table = (await (await fetch(CLOUD_PRICE_TABLE_URL)).json()) as {
      models: CptModelEntry[];
    };
    cloudModels = new Map(table.models.map((entry) => [entry.model_name, entry]));

    upstream = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const { contentType, text } = upstreamResponse(req.url ?? "", JSON.parse(raw), raw);
        res.writeHead(200, { "content-type": contentType });
        res.end(text);
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;

    const suffix = Date.now().toString(36);
    for (const providerType of ["codex", "openai-compatible"]) {
      const provider = await admin<{ id: number }>("/providers", {
        method: "POST",
        body: JSON.stringify({
          name: `e2e-long-context-${providerType}-${suffix}`,
          url: upstreamUrl,
          key: "sk-e2e-upstream",
          provider_type: providerType,
          is_enabled: true,
          weight: 1,
          priority: 0,
          cost_multiplier: 1,
        }),
      });
      providerIds.push(provider.id);
    }
    const created = await admin<{ user: { id: number } }>("/users", {
      method: "POST",
      body: JSON.stringify({ name: `e2e-long-context-${suffix}` }),
    });
    userId = created.user.id;
    const key = await admin<{ generatedKey: string }>(`/users/${userId}/keys`, {
      method: "POST",
      body: JSON.stringify({ name: `e2e-long-context-${suffix}` }),
    });
    apiKey = key.generatedKey;
  }, 120000);

  afterAll(async () => {
    if (userId) await admin(`/users/${userId}`, { method: "DELETE" });
    for (const id of providerIds) await admin(`/providers/${id}`, { method: "DELETE" });
    await new Promise<void>((resolve) => upstream?.close(() => resolve()));
  });

  test("the cloud price table bills >272K requests at 2x input/cache and 1.5x output", () => {
    for (const model of MODELS) {
      const entry = cloudModels.get(model);
      expect(entry, model).toBeDefined();
      const variant = officialVariant(entry as CptModelEntry);
      const tier = (variant.tracks ?? []).find((track) => track.label === "Context >272K");
      expect(tier?.triggers).toEqual([
        { kind: "input_tokens_above", threshold: THRESHOLD, inclusive: false },
      ]);
      expect(tier?.charge_factors).toMatchObject({
        prompt: "2",
        completion: "1.5",
        cache_read: "2",
        cache_write: "2",
      });
    }
  });

  for (const model of MODELS) {
    for (const c of CASES) {
      const name = `${model} ${c.endpoint}${c.stream ? " stream" : ""} input=${c.input} cached=${c.cached} output=${c.output}${c.serviceTier ? " priority" : ""}`;

      test(name, async () => {
        const expected = expectedCost(cloudModels.get(model) as CptModelEntry, c);
        const afterId = await latestLogId();
        const marker = `E2E_USAGE input=${c.input} cached=${c.cached} output=${c.output}`;
        const tier = c.serviceTier ? { service_tier: c.serviceTier } : {};
        const isResponses = c.endpoint === "responses";
        const response = await fetch(
          `${BASE_URL}/v1/${isResponses ? "responses" : "chat/completions"}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "User-Agent": isResponses ? "codex_cli_rs/0.120.0" : "e2e-openai-client/1.0",
            },
            body: JSON.stringify(
              isResponses
                ? {
                    model,
                    stream: c.stream,
                    instructions: "e2e",
                    input: [{ role: "user", content: [{ type: "input_text", text: marker }] }],
                    ...tier,
                  }
                : {
                    model,
                    stream: c.stream,
                    ...(c.stream ? { stream_options: { include_usage: true } } : {}),
                    messages: [{ role: "user", content: marker }],
                    ...tier,
                  }
            ),
          }
        );
        expect(response.status).toBe(200);
        await response.text();

        const log = await waitForBilledLog(afterId);
        expect(log.model).toBe(model);
        expect(new Decimal(log.costUsd as string).eq(expected.total)).toBe(true);

        const longContextAudit = (log.specialSettings ?? []).find(
          (setting) => setting.type === "long_context_pricing"
        );
        if (c.input > THRESHOLD) {
          expect(log.costBreakdown?.long_context).toMatchObject({
            threshold_tokens: THRESHOLD,
            observed_input_tokens: c.input,
            input_multiplier: expected.multipliers.input,
            output_multiplier: expected.multipliers.output,
            cache_read_multiplier: expected.multipliers.cacheRead,
          });
          expect(longContextAudit).toMatchObject({ hit: true, thresholdTokens: THRESHOLD });
          expect(log.context1mApplied).toBe(isResponses);
        } else {
          expect(expected.track.triggers).toHaveLength(c.serviceTier ? 1 : 0);
          expect(log.costBreakdown?.long_context).toBeUndefined();
          expect(longContextAudit).toBeUndefined();
          expect(log.context1mApplied).toBe(false);
        }
      });
    }
  }
});
