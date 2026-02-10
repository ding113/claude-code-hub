import { randomBytes } from "@/lib/vacuum-filter/random";

const textEncoder = new TextEncoder();
const BUCKET_SIZE = 4 as const;
const DEFAULT_SCRATCH_BYTES = 256;
const INV_2_32 = 1 / 4294967296;
const FAST_REDUCE_MAX_BUCKETS = 1 << 21; // 2^21：保证 hv(32-bit) * buckets 在 IEEE754 中仍可精确表示整数
const IS_LITTLE_ENDIAN = (() => {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setUint32(0, 0x11223344, true);
  return new Uint32Array(buf)[0] === 0x11223344;
})();

function computeFastReduceParams(numBuckets: number): { bucketMask: number; fastReduceMul: number | null } {
  // 1) numBuckets 为 2 的幂：位与最快
  // 2) 否则使用 multiply-high 等价式：floor(hvIndex * numBuckets / 2^32)
  //    该实现依赖 IEEE754 精度：当 numBuckets <= 2^21 时，32-bit hvIndex 与 numBuckets 的乘积 < 2^53，
  //    因而计算与截断都保持精确，结果必定落在 [0, numBuckets)。
  const bucketMask = (numBuckets & (numBuckets - 1)) === 0 ? numBuckets - 1 : 0;
  const fastReduceMul =
    bucketMask === 0 && numBuckets <= FAST_REDUCE_MAX_BUCKETS ? numBuckets * INV_2_32 : null;
  return { bucketMask, fastReduceMul };
}

/**
 * Vacuum Filter（真空过滤器）
 *
 * 目标：
 * - 近似集合成员查询（AMQ）：支持插入 / 查询 / 删除
 * - 无假阴性（在不发生“误删”的前提下）：插入成功的元素，查询必定返回 true
 * - 有假阳性：查询可能返回 true，但元素实际不存在（由 fingerprint 位数决定）
 *
 * 实现要点（对照论文与作者参考实现）：
 * - 结构与 Cuckoo Filter 类似：每个元素映射到两个 bucket（i1 与 i2），每个 bucket 4 个 slot
 * - Alternate Range（AR）：i2 在 i1 的局部范围内（提升局部性并提高高负载下成功率）
 * - Vacuuming：插入遇到满桶时，优先做“局部换位路径搜索”（一跳前瞻），把空位“吸”过来，降低反复踢出重试
 *
 * 注意：
 * - 本实现为工程可用版本，核心算法与 vacuuming 逻辑对齐论文/作者代码，但未做 semi-sorting 的 bit packing；
 *   为 API Key 防护场景选择 32-bit fingerprint 时仍然具备非常好的空间与性能表现。
 * - 删除是“近似删除”：理论上仍可能因 fingerprint 碰撞导致误删（概率与 FPR 同数量级）。
 *   对安全敏感场景建议使用 32-bit fingerprint，降低碰撞与误删风险。
 */

export type VacuumFilterInitOptions = {
  /**
   * 预期最多插入的元素数量（用于计算 bucket 数量与装载率）。
   * 该值越接近实际峰值，空间利用率越高；取值偏小可能导致插入失败。
   */
  maxItems: number;
  /**
   * 每个 bucket 的 slot 数；论文与常见实现为 4（此实现固定为 4）。
   */
  bucketSize?: 4;
  /**
   * fingerprint 位数（1~32）。
   * - 位数越大，假阳性越低，但占用内存越多。
   * - 推荐：32（用于安全敏感场景，尽量避免碰撞/误删风险）。
   */
  fingerprintBits?: number;
  /**
   * 最大踢出次数（失败后返回 false，调用方可选择扩容重建）。
   */
  maxKickSteps?: number;
  /**
   * 哈希种子（用于对抗可控输入导致的退化/碰撞攻击）。
   * - 不传则进程启动时随机生成（每次重启不同）。
   */
  seed?: Uint8Array | string;
  /**
   * 目标装载率（越高越省内存，但插入更困难）。
   * 论文/参考实现默认约 0.96（结合 VF 的 vacuuming 仍可维持高成功率）。
   */
  targetLoadFactor?: number;
};

