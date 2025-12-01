"use client";

import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { testErrorRuleAction } from "@/actions/error-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
      <div className="grid gap-2">
        <Label htmlFor="error-rule-test-message">{t("errorRules.tester.inputLabel")}</Label>
        <Textarea
          id="error-rule-test-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("errorRules.tester.inputPlaceholder")}
          rows={3}
        />
      </div>

      <Button onClick={handleTest} disabled={isTesting}>
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
        <div className="space-y-4 rounded-lg border border-muted bg-muted/30 p-4">
          {/* 匹配状态 */}
          <div className="flex flex-wrap items-center gap-2">
            {result.matched ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-700">
                  {t("errorRules.tester.matched")}
                </span>
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  {t("errorRules.tester.notMatched")}
                </span>
              </>
            )}
          </div>

          <div className="grid gap-4">
            {/* 规则信息 */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t("errorRules.tester.ruleInfo")}
              </p>
              {result.rule ? (
                <div className="space-y-1 rounded border border-border bg-card/60 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">{t("errorRules.tester.category")}</span>
                    <Badge variant="secondary">{result.rule.category}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">
                      {t("errorRules.tester.matchType")}
                    </span>
                    <Badge variant="outline">{result.rule.matchType}</Badge>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground shrink-0">
                      {t("errorRules.tester.pattern")}
                    </span>
                    <code className="max-w-[260px] break-all text-right font-mono text-xs">
                      {result.rule.pattern}
                    </code>
                  </div>
                  {result.rule.overrideStatusCode !== null && (
                    <div className="flex items-center justify-between gap-4 pt-1 border-t border-border/50">
                      <span className="text-muted-foreground">
                        {t("errorRules.tester.overrideStatusCode")}
                      </span>
                      <Badge variant="outline">{result.rule.overrideStatusCode}</Badge>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("errorRules.tester.noRule")}</p>
              )}
            </div>

            {/* 警告信息 */}
            {result.warnings && result.warnings.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("errorRules.tester.warnings")}
                </p>
                <div className="space-y-1">
                  {result.warnings.map((warning, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-2 rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm dark:border-yellow-900 dark:bg-yellow-950"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-500" />
                      <span className="text-yellow-800 dark:text-yellow-200">{warning}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 最终返回响应（响应体覆写或仅状态码覆写） */}
            {(result.finalResponse || result.finalStatusCode !== null) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("errorRules.tester.finalResponse")}
                  </p>
                  {result.finalStatusCode !== null && (
                    <Badge variant="outline" className="text-xs">
                      HTTP {result.finalStatusCode}
                    </Badge>
                  )}
                </div>
                {result.finalResponse ? (
                  <pre className="rounded bg-background px-3 py-2 text-xs font-mono overflow-x-auto max-h-48">
                    {JSON.stringify(result.finalResponse, null, 2)}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground rounded bg-background px-3 py-2">
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
