"use client";

import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <div className="space-y-3 rounded-lg border border-muted bg-muted/30 p-4">
      <div className="grid gap-2">
        <Label htmlFor="test-message" className="text-xs font-medium">
          {t("errorRules.dialog.testMessageLabel")}
        </Label>
        <Input
          id="test-message"
          value={testMessage}
          onChange={(e) => setTestMessage(e.target.value)}
          placeholder={t("errorRules.dialog.testMessagePlaceholder")}
        />
      </div>

      {matchResult && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {matchResult.isValid ? (
              matchResult.matches ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <Badge variant="default" className="bg-green-600">
                    {t("errorRules.dialog.matchSuccess")}
                  </Badge>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="secondary">{t("errorRules.dialog.matchFailed")}</Badge>
                </>
              )
            ) : (
              <>
                <AlertCircle className="h-4 w-4 text-destructive" />
                <Badge variant="destructive">{t("errorRules.dialog.invalidPattern")}</Badge>
              </>
            )}
          </div>

          {matchResult.error && <p className="text-xs text-destructive">{matchResult.error}</p>}

          {matchResult.matchedText && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t("errorRules.dialog.matchedText")}:
              </p>
              <code className="block rounded bg-muted px-2 py-1 text-sm">
                {matchResult.matchedText}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
