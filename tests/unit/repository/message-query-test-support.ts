type JoinTrace = {
  readonly source: unknown;
  readonly predicate: unknown;
};

export type DrizzleQueryTrace = {
  readonly from: unknown[];
  readonly where: unknown[];
  readonly leftJoins: JoinTrace[];
  readonly innerJoins: JoinTrace[];
  readonly groupBy: unknown[][];
  readonly orderBy: unknown[][];
  readonly limit: number[];
  readonly offset: number[];
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

export type DrizzleQuery<TResult> = PromiseLike<TResult> & {
  readonly trace: DrizzleQueryTrace;
  readonly from: (source: unknown) => DrizzleQuery<TResult>;
  readonly where: (predicate: unknown) => DrizzleQuery<TResult>;
  readonly leftJoin: (source: unknown, predicate: unknown) => DrizzleQuery<TResult>;
  readonly innerJoin: (source: unknown, predicate: unknown) => DrizzleQuery<TResult>;
  readonly groupBy: (...expressions: unknown[]) => DrizzleQuery<TResult>;
  readonly orderBy: (...expressions: unknown[]) => DrizzleQuery<TResult>;
  readonly limit: (value: number) => DrizzleQuery<TResult>;
  readonly offset: (value: number) => DrizzleQuery<TResult>;
};

export function createDrizzleQuery<TResult>(result: TResult): DrizzleQuery<TResult> {
  const trace: DrizzleQueryTrace = {
    from: [],
    where: [],
    leftJoins: [],
    innerJoins: [],
    groupBy: [],
    orderBy: [],
    limit: [],
    offset: [],
  };

  const query = Object.assign(Promise.resolve(result), {
    trace,
    from: (source: unknown) => {
      trace.from.push(source);
      return query;
    },
    where: (predicate: unknown) => {
      trace.where.push(predicate);
      return query;
    },
    leftJoin: (source: unknown, predicate: unknown) => {
      trace.leftJoins.push({ source, predicate });
      return query;
    },
    innerJoin: (source: unknown, predicate: unknown) => {
      trace.innerJoins.push({ source, predicate });
      return query;
    },
    groupBy: (...expressions: unknown[]) => {
      trace.groupBy.push(expressions);
      return query;
    },
    orderBy: (...expressions: unknown[]) => {
      trace.orderBy.push(expressions);
      return query;
    },
    limit: (value: number) => {
      trace.limit.push(value);
      return query;
    },
    offset: (value: number) => {
      trace.offset.push(value);
      return query;
    },
  });

  return query;
}

export function sqlText(value: unknown): string {
  const visited = new Set<object>();

  const visit = (node: unknown): string => {
    if (node === null || node === undefined) return "";
    if (["string", "number", "boolean"].includes(typeof node)) return String(node);
    if (Array.isArray(node)) return node.map(visit).join(" ");
    if (!isRecord(node) || visited.has(node)) return "";

    visited.add(node);
    if ("queryChunks" in node) return visit(node.queryChunks);
    if ("value" in node) return visit(node.value);
    if (typeof node.name === "string") return node.name;
    return Object.values(node).map(visit).join(" ");
  };

  return visit(value).replace(/\s+/g, " ").trim().toLowerCase();
}
