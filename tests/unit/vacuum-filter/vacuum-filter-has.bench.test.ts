import { VacuumFilter } from "@/lib/vacuum-filter/vacuum-filter";
import os from "node:os";
import { describe, expect, test } from "vitest";

// 说明：
// - 这是一个“可复现的本机 microbench”，用于量化 VacuumFilter.has 的优化收益。
// - 默认跳过（避免 CI/本地 `npm test` 触发超时）；需要显式开启：
//   - *nix:  RUN_VACUUM_FILTER_BENCH=1 node --expose-gc node_modules/vitest/vitest.mjs run tests/unit/vacuum-filter/vacuum-filter-has.bench.test.ts
//   - pwsh:  $env:RUN_VACUUM_FILTER_BENCH='1'; node --expose-gc node_modules/vitest/vitest.mjs run tests/unit/vacuum-filter/vacuum-filter-has.bench.test.ts

const shouldRunBench = process.env.RUN_VACUUM_FILTER_BENCH === "1";
const benchTest = shouldRunBench ? test : test.skip;

function xorshift32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= (s << 13) >>> 0;
    s ^= s >>> 17;
    s ^= (s << 5) >>> 0;
    return s >>> 0;
  };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

function makeAsciiKey(rng: () => number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[rng() % ALPHABET.length];
  return out;
}