type UndoLog = { pos: number[]; prev: number[] };

class XorShift32 {
  private state: number;

  constructor(seed: number) {
    const s = seed >>> 0;
    // 避免全 0 状态（xorshift 会卡死）
    this.state = s === 0 ? 0x9e3779b9 : s;
  }

  nextU32(): number {
    // xorshift32
    let x = this.state >>> 0;
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    this.state = x >>> 0;
    return this.state;
  }

  nextInt(maxExclusive: number): number {
    return maxExclusive <= 1 ? 0 : this.nextU32() % maxExclusive;
  }

  nextBool(): boolean {
    return (this.nextU32() & 1) === 1;
  }
}

function upperPower2(x: number): number {
  if (x <= 1) return 1;
  let ret = 1;
  // 注意：不要用位运算左移（JS 位运算是 32-bit），用乘法避免大数溢出/变负数
  while (ret < x) ret *= 2;
  return ret;
}

function roundUpToMultiple(x: number, base: number): number {
  if (base <= 0) return x;
  const r = x % base;
  return r === 0 ? x : x + (base - r);
}

// 解方程：1 + x(logc - logx + 1) - c = 0（参考实现同名函数）
function solveEquation(c: number): number {
  let x = c + 0.1;
  let guard = 0;
  const f = (v: number) => 1 + v * (Math.log(c) - Math.log(v) + 1) - c;
  const fd = (v: number) => Math.log(c) - Math.log(v);
  while (Math.abs(f(x)) > 0.001 && guard++ < 10_000) {
    x -= f(x) / fd(x);
    if (!Number.isFinite(x) || x <= 0) {
      // 数值异常时回退到一个保守值，避免死循环
      return c + 1;
    }
  }
  return x;
}

// balls-in-bins 最大负载上界（参考实现同名函数）
function ballsInBinsMaxLoad(balls: number, bins: number): number {
  const m = balls;
  const n = bins;
  if (n <= 1) return m;

  const c = m / (n * Math.log(n));
  // 更准确的 bound..（c < 5 区间）
  if (c < 5) {
    const dc = solveEquation(c);
    return (dc - 1 + 2) * Math.log(n);
  }

  return m / n + 1.5 * Math.sqrt((2 * m * Math.log(n)) / n);
}

/**
 * 选择合适的 Alternate Range（power-of-two），移植自作者参考实现 proper_alt_range。
 *
 * 直觉：
 * - AR 越小：局部性越好，但高负载下更容易出现“局部拥堵”导致插入失败
 * - AR 越大：更容易找到空位，但局部性变差
 * - Vacuum Filter 采用多档 AR（按 tag 的低位分组）兼顾两者
 */
function properAltRange(bucketCount: number, groupIndex: number): number {
  const b = 4; // slots per bucket
  const lf = 0.95; // target load factor (用于估算)
  let altRange = 8;
  while (altRange < bucketCount) {
    const f = (4 - groupIndex) * 0.25; // group 占比（参考实现）
    if (
      ballsInBinsMaxLoad(f * b * lf * bucketCount, bucketCount / altRange) <
      0.97 * b * altRange
    ) {
      return altRange;
    }
    // 同 upperPower2：避免 32-bit 位移溢出
    altRange *= 2;
  }
  return altRange;
}

