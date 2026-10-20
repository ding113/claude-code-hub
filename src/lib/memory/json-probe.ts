/**
 * 增量 JSON 语法检查与路径事实提取。不保留载荷字符串、无关字段或数组项。
 * 对象按键覆盖事实，保持 JSON.parse 的重复键语义；数组只合并已完成元素。
 */
export type JsonSummary = {
  kind: "object" | "array" | "string" | "number" | "boolean" | "null";
  nonempty: boolean;
  text: string;
};
export interface ProbeSpec {
  children: Map<string, ProbeSpec>;
  tests: { bit: bigint; matches: (value: JsonSummary) => boolean; arrayValues?: boolean }[];
  complete?: (facts: bigint, value: JsonSummary) => bigint;
}
export function probeSpec(): ProbeSpec {
  return { children: new Map(), tests: [] };
}
export function addProbe(
  root: ProbeSpec,
  path: string,
  bit: bigint,
  matches: (value: JsonSummary) => boolean,
  arrayValues = false
): void {
  let spec = root;
  for (const key of path.split(".")) {
    let child = spec.children.get(key);
    if (!child) {
      child = probeSpec();
      spec.children.set(key, child);
    }
    spec = child;
  }
  spec.tests.push({ bit, matches, arrayValues });
}

type Container = {
  kind: "object" | "array";
  state: number;
  spec?: ProbeSpec;
  key: string;
  children: Map<string, bigint>;
  facts: bigint;
  nonempty: boolean;
};
const whitespace = (c: string) => c === " " || c === "\r" || c === "\n" || c === "\t";
const digit = (c: string) => c >= "0" && c <= "9";

export class JsonProbe {
  private stack: Container[] = [];
  private token: "string" | "number" | "literal" | null = null;
  private tokenText = "";
  private tokenLength = 0;
  private tokenSpec?: ProbeSpec;
  private keyToken = false;
  private escape = false;
  private unicode = "";
  private unicodeRemaining = 0;
  private numberState = 0;
  private literal = "";
  private literalIndex = 0;
  private done = false;
  private invalid = false;
  facts = BigInt(0);
  rootKind: JsonSummary["kind"] | null = null;

  constructor(
    private readonly spec: ProbeSpec,
    private readonly reserveDepth?: (bytes: number) => void
  ) {}

