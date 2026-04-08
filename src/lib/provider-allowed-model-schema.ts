import safeRegex from "safe-regex";
import { z } from "zod";
import { normalizeAllowedModelRules } from "@/lib/allowed-model-rules";
import { PROVIDER_RULE_LIMITS } from "@/lib/constants/provider.constants";
import { PROVIDER_MODEL_REDIRECT_MATCH_TYPE_SCHEMA } from "./provider-model-redirect-schema";

export const PROVIDER_ALLOWED_MODEL_RULE_SCHEMA = z
  .object({
    matchType: PROVIDER_MODEL_REDIRECT_MATCH_TYPE_SCHEMA,
    pattern: z
      .string()
      .trim()
      .min(1, "Allowed model pattern cannot be empty")
      .max(
        PROVIDER_RULE_LIMITS.MAX_TEXT_LENGTH,
        `Allowed model pattern is too long (max ${PROVIDER_RULE_LIMITS.MAX_TEXT_LENGTH} characters)`
      ),
  })
  .superRefine((rule, ctx) => {
    if (rule.matchType !== "regex") {
      return;
    }

    try {
      new RegExp(rule.pattern);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Allowed model regex is invalid",
        path: ["pattern"],
      });
      return;
    }

    try {
      if (!safeRegex(rule.pattern)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Allowed model regex has potential ReDoS risk",
          path: ["pattern"],
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Allowed model regex has potential ReDoS risk",
        path: ["pattern"],
      });
    }
  });

export const PROVIDER_ALLOWED_MODEL_RULE_INPUT_SCHEMA = z.union([
  z
    .string()
    .trim()
    .min(1, "Allowed model pattern cannot be empty")
    .max(
      PROVIDER_RULE_LIMITS.MAX_TEXT_LENGTH,
      `Allowed model pattern is too long (max ${PROVIDER_RULE_LIMITS.MAX_TEXT_LENGTH} characters)`
    ),
  PROVIDER_ALLOWED_MODEL_RULE_SCHEMA,
]);

export const PROVIDER_ALLOWED_MODEL_RULE_INPUT_LIST_SCHEMA = z
  .array(PROVIDER_ALLOWED_MODEL_RULE_INPUT_SCHEMA)
  .max(
    PROVIDER_RULE_LIMITS.MAX_ITEMS,
    `Allowed model rules cannot exceed ${PROVIDER_RULE_LIMITS.MAX_ITEMS} entries`
  )
  .transform((rules) => normalizeAllowedModelRules(rules) ?? [])
  .refine(
    (rules) => {
      const keys = new Set<string>();
      for (const rule of rules) {
        const key = `${rule.matchType}:${rule.pattern.trim().toLowerCase()}`;
        if (keys.has(key)) {
          return false;
        }
        keys.add(key);
      }
      return true;
    },
    {
      message: "Duplicate allowed model rule for matchType+pattern",
    }
  );

export const PROVIDER_ALLOWED_MODEL_RULE_LIST_SCHEMA = z
  .array(PROVIDER_ALLOWED_MODEL_RULE_SCHEMA)
  .max(
    PROVIDER_RULE_LIMITS.MAX_ITEMS,
    `Allowed model rules cannot exceed ${PROVIDER_RULE_LIMITS.MAX_ITEMS} entries`
  )
  .refine(
    (rules) => {
      const keys = new Set<string>();
      for (const rule of rules) {
        const key = `${rule.matchType}:${rule.pattern.trim().toLowerCase()}`;
        if (keys.has(key)) {
          return false;
        }
        keys.add(key);
      }
      return true;
    },
    {
      message: "Duplicate allowed model rule for matchType+pattern",
    }
  );

export const PROVIDER_ALLOWED_MODEL_RULES_SCHEMA =
  PROVIDER_ALLOWED_MODEL_RULE_INPUT_LIST_SCHEMA.nullable().optional();
