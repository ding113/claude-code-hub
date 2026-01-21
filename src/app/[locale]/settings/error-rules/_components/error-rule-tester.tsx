"use client";

import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { testErrorRuleAction } from "@/actions/error-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ErrorOverrideResponse } from "@/repository/error-rules";

interface TestResult {
  matched: boolean;
  rule?: {
    category: string;
    pattern: string;
    matchType: "regex" | "contains" | "exact";
    overrideResponse: ErrorOverrideResponse | null;
    overrideStatusCode: number | null;
  };
  finalResponse: ErrorOverrideResponse | null;
  finalStatusCode: number | null;
  warnings?: string[];
}

export function ErrorRuleTester() {
  const t = useTranslations("settings");
  const [message, setMessage] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const handleTest = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      toast.error(t("errorRules.tester.messageRequired"));
      return;
    }

    setIsTesting(true);
    setResult(null);

    try {
      const response = await testErrorRuleAction({ message });

      if (response.ok) {
        setResult(response.data);
      } else {
        toast.error(response.error);
      }
    } catch {
      toast.error(t("errorRules.tester.testFailed"));
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label
          htmlFor="error-rule-test-message"
          className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
        >
          {t("errorRules.tester.inputLabel")}
        </Label>
        <textarea
          id="error-rule-test-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("errorRules.tester.inputPlaceholder")}
          rows={3}
          className={cn(
            "w-full bg-muted/50 border border-border rounded-lg py-2.5 px-3 text-sm text-foreground",
            "placeholder:text-muted-foreground/50 resize-none",
            "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
          )}
        />
      </div>

      <Button onClick={handleTest} disabled={isTesting} className="bg-primary hover:bg-primary/90">
        {isTesting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("errorRules.tester.testing")}
          </>
        ) : (
          t("errorRules.tester.testButton")
        )}
      </Button>

      {result && (
        <div className="space-y-4 rounded-xl bg-white/[0.02] border border-border/50 p-4">
          {/* Match Status */}
          <div className="flex flex-wrap items-center gap-2">
            {result.matched ? (
              <>
                <div className="p-1.5 rounded-lg bg-green-500/10">
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                </div>
                <span className="text-sm font-medium text-green-400">
                  {t("errorRules.tester.matched")}
                </span>
              </>
            ) : (
              <>
                <div className="p-1.5 rounded-lg bg-white/5">
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">
                  {t("errorRules.tester.notMatched")}
                </span>
              </>
            )}
          </div>

          <div className="space-y-4">
            {/* Rule Info */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("errorRules.tester.ruleInfo")}
              </p>
              {result.rule ? (
                <div className="space-y-2 rounded-lg bg-muted/50 border border-border/50 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs text-muted-foreground">
                      {t("errorRules.tester.category")}
                    </span>
                    <Badge
                      variant="secondary"
                      className="bg-white/5 text-foreground border-border text-[10px]"
                    >
                      {result.rule.category}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs text-muted-foreground">
                      {t("errorRules.tester.matchType")}
                    </span>
                    <Badge variant="outline" className="border-border text-[10px]">
                      {result.rule.matchType}
                    </Badge>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-xs text-muted-foreground shrink-0">
                      {t("errorRules.tester.pattern")}
                    </span>
                    <code className="max-w-[260px] break-all text-right font-mono text-xs text-foreground">
                      {result.rule.pattern}
                    </code>
                  </div>
                  {result.rule.overrideStatusCode !== null && (
                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/50">
                      <span className="text-xs text-muted-foreground">
                        {t("errorRules.tester.overrideStatusCode")}
                      </span>
                      <Badge variant="outline" className="border-border text-[10px]">
                        {result.rule.overrideStatusCode}
                      </Badge>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("errorRules.tester.noRule")}</p>
              )}
            </div>

            {/* Warnings */}
            {result.warnings && result.warnings.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("errorRules.tester.warnings")}
                </p>
                <div className="space-y-2">
                  {result.warnings.map((warning, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-2 rounded-lg bg-yellow-500/5 border border-yellow-500/20 px-3 py-2.5"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
                      <span className="text-xs text-yellow-200">{warning}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Final Response */}
            {(result.finalResponse || result.finalStatusCode !== null) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t("errorRules.tester.finalResponse")}
                  </p>
                  {result.finalStatusCode !== null && (
                    <Badge variant="outline" className="border-border text-[10px]">
                      HTTP {result.finalStatusCode}
                    </Badge>
                  )}
                </div>
                {result.finalResponse ? (
                  <pre className="rounded-lg bg-black/30 border border-border/50 px-3 py-2.5 text-xs font-mono text-foreground overflow-x-auto max-h-48">
                    {JSON.stringify(result.finalResponse, null, 2)}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground rounded-lg bg-muted/50 border border-border/50 px-3 py-2.5">
                    {t("errorRules.tester.statusCodeOnlyOverride")}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