  feed(text: string): void {
    if (this.invalid) return;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (this.token === "string") {
        if (this.unicodeRemaining > 0) {
          if (!/[0-9a-fA-F]/.test(c)) {
            this.invalid = true;
            return;
          }
          this.unicode += c;
          if (--this.unicodeRemaining === 0)
            this.append(String.fromCharCode(Number.parseInt(this.unicode, 16)));
        } else if (this.escape) {
          this.escape = false;
          if (c === "u") {
            this.unicodeRemaining = 4;
            this.unicode = "";
          } else {
            const escaped: Record<string, string> = {
              '"': '"',
              "\\": "\\",
              "/": "/",
              b: "\b",
              f: "\f",
              n: "\n",
              r: "\r",
              t: "\t",
            };
            if (!(c in escaped)) {
              this.invalid = true;
              return;
            }
            this.append(escaped[c]);
          }
        } else if (c === "\\") this.escape = true;
        else if (c === '"') {
          this.token = null;
          const value = this.tokenLength > 128 ? "\u0000long" : this.tokenText;
          if (this.keyToken) {
            const parent = this.stack[this.stack.length - 1];
            parent.key = value;
            parent.nonempty = true;
            parent.state = 1;
          } else
            this.accept(
              { kind: "string", nonempty: this.tokenLength > 0, text: value },
              this.tokenSpec,
              BigInt(0)
            );
        } else {
          if (c.charCodeAt(0) < 32) {
            this.invalid = true;
            return;
          }
          this.append(c);
        }
        continue;
      }
      if (this.token === "literal") {
        if (c !== this.literal[this.literalIndex++]) {
          this.invalid = true;
          return;
        }
        if (this.literalIndex === this.literal.length) {
          this.token = null;
          this.accept(
            {
              kind: this.literal === "null" ? "null" : "boolean",
              nonempty: this.literal === "true",
              text: this.literal,
            },
            this.tokenSpec,
            BigInt(0)
          );
        }
        continue;
      }
      if (this.token === "number") {
        if (this.numberCharacter(c)) {
          this.append(c);
          continue;
        }
        if (!this.finishNumber()) return;
        i--;
        continue;
      }
      if (whitespace(c) || (this.stack.length === 0 && c.trim() === "")) continue;
      if (this.done) {
        this.invalid = true;
        return;
      }
      const parent = this.stack[this.stack.length - 1];
      if (parent?.kind === "object") {
        if (parent.state === 0 || parent.state === 4) {
          if (c === "}" && parent.state === 0) {
            this.close();
            continue;
          }
          if (c !== '"') {
            this.invalid = true;
            return;
          }
          this.startString(true, undefined);
          continue;
        }
        if (parent.state === 1) {
          if (c !== ":") {
            this.invalid = true;
            return;
          }
          parent.state = 2;
          continue;
        }
        if (parent.state === 3) {
          if (c === "}") this.close();
          else if (c === ",") parent.state = 4;
          else {
            this.invalid = true;
            return;
          }
          continue;
        }
      } else if (parent?.kind === "array") {
        if (c === "]" && (parent.state === 0 || parent.state === 3)) {
          this.close();
          continue;
        }
        if (parent.state === 3) {
          if (c !== ",") {
            this.invalid = true;
            return;
          }
          parent.state = 2;
          continue;
        }
      }
      const spec = parent
        ? parent.kind === "object" && parent.key === "#"
          ? undefined
          : parent.spec?.children.get(parent.kind === "array" ? "#" : parent.key)
        : this.spec;
      if (c === "{" || c === "[") {
        // 深层合法 JSON 仍可分类；堆栈按实际深度申请容量，不能误记为上游坏帧。
        if (this.stack.length % 64 === 0) this.reserveDepth?.((this.stack.length + 64) * 256);
        this.stack.push({
          kind: c === "{" ? "object" : "array",
          state: 0,
          spec,
          key: "",
          children: new Map(),
          facts: BigInt(0),
          nonempty: false,
        });
      } else if (c === '"') this.startString(false, spec);
      else if (c === "t" || c === "f" || c === "n") {
        this.token = "literal";
        this.literal = c === "t" ? "true" : c === "f" ? "false" : "null";
        this.literalIndex = 1;
        this.tokenSpec = spec;
      } else if (c === "-" || digit(c)) {
        this.token = "number";
        this.tokenSpec = spec;
        this.tokenText = c;
        this.tokenLength = 1;
        this.numberState = c === "-" ? 0 : c === "0" ? 1 : 2;
      } else {
        this.invalid = true;
        return;
      }
    }
  }

  finish(): boolean {
    if (this.token === "number") this.finishNumber();
    return !this.invalid && this.done && this.token === null && this.stack.length === 0;
  }

  private append(c: string): void {
    this.tokenLength += c.length;
    if (this.tokenText.length < 128) this.tokenText += c;
  }
  private startString(key: boolean, spec?: ProbeSpec): void {
    this.token = "string";
    this.tokenText = "";
    this.tokenLength = 0;
    this.keyToken = key;
    this.tokenSpec = spec;
  }
  private numberCharacter(c: string): boolean {
    const state = this.numberState;
    if (digit(c)) {
      if (state === 0) this.numberState = c === "0" ? 1 : 2;
      else if (state === 1) return false;
      else if (state === 3) this.numberState = 4;
      else if (state === 5 || state === 6) this.numberState = 7;
      return true;
    }
    if (c === "." && (state === 1 || state === 2)) {
      this.numberState = 3;
      return true;
    }
    if ((c === "e" || c === "E") && (state === 1 || state === 2 || state === 4)) {
      this.numberState = 5;
      return true;
    }
    if ((c === "+" || c === "-") && state === 5) {
      this.numberState = 6;
      return true;
    }
    return false;
  }
  private finishNumber(): boolean {
    if (![1, 2, 4, 7].includes(this.numberState)) {
      this.invalid = true;
      return false;
    }
    this.token = null;
    this.accept(
      {
        kind: "number",
        nonempty: true,
        text: this.tokenLength <= 128 ? String(Number(this.tokenText)) : "Infinity",
      },
      this.tokenSpec,
      BigInt(0)
    );
    return true;
  }
  private close(): void {
    const container = this.stack.pop();
    if (!container) {
      this.invalid = true;
      return;
    }
    let facts = container.facts;
    for (const value of container.children.values()) facts |= value;
    this.accept(
      { kind: container.kind, nonempty: container.nonempty, text: "" },
      container.spec,
      facts
    );
  }
  private accept(value: JsonSummary, spec: ProbeSpec | undefined, childFacts: bigint): void {
    let facts = childFacts;
    for (const test of spec?.tests ?? []) if (test.matches(value)) facts |= test.bit;
    facts = spec?.complete?.(facts, value) ?? facts;
    const parent = this.stack[this.stack.length - 1];
    if (!parent) {
      this.done = true;
      this.facts = facts;
      this.rootKind = value.kind;
      return;
    }
    if (parent.kind === "object") {
      if (parent.spec?.children.has(parent.key)) parent.children.set(parent.key, facts);
    } else {
      parent.nonempty ||= value.nonempty;
      parent.facts |= facts;
      for (const test of parent.spec?.tests ?? []) {
        if (test.arrayValues && test.matches(value)) parent.facts |= test.bit;
      }
    }
    parent.state = 3;
  }
}
