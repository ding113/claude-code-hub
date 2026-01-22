"use client";

import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RegexTesterProps {
  pattern: string;
}

export function RegexTester({ pattern }: RegexTesterProps) {
  const t = useTranslations("settings");
  const [testMessage, setTestMessage] = useState("");
  const [matchResult, setMatchResult] = useState<{
    isValid: boolean;
    matches: boolean;
    error?: string;
    matchedText?: string;
  } | null>(null);

  useEffect(() => {
    if (!pattern || !testMessage) {
      setMatchResult(null);
      return;
    }

    try {
      const regex = new RegExp(pattern, "i");
      const match = regex.exec(testMessage);

      setMatchResult({
        isValid: true,
        matches: match !== null,
        matchedText: match ? match[0] : undefined,
      });
    } catch (error) {
      setMatchResult({
        isValid: false,
        matches: false,
        error: error instanceof Error ? error.message : "Invalid regex pattern",
      });
    }
  }, [pattern, testMessage]);

  return (
    <div className="space-y-3 rounded-xl bg-white/[0.02] border border-border/50 p-4">
      <div className="space-y-2">
        <label
          htmlFor="test-message"
          className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
        >
          {t("errorRules.dialog.testMessageLabel")}
        </label>
        <input
          id="test-message"
          type="text"
          value={testMessage}
          onChange={(e) => setTestMessage(e.target.value)}
          placeholder={t("errorRules.dialog.testMessagePlaceholder")}
          className={cn(
            "w-full bg-muted/50 border border-border rounded-lg py-2 px-3 text-sm text-foreground",
            "placeholder:text-muted-foreground/50",
            "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
          )}
        />
      </div>

      {matchResult && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {matchResult.isValid ? (
              matchResult.matches ? (
                <>
                  <div className="p-1 rounded-md bg-green-500/10">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  </div>
                  <Badge className="bg-green-500/10 text-green-400 border-green-500/20 text-[10px]">
                    {t("errorRules.dialog.matchSuccess")}
                  </Badge>
                </>
              ) : (
                <>
                  <div className="p-1 rounded-md bg-white/5">
                    <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <Badge
                    variant="secondary"
                    className="bg-white/5 text-muted-foreground border-border text-[10px]"
                  >
                    {t("errorRules.dialog.matchFailed")}
                  </Badge>
                </>
              )
            ) : (
              <>
                <div className="p-1 rounded-md bg-red-500/10">
                  <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                </div>
                <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px]">
                  {t("errorRules.dialog.invalidPattern")}
                </Badge>
              </>
            )}
          </div>

          {matchResult.error && <p className="text-xs text-red-400">{matchResult.error}</p>}

          {matchResult.matchedText && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t("errorRules.dialog.matchedText")}:
              </p>
              <code className="block rounded-lg bg-muted/50 border border-border/50 px-3 py-2 text-sm font-mono text-foreground">
                {matchResult.matchedText}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
