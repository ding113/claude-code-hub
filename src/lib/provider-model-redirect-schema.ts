import safeRegex from "safe-regex";
import { z } from "zod";
import { PROVIDER_RULE_LIMITS } from "@/lib/constants/provider.constants";

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
      .max(
        PROVIDER_RULE_LIMITS.MAX_TEXT_LENGTH,
        `Redirect source is too long (max ${PROVIDER_RULE_LIMITS.MAX_TEXT_LENGTH} characters)`
      ),
    target: z
      .string()
      .trim()
      .min(1, "Redirect target cannot be empty")
      .max(
        PROVIDER_RULE_LIMITS.MAX_TEXT_LENGTH,
        `Redirect target is too long (max ${PROVIDER_RULE_LIMITS.MAX_TEXT_LENGTH} characters)`
      ),
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
  .max(
    PROVIDER_RULE_LIMITS.MAX_ITEMS,
    `Redirect rules cannot exceed ${PROVIDER_RULE_LIMITS.MAX_ITEMS} entries`
  )
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