function normalizeSeed(seed?: VacuumFilterInitOptions["seed"]): Uint8Array {
  if (!seed) return randomBytes(16);
  if (typeof seed === "string") return textEncoder.encode(seed);
  return new Uint8Array(seed);
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function fmix32(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

// MurmurHash3 x86 32-bit（用于生成 index；tag 由二次混合派生）
function murmur3X86_32(bytes: Uint8Array, len: number, seed: number, words?: Uint32Array): number {
  let h = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  const length = len >>> 0;
  const nblocks = (length / 4) | 0;
  const blockLen = nblocks * 4;

  if (words && IS_LITTLE_ENDIAN && bytes.byteOffset === 0) {
    for (let i = 0; i < nblocks; i++) {
      let k = words[i] >>> 0;

      k = Math.imul(k, c1) >>> 0;
      k = ((k << 15) | (k >>> 17)) >>> 0;
      k = Math.imul(k, c2) >>> 0;

      h ^= k;
      h = ((h << 13) | (h >>> 19)) >>> 0;
      h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
    }
  } else {
    for (let base = 0; base < blockLen; base += 4) {
      let k =
        (bytes[base] |
          (bytes[base + 1] << 8) |
          (bytes[base + 2] << 16) |
          (bytes[base + 3] << 24)) >>>
        0;

      k = Math.imul(k, c1) >>> 0;
      k = ((k << 15) | (k >>> 17)) >>> 0;
      k = Math.imul(k, c2) >>> 0;

      h ^= k;
      h = ((h << 13) | (h >>> 19)) >>> 0;
      h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
    }
  }

  // tail
  let k1 = 0;
  const tail = blockLen;
  const rem = length & 3;
  if (rem >= 3) {
    k1 ^= bytes[tail + 2] << 16;
  }
  if (rem >= 2) {
    k1 ^= bytes[tail + 1] << 8;
  }
  if (rem >= 1) {
    k1 ^= bytes[tail];
    k1 = Math.imul(k1, c1) >>> 0;
    k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0;
    k1 = Math.imul(k1, c2) >>> 0;
    h ^= k1;
  }

  h ^= length;
  return fmix32(h);
}

export class VacuumFilter {
  private readonly fingerprintBits: number;
  private readonly tagMask: number;
  private readonly maxKickSteps: number;
  private readonly seed: Uint8Array;
  private readonly hashSeedA: number;
  private readonly hashSeedB: number;
  private readonly rng: XorShift32;

  // AR 组数固定为 4（与论文/参考实现一致）
  private readonly lenMasks: [number, number, number, number];

  private readonly numBuckets: number;
  private readonly bucketMask: number;
  private readonly fastReduceMul: number | null;
  private readonly table: Uint32Array;
  private numItems = 0;

  // 热路径优化：避免 TextEncoder.encode 分配；每次 has/add/delete 复用同一块 scratch
  private scratch: Uint8Array = new Uint8Array(DEFAULT_SCRATCH_BYTES);
  private scratch32: Uint32Array = new Uint32Array(this.scratch.buffer);
  private tmpIndex = 0;
  private tmpTag = 0;

  constructor(options: VacuumFilterInitOptions) {
    if (!Number.isFinite(options.maxItems) || options.maxItems <= 0) {
      throw new Error("VacuumFilter: maxItems 必须为正数");
    }

    const rawFingerprintBits = options.fingerprintBits;
    const fingerprintBits =
      typeof rawFingerprintBits === "number" && Number.isFinite(rawFingerprintBits)
        ? Math.floor(rawFingerprintBits)
        : 32;
    this.fingerprintBits = Math.max(1, Math.min(32, fingerprintBits));

    const rawMaxKickSteps = options.maxKickSteps;
    const maxKickSteps =
      typeof rawMaxKickSteps === "number" && Number.isFinite(rawMaxKickSteps)
        ? Math.floor(rawMaxKickSteps)
        : 500;
    this.maxKickSteps = Math.max(1, maxKickSteps);
    this.seed = normalizeSeed(options.seed);
    this.hashSeedA = (readU32LE(this.seed, 0) ^ 0x6a09e667) >>> 0;
    this.hashSeedB = (readU32LE(this.seed, 4) ^ 0xbb67ae85) >>> 0;
    this.rng = new XorShift32(readU32LE(this.seed, 8) ^ 0x3c6ef372);

    // tagMask：用于从哈希中截取 fingerprint（32-bit 特判；避免 1<<31 的有符号溢出陷阱）
    this.tagMask =
      this.fingerprintBits === 32 ? 0xffffffff : (0xffffffff >>> (32 - this.fingerprintBits)) >>> 0;

    const rawTargetLoadFactor = options.targetLoadFactor;
    const rawTargetLoadFactorValue =
      typeof rawTargetLoadFactor === "number" && Number.isFinite(rawTargetLoadFactor)
        ? rawTargetLoadFactor
        : 0.96;
    const targetLoadFactor = Math.max(0.5, Math.min(0.99, rawTargetLoadFactorValue));

    // 与作者实现一致：numBuckets ≈ maxItems / (0.96 * 4)
    const maxItems = Math.ceil(options.maxItems);
    // 工程上更保守：用 ceil 保证“按目标装载率”时能容纳 maxItems
    let bucketCount = Math.ceil(maxItems / targetLoadFactor / BUCKET_SIZE);
    bucketCount = Math.max(bucketCount, 128); // 避免过小导致 AR 设置异常

    // 小规模表：使用更小的段长，避免强制对齐到 1024 导致空间浪费
    // 参考作者另一份实现（vacuum.h）的初始化策略。
    if (bucketCount < 10_000) {
      const bigSeg =
        bucketCount < 256 ? upperPower2(bucketCount) : upperPower2(Math.floor(bucketCount / 4));
      bucketCount = roundUpToMultiple(bucketCount, bigSeg);

      const mask = bigSeg - 1;
      this.lenMasks = [mask, mask, mask, mask];
      this.numBuckets = bucketCount;
      const fast = computeFastReduceParams(this.numBuckets);
      this.bucketMask = fast.bucketMask;
      this.fastReduceMul = fast.fastReduceMul;
      this.table = new Uint32Array(this.numBuckets * BUCKET_SIZE);
      return;
    }

    // Alternate Range 设置（aligned=false 路径）
    const bigSeg = Math.max(1024, properAltRange(bucketCount, 0));
    bucketCount = roundUpToMultiple(bucketCount, bigSeg);

    const l0 = bigSeg - 1;
    const l1 = properAltRange(bucketCount, 1) - 1;
    const l2 = properAltRange(bucketCount, 2) - 1;
    // 最后一组扩大一倍（参考实现）
    const l3 = properAltRange(bucketCount, 3) * 2 - 1;

    this.lenMasks = [l0, l1, l2, l3];

    // 重要：保证 bucketCount 是所有 segment length 的倍数，避免 AltIndex 落到末段“越界”
    // 由于这些长度都是 2 的幂，取最大值即可覆盖其它组（大幂必为小幂的倍数）。
    const segLens = [l0 + 1, l1 + 1, l2 + 1, l3 + 1];
    const maxSegLen = Math.max(...segLens);
    this.numBuckets = roundUpToMultiple(bucketCount, upperPower2(maxSegLen));
    const fast = computeFastReduceParams(this.numBuckets);
    this.bucketMask = fast.bucketMask;
    this.fastReduceMul = fast.fastReduceMul;
    this.table = new Uint32Array(this.numBuckets * BUCKET_SIZE);
  }

  /**
   * 当前已插入的元素数量（插入成功才计数）
   */
  size(): number {
    return this.numItems;
  }

  /**
   * 表容量（slot 总数）
   */
  capacitySlots(): number {
    return this.numBuckets * BUCKET_SIZE;
  }

  /**
   * 负载因子（占用 slot / 总 slot）
   */
  loadFactor(): number {
    return this.capacitySlots() === 0 ? 0 : this.numItems / this.capacitySlots();
  }

  /**
   * 判断是否可能存在（true=可能存在；false=一定不存在）
   */
  has(key: string): boolean {
    this.indexTag(key);
    const i1 = this.tmpIndex;
    const tag = this.tmpTag;

    const table = this.table;
    let start = i1 * BUCKET_SIZE;
    if (
      table[start] === tag ||
      table[start + 1] === tag ||
      table[start + 2] === tag ||
      table[start + 3] === tag
    ) {
      return true;
    }

    const i2 = this.altIndex(i1, tag);
    start = i2 * BUCKET_SIZE;
    return (
      table[start] === tag ||
      table[start + 1] === tag ||
      table[start + 2] === tag ||
      table[start + 3] === tag
    );
  }

  /**
   * 插入（成功返回 true；失败返回 false）
   */
  add(key: string): boolean {
    this.indexTag(key);
    return this.addIndexTag(this.tmpIndex, this.tmpTag);
  }

  /**
   * 删除（成功返回 true；未找到返回 false）
   *
   * 注意：这是“近似删除”，存在极低概率误删（fingerprint 碰撞导致不可区分）。
   */
  delete(key: string): boolean {
    this.indexTag(key);
    const i1 = this.tmpIndex;
    const tag = this.tmpTag;
    const i2 = this.altIndex(i1, tag);

    const ok1 = this.deleteFromBucket(i1, tag);
    if (ok1) {
      this.numItems--;
      return true;
    }

    const ok2 = this.deleteFromBucket(i2, tag);
    if (ok2) {
      this.numItems--;
      return true;
    }

    return false;
  }

  // ==================== 内部实现 ====================

  private indexTag(key: string): void {
    // 使用 seeded MurmurHash3（32-bit）生成确定性哈希，降低可控输入退化风险
    // 关键优化：尽量走 TextEncoder.encodeInto（无分配，且编码在原生层完成）
    const strLen = key.length;
    if (this.scratch.length < strLen) {
      // 注意：scratch32 需要 4-byte 对齐；否则 new Uint32Array(buffer) 会抛 RangeError。
      const newLen = roundUpToMultiple(Math.max(this.scratch.length * 2, strLen), 4);
      this.scratch = new Uint8Array(newLen);
      this.scratch32 = new Uint32Array(this.scratch.buffer);
    }

    // encodeInto 可能因 out buffer 不足而截断：read < strLen 时扩容重试
    let encoded = textEncoder.encodeInto(key, this.scratch);
    if (encoded.read < strLen) {
      // UTF-8 最坏 4 bytes/char；用 4x 作为上界（仅影响少见的非 ASCII key）
      const newLen = roundUpToMultiple(Math.max(this.scratch.length * 2, strLen * 4), 4);
      this.scratch = new Uint8Array(newLen);
      this.scratch32 = new Uint32Array(this.scratch.buffer);
      encoded = textEncoder.encodeInto(key, this.scratch);
    }

    // 极端情况下 encodeInto 仍可能因缓冲不足而截断：回退到 encode（保证正确性）
    let bytes: Uint8Array;
    let byteLen: number;
    let words: Uint32Array | undefined;

    if (encoded.read < strLen) {
      bytes = textEncoder.encode(key);
      byteLen = bytes.length;
      words = undefined;
    } else {
      bytes = this.scratch;
      byteLen = encoded.written;
      words = this.scratch32;
    }

    const hvIndex = murmur3X86_32(bytes, byteLen, this.hashSeedA, words);

    // tag 从 index hash 二次混合派生（避免再扫一遍 bytes）
    // 注意：tag 不再来自“第二份独立 hash”。这会降低 (index, tag) 的独立性，但在 32-bit fingerprint 场景下碰撞概率仍极低。
    const hvTag = fmix32((hvIndex ^ this.hashSeedB) >>> 0);

    // 参考实现使用 `hash % numBuckets`；这里做一个“尽量快”的等价映射：
    // - numBuckets 为 2 的幂：位与（最快）
    // - numBuckets 较小：使用 multiply-high 等价式（避免 `%`）
    // - 其它：回退到 `%`
    const bucketMask = this.bucketMask;
    const fastReduceMul = this.fastReduceMul;
    const index =
      bucketMask !== 0
        ? (hvIndex & bucketMask) >>> 0
        : fastReduceMul
          ? ((hvIndex * fastReduceMul) | 0) >>> 0 // |0 用于截断（等价 floor；值域 < 2^31）
          : hvIndex % this.numBuckets;

    let tag = (hvTag & this.tagMask) >>> 0;
    if (tag === 0) tag = 1;

    this.tmpIndex = index;
    this.tmpTag = tag;
  }

  private altIndex(index: number, tag: number): number {
    const segMask = this.lenMasks[tag & 3];

    // delta = (tag * C) & segMask，若为 0 则置为 1，避免 alt==index
    let delta = (Math.imul(tag, 0x5bd1e995) >>> 0) & segMask;
    if (delta === 0) delta = 1;

    // segLen 为 2 的幂：index % segLen 等价于 index & segMask（index 来自 32-bit hash，安全使用位运算）
    const offset = (index & segMask) >>> 0;
    const altOffset = (offset ^ delta) >>> 0;
    return index - offset + altOffset;
  }

  private bucketStart(index: number): number {
    return index * BUCKET_SIZE;
  }

  private writeSlot(pos: number, value: number, undo?: UndoLog): void {
    if (undo) {
      undo.pos.push(pos);
      undo.prev.push(this.table[pos]);
    }
    this.table[pos] = value;
  }

  private rollback(undo: UndoLog): void {
    for (let i = undo.pos.length - 1; i >= 0; i--) {
      this.table[undo.pos[i]] = undo.prev[i];
    }
  }

  private insertTagToBucket(index: number, tag: number, undo?: UndoLog): boolean {
    const start = this.bucketStart(index);
    if (this.table[start] === 0) {
      this.writeSlot(start, tag, undo);
      return true;
    }
    if (this.table[start + 1] === 0) {
      this.writeSlot(start + 1, tag, undo);
      return true;
    }
    if (this.table[start + 2] === 0) {
      this.writeSlot(start + 2, tag, undo);
      return true;
    }
    if (this.table[start + 3] === 0) {
      this.writeSlot(start + 3, tag, undo);
      return true;
    }
    return false;
  }

  private deleteFromBucket(index: number, tag: number): boolean {
    const start = this.bucketStart(index);
    if (this.table[start] === tag) {
      this.table[start] = 0;
      return true;
    }
    if (this.table[start + 1] === tag) {
      this.table[start + 1] = 0;
      return true;
    }
    if (this.table[start + 2] === tag) {
      this.table[start + 2] = 0;
      return true;
    }
    if (this.table[start + 3] === tag) {
      this.table[start + 3] = 0;
      return true;
    }
    return false;
  }

  private bucketOccupancy(index: number): number {
    const start = this.bucketStart(index);
    return (
      (this.table[start] !== 0 ? 1 : 0) +
      (this.table[start + 1] !== 0 ? 1 : 0) +
      (this.table[start + 2] !== 0 ? 1 : 0) +
      (this.table[start + 3] !== 0 ? 1 : 0)
    );
  }

  private addIndexTag(index: number, tag: number): boolean {
    const i1 = index;
    const i2 = this.altIndex(i1, tag);

    const occ1 = this.bucketOccupancy(i1);
    const occ2 = this.bucketOccupancy(i2);

    // 先尝试插入到“更空”的 bucket（参考实现：优先更少元素的桶）
    const first = occ1 <= occ2 ? i1 : i2;
    const second = first === i1 ? i2 : i1;

    if (this.insertTagToBucket(first, tag) || this.insertTagToBucket(second, tag)) {
      this.numItems++;
      return true;
    }

    // 两个 bucket 都满：进入踢出 + vacuuming
    // 关键语义：若最终插入失败，必须回滚所有修改，避免“丢元素”导致假阴性。
    const undo: UndoLog = { pos: [], prev: [] };
    let curIndex = this.rng.nextBool() ? i1 : i2;
    let curTag = tag;

    for (let count = 0; count < this.maxKickSteps; count++) {
      // 1) 可能因上一次换位导致当前桶出现空位（保守再试一次）
      if (this.insertTagToBucket(curIndex, curTag, undo)) {
        this.numItems++;
        return true;
      }

      // 2) Vacuuming（一跳前瞻）：尝试把当前桶内某个 tag 挪到它的 alternate bucket 的空位
      const start = this.bucketStart(curIndex);
      for (let slot = 0; slot < BUCKET_SIZE; slot++) {
        const existing = this.table[start + slot];
        if (existing === 0) continue;
        const alt = this.altIndex(curIndex, existing);
        if (this.insertTagToBucket(alt, existing, undo)) {
          // 将空位“吸”到当前 slot：existing 移走，curTag 填入
          this.writeSlot(start + slot, curTag, undo);
          this.numItems++;
          return true;
        }
      }

      // 3) 随机踢出一个 tag，继续链式搬运
      const r = this.rng.nextInt(BUCKET_SIZE);
      const oldTag = this.table[start + r];
      this.writeSlot(start + r, curTag, undo);
      curTag = oldTag;
      curIndex = this.altIndex(curIndex, curTag);
    }

    this.rollback(undo);
    return false;
  }
}
