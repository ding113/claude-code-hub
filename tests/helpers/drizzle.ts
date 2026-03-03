import { CasingCache } from "drizzle-orm/casing";

type QueryToSql = {
  toQuery: (config: any) => { sql: string; params: unknown[] };
};

export function toSqlText(query: QueryToSql) {
  return query.toQuery({
    casing: new CasingCache(),
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (index: number) => `$${index}`,
    escapeString: (value: string) => `'${value}'`,
    paramStartIndex: { value: 1 },
  });
}