function freshSameContent(s: string): string {
  // 让 V8 很难复用同一个 string 实例（模拟“请求头解析后每次都是新字符串对象”）
  return (" " + s).slice(1);
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = (sorted.length / 2) | 0;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function nsPerOp(elapsedNs: bigint, ops: number): number {
  return Number(elapsedNs) / ops;
}

function opsPerSecFromNsPerOp(ns: number): number {
  return 1e9 / ns;
}

function gcIfAvailable(): void {
  const g = (globalThis as unknown as { gc?: () => void }).gc;
  if (typeof g === "function") g();
}

type Scenario = {
  name: string;
  kind: "hit" | "miss";
  strings: "reuse" | "single_use";
  makeLookups: () => string[];
  expectedHitsSet: number;
  expectedHitsVf: number | null; // miss 场景 VF 允许 false positive
};

function formatMops(opsPerSec: number): string {
  return `${(opsPerSec / 1e6).toFixed(2)} Mops/s`;
}

describe("VacuumFilter.has bench (local only)", () => {
  benchTest(
    "quantify Set.has vs VacuumFilter.has",
    () => {
      const N = 50_000;
      const KEY_LEN = 48;
      const LOOKUPS = 200_000;
      const WARMUP_ROUNDS = 2;
      const MEASURE_ROUNDS = 7;

      // eslint-disable-next-line no-console
      console.log(
        `[bench-env] node=${process.version} v8=${process.versions.v8} platform=${process.platform} arch=${process.arch}`
      );
      // eslint-disable-next-line no-console
      console.log(`[bench-env] cpu=${os.cpus()[0]?.model ?? "unknown"}`);
      // eslint-disable-next-line no-console
      console.log(
        `[bench-params] N=${N} keyLen=${KEY_LEN} lookups=${LOOKUPS} warmup=${WARMUP_ROUNDS} rounds=${MEASURE_ROUNDS}`
      );

      const rng = xorshift32(0x12345678);
      const keys: string[] = Array.from({ length: N }, () => makeAsciiKey(rng, KEY_LEN));

      const set = new Set(keys);
      const vf = new VacuumFilter({ maxItems: N, fingerprintBits: 32, seed: "bench-seed" });
      for (const k of keys) {
        expect(vf.add(k)).toBe(true);
      }

      const lookupIdx: number[] = Array.from({ length: LOOKUPS }, () => rng() % N);

      const reusedHits: string[] = lookupIdx.map((i) => keys[i]);
      const reusedMisses: string[] = lookupIdx.map((i) => `!${keys[i].slice(1)}`); // '!' 不在 ALPHABET，保证 miss

      // Sanity: misses must be misses for Set
      for (let i = 0; i < 1000; i++) {
        expect(set.has(reusedMisses[i])).toBe(false);
      }

      const scenarios: Scenario[] = [
        {
          name: "hit/reuse",
          kind: "hit",
          strings: "reuse",
          makeLookups: () => reusedHits,
          expectedHitsSet: LOOKUPS,
          expectedHitsVf: LOOKUPS,
        },
        {
          name: "miss/reuse",
          kind: "miss",
          strings: "reuse",
          makeLookups: () => reusedMisses,
          expectedHitsSet: 0,
          expectedHitsVf: null,
        },
        {
          name: "hit/single_use",
          kind: "hit",
          strings: "single_use",
          makeLookups: () => lookupIdx.map((i) => freshSameContent(keys[i])),
          expectedHitsSet: LOOKUPS,
          expectedHitsVf: LOOKUPS,
        },
        {
          name: "miss/single_use",
          kind: "miss",
          strings: "single_use",
          makeLookups: () => lookupIdx.map((i) => freshSameContent(`!${keys[i].slice(1)}`)),
          expectedHitsSet: 0,
          expectedHitsVf: null,
        },
      ];

      function runSet(lookups: string[]): number {
        let hits = 0;
        for (let i = 0; i < lookups.length; i++) hits += set.has(lookups[i]) ? 1 : 0;
        return hits;
      }

      function runVf(lookups: string[]): number {
        let hits = 0;
        for (let i = 0; i < lookups.length; i++) hits += vf.has(lookups[i]) ? 1 : 0;
        return hits;
      }

      for (const scenario of scenarios) {
        const setNsSamples: number[] = [];
        const vfNsSamples: number[] = [];

        // Warmup（同时也让 Set 可能缓存 string hash；这正是需要量化的差异）
        for (let round = 0; round < WARMUP_ROUNDS; round++) {
          const lookups = scenario.makeLookups();
          runSet(lookups);
          runVf(lookups);
        }

        for (let round = 0; round < MEASURE_ROUNDS; round++) {
          const lookups = scenario.makeLookups();

          // 交替测量顺序，减少“先测导致的 cache/JIT 影响”
          const measureSetFirst = round % 2 === 0;
          if (measureSetFirst) {
            gcIfAvailable();
            const t0 = process.hrtime.bigint();
            const hitsSet = runSet(lookups);
            const t1 = process.hrtime.bigint();
            setNsSamples.push(nsPerOp(t1 - t0, LOOKUPS));
            expect(hitsSet).toBe(scenario.expectedHitsSet);

            gcIfAvailable();
            const t2 = process.hrtime.bigint();
            const hitsVf = runVf(lookups);
            const t3 = process.hrtime.bigint();
            vfNsSamples.push(nsPerOp(t3 - t2, LOOKUPS));
            if (typeof scenario.expectedHitsVf === "number")
              expect(hitsVf).toBe(scenario.expectedHitsVf);
          } else {
            gcIfAvailable();
            const t0 = process.hrtime.bigint();
            const hitsVf = runVf(lookups);
            const t1 = process.hrtime.bigint();
            vfNsSamples.push(nsPerOp(t1 - t0, LOOKUPS));
            if (typeof scenario.expectedHitsVf === "number")
              expect(hitsVf).toBe(scenario.expectedHitsVf);

            gcIfAvailable();
            const t2 = process.hrtime.bigint();
            const hitsSet = runSet(lookups);
            const t3 = process.hrtime.bigint();
            setNsSamples.push(nsPerOp(t3 - t2, LOOKUPS));
            expect(hitsSet).toBe(scenario.expectedHitsSet);
          }
        }

        const setMedianNs = median(setNsSamples);
        const vfMedianNs = median(vfNsSamples);
        const setMedianOps = opsPerSecFromNsPerOp(setMedianNs);
        const vfMedianOps = opsPerSecFromNsPerOp(vfMedianNs);
        const ratio = vfMedianNs / setMedianNs;

        // eslint-disable-next-line no-console
        console.log(
          `[bench] ${scenario.name} Set=${formatMops(setMedianOps)} (${setMedianNs.toFixed(1)} ns/op) | ` +
            `VF=${formatMops(vfMedianOps)} (${vfMedianNs.toFixed(1)} ns/op) | ` +
            `VF/Set=${ratio.toFixed(2)}x`
        );
      }
    },
    60_000
  );
});
