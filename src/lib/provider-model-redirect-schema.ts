import safeRegex from "safe-regex";
import { z } from "zod";

export const PROVIDER_MODEL_REDIRECT_MATCH_TYPE_SCHEMA = z.enum([
  "exact",
  "prefix",
  "suffix",
  "contains",
  "regex",
]);

export const PROVIDER_MODEL_REDIRECT_RULE_SCHEMA = z
  .object({
    matchType: PROVIDER_MODEL_REDIRECT_MATCH_TYPE_SCHEMA,
    source: z
      .string()
      .trim()
      .min(1, "Redirect source cannot be empty")
      .max(255, "Redirect source is too long"),
    target: z
      .string()
      .trim()
      .min(1, "Redirect target cannot be empty")
      .max(255, "Redirect target is too long"),
  })
  .superRefine((rule, ctx) => {
    if (rule.matchType !== "regex") {
      return;
    }

    try {
      new RegExp(rule.source);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Redirect regex is invalid",
        path: ["source"],
      });
      return;
    }

    try {
      if (!safeRegex(rule.source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Redirect regex has potential ReDoS risk",
          path: ["source"],
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Redirect regex has potential ReDoS risk",
        path: ["source"],
      });
    }
  });

export const PROVIDER_MODEL_REDIRECT_RULE_LIST_SCHEMA = z
  .array(PROVIDER_MODEL_REDIRECT_RULE_SCHEMA)
  .max(100, "Redirect rules cannot exceed 100 entries")
  .refine(
    (rules) => {
      const keys = new Set<string>();
      for (const rule of rules) {
        const key = `${rule.matchType}:${rule.source.trim().toLowerCase()}`;
        if (keys.has(key)) {
          return false;
        }
        keys.add(key);
      }
      return true;
    },
    {
      message: "Duplicate redirect rule for matchType+source",
    }
  );

export const PROVIDER_MODEL_REDIRECT_RULES_SCHEMA =
  PROVIDER_MODEL_REDIRECT_RULE_LIST_SCHEMA.nullable().optional();
