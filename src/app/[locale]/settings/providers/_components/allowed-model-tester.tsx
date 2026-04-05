"use client";

import { CheckCircle2, Info, Search, ShieldX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { findMatchingAllowedModelRule, matchesAllowedModelRules } from "@/lib/allowed-model-rules";
import type { AllowedModelRule } from "@/types/provider";

interface AllowedModelTesterProps {
  rules: AllowedModelRule[];
}

export function AllowedModelTester({ rules }: AllowedModelTesterProps) {
  const t = useTranslations("settings.providers.form.matchTester");
  const [modelName, setModelName] = useState("");
  const [testedModel, setTestedModel] = useState("");

  const matchedRule = useMemo(
    () => findMatchingAllowedModelRule(testedModel, rules),
    [rules, testedModel]
  );
  const isAllowed = useMemo(
    () => matchesAllowedModelRules(testedModel, rules),
    [rules, testedModel]
  );
  const matchedIndex = matchedRule
    ? rules.findIndex(
        (rule) => rule === matchedRule || JSON.stringify(rule) === JSON.stringify(matchedRule)
      )
    : -1;

  const handleTest = () => {
    setTestedModel(modelName.trim());
  };

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">{t("allowedTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("allowedDescription")}</p>
        </div>

        <div className="flex flex-col gap-2 md:flex-row">
          <Input
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            onInput={(e) => setModelName((e.target as HTMLInputElement).value)}
            placeholder={t("inputPlaceholder")}
          />
          <Button type="button" variant="outline" onClick={handleTest} disabled={!modelName.trim()}>
            <Search className="mr-2 h-4 w-4" />
            {t("testButton")}
          </Button>
        </div>

        {testedModel ? (
          <div className="rounded-lg border border-border/60 bg-background/80 p-3">
            {rules.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-sky-600">
                <Info className="h-4 w-4" />
                {t("allAllowed")}
              </div>
            ) : isAllowed && matchedRule ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("allowed")}
                </div>
                <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2">
                    <span>{t("ruleIndex")}</span>
                    <Badge variant="outline">#{matchedIndex + 1}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2">
                    <span>{t("matchType")}</span>
                    <Badge variant="secondary">{matchedRule.matchType}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2 md:col-span-2">
                    <span>{t("pattern")}</span>
                    <code className="text-right font-mono text-foreground">
                      {matchedRule.pattern}
                    </code>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <ShieldX className="h-4 w-4" />
                {t("blocked")}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
