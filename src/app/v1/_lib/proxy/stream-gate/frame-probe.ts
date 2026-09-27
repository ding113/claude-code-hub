import { addProbe, JsonProbe, type JsonSummary, probeSpec } from "@/lib/memory/json-probe";
import { type FrameVerdict, type ProtocolFamily, STREAM_SIGNALS } from "./frame-classifier";

type Rule = (typeof STREAM_SIGNALS)[ProtocolFamily]["contentRules"][number];

function compile(family: ProtocolFamily) {
  const spec = probeSpec();
  let count = BigInt(0);
  const probes = new Map<string, bigint>();
  const query = (
    path: string,
    kind: string,
    test: (value: JsonSummary) => boolean,
    arrays = false
  ) => {
    const key = `${path}:${kind}`;
    const previous = probes.get(key);
    if (previous !== undefined) return previous;
    const bit = BigInt(1) << count++;
    probes.set(key, bit);
    addProbe(spec, path, bit, test, arrays);
    return bit;
  };
  const nonempty = (path: string) => query(path, "nonempty", (value) => value.nonempty);
  const equal = (path: string, value: string, stringOnly = false) =>
    query(
      path,
      `${stringOnly ? "string" : "value"}=${value}`,
      (s) =>
        (s.kind === "string" || (!stringOnly && (s.kind === "number" || s.kind === "boolean"))) &&
        s.text === value,
      !stringOnly && !path.split(".").includes("#")
    );
  const signal = STREAM_SIGNALS[family];
  const events = new Set<string>(signal.terminalEvents);
  for (const rule of [
    ...signal.contentRules,
    ...signal.errorRules,
    ...(signal.terminalRules ?? []),
  ]) {
    for (const name of rule.eventTypes ?? []) events.add(name);
  }
  const eventQueries = [...events].map((event) => [event, equal("type", event, true)] as const);
  const wrapEventQueries =
    family === "gemini"
      ? [...events].map((event) => [event, equal("response.type", event, true)] as const)
      : [];
  const ruleTest = (rule: Rule, prefix: string) => {
    const any = (rule.anyPaths ?? []).reduce(
      (mask, path) => mask | nonempty(prefix + path),
      BigInt(0)
    );
    const values = (rule.valueMatches ?? []).map((match) =>
      match.values.reduce((mask, value) => mask | equal(prefix + match.path, value), BigInt(0))
    );
    return (facts: bigint, event: string) =>
      (rule.eventTypes?.length ?? 0) + (rule.anyPaths?.length ?? 0) + values.length > 0 &&
      (!rule.eventTypes?.length || rule.eventTypes.includes(event)) &&
      (any === BigInt(0) || (facts & any) !== BigInt(0)) &&
      values.every((mask) => (facts & mask) !== BigInt(0));
  };
  const buildRules = (prefix: string) => ({
    error: signal.errorRules.map((rule) => ruleTest(rule, prefix)),
    content: signal.contentRules.map((rule) => ruleTest(rule, prefix)),
    terminal: (signal.terminalRules ?? []).map((rule) => ruleTest(rule, prefix)),
  });
  const rules = buildRules("");
  const wrappedRules = family === "gemini" ? buildRules("response.") : null;
  const compaction = (path: string) => {
    const type = equal(`${path}.type`, "compaction", true);
    const content = query(
      `${path}.encrypted_content`,
      "nonemptyString",
      (s) => s.kind === "string" && s.nonempty
    );
    const hit = BigInt(1) << count++;
    let target = spec;
    for (const key of path.split(".")) target = target.children.get(key)!;
    target.complete = (facts, value) => {
      const matches =
        value.kind === "object" && (facts & type) !== BigInt(0) && (facts & content) !== BigInt(0);
      return (facts & ~(type | content)) | (matches ? hit : BigInt(0));
    };
    return hit;
  };
  const itemCompaction = family === "openai-responses" ? compaction("item") : BigInt(0);
  const outputCompaction =
    family === "openai-responses" ? compaction("response.output.#") : BigInt(0);
  const completedType = equal("type", "response.completed", true);
  const incompleteType = equal("type", "response.incomplete", true);
  const completedStatus = equal("response.status", "completed", true);
  const incompleteStatus = equal("response.status", "incomplete", true);
  const responseError = nonempty("response.error");
  const responseObject = query("response", "object", (s) => s.kind === "object");
  const classifyRules = (
    facts: bigint,
    event: string,
    group: ReturnType<typeof buildRules>
  ): FrameVerdict => {
    if (group.error.some((test) => test(facts, event))) return "error";
    if (
      (event === "response.output_item.done" && (facts & itemCompaction) !== BigInt(0)) ||
      (event === "response.completed" && (facts & outputCompaction) !== BigInt(0))
    )
      return "content";
    if (group.content.some((test) => test(facts, event))) return "content";
    if (group.terminal.some((test) => test(facts, event)) || signal.terminalEvents?.includes(event))
      return "terminal";
    return "neutral";
  };
  return {
    spec,
    evaluate(parser: JsonProbe, eventName: string | null, head: string, length: number) {
      const trimmed = head.trim();
      if (length <= head.length && signal.doneSentinel && trimmed === signal.doneSentinel)
        return { verdict: "terminal" as const, acceptTerminal: false };
      if (length <= head.length && trimmed === "")
        return { verdict: "neutral" as const, acceptTerminal: false };
      if (!parser.finish() || (parser.rootKind !== "object" && parser.rootKind !== "array"))
        return { verdict: "malformed" as const, acceptTerminal: false };
      const facts = parser.facts;
      const event = (eventName ?? "").trim();
      const effective =
        event || eventQueries.find(([, bit]) => (facts & bit) !== BigInt(0))?.[0] || "";
      let verdict = classifyRules(facts, effective, rules);
      if (verdict === "neutral" && wrappedRules && (facts & responseObject) !== BigInt(0)) {
        const wrappedEvent =
          event || wrapEventQueries.find(([, bit]) => (facts & bit) !== BigInt(0))?.[0] || "";
        verdict = classifyRules(facts, wrappedEvent, wrappedRules);
      }
      const clean =
        (!event || event === "response.completed") &&
        (facts & completedType) !== BigInt(0) &&
        (facts & completedStatus) !== BigInt(0) &&
        (facts & responseError) === BigInt(0);
      const incomplete =
        (!event || event === "response.incomplete") &&
        (facts & incompleteType) !== BigInt(0) &&
        (facts & incompleteStatus) !== BigInt(0);
      return { verdict, acceptTerminal: family === "openai-responses" && (clean || incomplete) };
    },
  };
}

