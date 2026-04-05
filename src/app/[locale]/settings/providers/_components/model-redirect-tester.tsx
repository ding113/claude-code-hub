"use client";

import { CheckCircle2, Search, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { findMatchingProviderModelRedirectRule } from "@/lib/provider-model-redirects";
import type { ProviderModelRedirectRule } from "@/types/provider";

interface ModelRedirectTesterProps {
  rules: ProviderModelRedirectRule[];
}

export function ModelRedirectTester({ rules }: ModelRedirectTesterProps) {
  const t = useTranslations("settings.providers.form.matchTester");
  const tRedirect = useTranslations("settings.providers.form.modelRedirect");
  const [modelName, setModelName] = useState("");
  const [testedModel, setTestedModel] = useState("");

  const matchedRule = useMemo(
    () => findMatchingProviderModelRedirectRule(testedModel, rules),
    [rules, testedModel]
  );

  const matchedIndex = matchedRule
    ? rules.findIndex(
        (rule) =>
          rule.matchType === matchedRule.matchType &&
          rule.source.trim() === matchedRule.source &&
          rule.target.trim() === matchedRule.target
      )
    : -1;

  const handleTest = () => {
    setTestedModel(modelName.trim());
  };

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">{t("redirectTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("redirectDescription")}</p>
        </div>

        <div className="flex flex-col gap-2 md:flex-row">
          <Input
            id="model-redirect-tester-input"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            onInput={(e) => setModelName((e.target as HTMLInputElement).value)}
            aria-label={t("inputLabel")}
            placeholder={t("inputPlaceholder")}
          />
          <Button type="button" variant="outline" onClick={handleTest} disabled={!modelName.trim()}>
            <Search className="mr-2 h-4 w-4" />
            {t("testButton")}
          </Button>
        </div>

        {testedModel ? (
          <div className="rounded-lg border border-border/60 bg-background/80 p-3">
            {matchedRule ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("matched")}
                </div>
                <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2">
                    <span>{t("ruleIndex")}</span>
                    <Badge variant="outline">#{matchedIndex + 1}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2">
                    <span>{t("matchType")}</span>
                    <Badge variant="secondary">
                      {tRedirect(
                        `matchType${matchedRule.matchType.charAt(0).toUpperCase()}${matchedRule.matchType.slice(1)}`
                      )}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2 md:col-span-2">
                    <span>{t("source")}</span>
                    <code className="text-right font-mono text-foreground">
                      {matchedRule.source}
                    </code>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2 md:col-span-2">
                    <span>{t("target")}</span>
                    <code className="text-right font-mono text-foreground">
                      {matchedRule.target}
                    </code>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <XCircle className="h-4 w-4" />
                {t("notMatched")}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
