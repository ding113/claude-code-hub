"use client";

import { ChevronDown, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { matchPattern } from "@/lib/model-pattern-matching";
import { findMatchingProviderModelRedirectRule } from "@/lib/provider-model-redirects";
import { cn } from "@/lib/utils";
import type { ProviderAllowedModelRule, ProviderModelRedirectRule } from "@/types/provider";

interface ModelMatchTesterProps {
  mode: "redirect" | "whitelist";
  redirectRules?: ProviderModelRedirectRule[];
  allowedModelRules?: ProviderAllowedModelRule[];
}

interface RedirectTestResult {
  matched: boolean;
  rule?: ProviderModelRedirectRule;
}

interface WhitelistTestResult {
  allowed: boolean;
  allowAll: boolean;
  matchedRule?: ProviderAllowedModelRule;
}

export function ModelMatchTester({
  mode,
  redirectRules,
  allowedModelRules,
}: ModelMatchTesterProps) {
  const t = useTranslations("settings.providers.form.matchTester");
  const [modelName, setModelName] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);

  const redirectResult = useMemo((): RedirectTestResult | null => {
    if (mode !== "redirect" || !modelName.trim()) return null;
    const matched = findMatchingProviderModelRedirectRule(modelName.trim(), redirectRules ?? null);
    return { matched: !!matched, rule: matched ?? undefined };
  }, [mode, modelName, redirectRules]);

  const whitelistResult = useMemo((): WhitelistTestResult | null => {
    if (mode !== "whitelist" || !modelName.trim()) return null;
    const rules = allowedModelRules ?? [];
    if (rules.length === 0) {
      return { allowed: true, allowAll: true };
    }
    const matchedRule = rules.find((rule) =>
      matchPattern(modelName.trim(), rule.matchType, rule.pattern)
    );
    return { allowed: !!matchedRule, allowAll: false, matchedRule };
  }, [mode, modelName, allowedModelRules]);

  const hasRules =
    mode === "redirect" ? (redirectRules?.length ?? 0) > 0 : (allowedModelRules?.length ?? 0) > 0;

  return (
    <div className="border-t border-border/50 pt-3">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Search className="h-3 w-3" />
        <span>{t("title")}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-180")} />
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={t("inputPlaceholder")}
              className="font-mono text-sm h-8 flex-1"
            />
          </div>

          {!hasRules && !modelName.trim() && (
            <p className="text-xs text-muted-foreground">{t("noRulesHint")}</p>
          )}

          {/* Redirect result */}
          {mode === "redirect" && modelName.trim() && redirectResult && (
            <div className="rounded-md bg-muted/50 border border-border/50 px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <Badge
                  variant={redirectResult.matched ? "default" : "secondary"}
                  className={cn(
                    "text-[10px]",
                    redirectResult.matched
                      ? "bg-green-600/10 text-green-600 border-green-600/20"
                      : ""
                  )}
                >
                  {redirectResult.matched ? t("matched") : t("notMatched")}
                </Badge>
              </div>
              {redirectResult.rule && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px]">
                    {redirectResult.rule.matchType}
                  </Badge>
                  <code className="font-mono text-xs">{redirectResult.rule.source}</code>
                  <span className="text-muted-foreground">-&gt;</span>
                  <code className="font-mono text-xs text-green-600">
                    {redirectResult.rule.target}
                  </code>
                </div>
              )}
            </div>
          )}

          {/* Whitelist result */}
          {mode === "whitelist" && modelName.trim() && whitelistResult && (
            <div className="rounded-md bg-muted/50 border border-border/50 px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-2">
                {whitelistResult.allowAll ? (
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-green-600/10 text-green-600 border-green-600/20"
                  >
                    {t("allowAll")}
                  </Badge>
                ) : (
                  <Badge
                    variant={whitelistResult.allowed ? "default" : "destructive"}
                    className={cn(
                      "text-[10px]",
                      whitelistResult.allowed
                        ? "bg-green-600/10 text-green-600 border-green-600/20"
                        : ""
                    )}
                  >
                    {whitelistResult.allowed ? t("allowed") : t("blocked")}
                  </Badge>
                )}
              </div>
              {whitelistResult.matchedRule && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px]">
                    {whitelistResult.matchedRule.matchType}
                  </Badge>
                  <code className="font-mono text-xs">{whitelistResult.matchedRule.pattern}</code>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