const programs = new Map<ProtocolFamily, ReturnType<typeof compile>>();
export function createFrameProbe(family: ProtocolFamily, reserveDepth?: (bytes: number) => void) {
  let program = programs.get(family);
  if (!program) {
    program = compile(family);
    programs.set(family, program);
  }
  const parser = new JsonProbe(program.spec, reserveDepth);
  let empty = true;
  const sentinel = STREAM_SIGNALS[family].doneSentinel;
  let sentinelIndex = 0;
  let sentinelValid = Boolean(sentinel);
  return {
    feed: (text: string) => {
      if (text.trim() !== "") empty = false;
      if (sentinelValid && sentinel) {
        for (const c of text) {
          if ((sentinelIndex === 0 || sentinelIndex === sentinel.length) && c.trim() === "")
            continue;
          if (c !== sentinel[sentinelIndex++]) {
            sentinelValid = false;
            break;
          }
        }
      }
      parser.feed(text);
    },
    finish: (event: string | null, head: string, length: number) => {
      if (empty) return { verdict: "neutral" as const, acceptTerminal: false };
      if (sentinelValid && sentinelIndex === sentinel?.length)
        return { verdict: "terminal" as const, acceptTerminal: false };
      return program.evaluate(parser, event, head, length);
    },
  };
}
