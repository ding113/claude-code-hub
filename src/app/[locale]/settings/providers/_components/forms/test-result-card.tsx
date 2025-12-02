"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  XCircle,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { TestStatus, TestSubStatus } from "@/lib/provider-testing";

/**
 * Unified test result data structure
 */
export interface UnifiedTestResultData {
  success: boolean;
  status: TestStatus;
  subStatus: TestSubStatus;
  message: string;
  latencyMs: number;
  firstByteMs?: number;
  httpStatusCode?: number;
  httpStatusText?: string;
  model?: string;
  content?: string;
  /** Raw response body for user inspection */
  rawResponse?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  streamInfo?: {
    isStreaming: boolean;
    chunksReceived?: number;
  };
  errorMessage?: string;
  errorType?: string;
  testedAt: string;
  validationDetails: {
    httpPassed: boolean;
    httpStatusCode?: number;
    latencyPassed: boolean;
    latencyMs?: number;
    contentPassed: boolean;
    contentTarget?: string;
  };
}

interface TestResultCardProps {
  result: UnifiedTestResultData;
}

const STATUS_COLORS: Record<TestStatus, { bg: string; text: string; border: string }> = {
  green: {
    bg: "bg-green-50 dark:bg-green-950",
    text: "text-green-700 dark:text-green-300",
    border: "border-green-200 dark:border-green-800",
  },
  yellow: {
    bg: "bg-yellow-50 dark:bg-yellow-950",
    text: "text-yellow-700 dark:text-yellow-300",
    border: "border-yellow-200 dark:border-yellow-800",
  },
  red: {
    bg: "bg-red-50 dark:bg-red-950",
    text: "text-red-700 dark:text-red-300",
    border: "border-red-200 dark:border-red-800",
  },
};

const STATUS_ICONS: Record<TestStatus, React.ReactNode> = {
  green: <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />,
  yellow: <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />,
  red: <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />,
};

/**
 * Test result card component with three-tier validation display
 * Shows status, latency, HTTP code, and content validation details
 */
export function TestResultCard({ result }: TestResultCardProps) {
  const t = useTranslations("settings.providers.form.apiTest");
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);

  const colors = STATUS_COLORS[result.status];
  const icon = STATUS_ICONS[result.status];
  const statusLabel = t(`resultCard.status.${result.status}`);

  const handleCopyResult = async () => {
    const ct = (key: string) => t(`resultCard.copyText.${key}`);
    const vp = (passed: boolean, type: "http" | "latency" | "content") => {
      if (type === "latency") {
        return passed
          ? `✓ ${t("resultCard.validation.passed")}`
          : `✗ ${t("resultCard.validation.timeout")}`;
      }
      return passed
        ? `✓ ${t("resultCard.validation.passed")}`
        : `✗ ${t("resultCard.validation.failed")}`;
    };

    const resultText = [
      `${ct("status")}: ${statusLabel} (${result.subStatus})`,
      `${ct("message")}: ${result.message}`,
      `${ct("latency")}: ${result.latencyMs}ms`,
      result.httpStatusCode &&
        `${ct("httpStatus")}: ${result.httpStatusCode} ${result.httpStatusText || ""}`,
      result.model && `${ct("model")}: ${result.model}`,
      result.usage &&
        t("resultCard.copyText.inputOutput", {
          input: result.usage.inputTokens,
          output: result.usage.outputTokens,
        }),
      result.content &&
        `${ct("response")}: ${result.content.slice(0, 200)}${result.content.length > 200 ? "..." : ""}`,
      result.errorMessage && `${ct("error")}: ${result.errorMessage}`,
      `${ct("testedAt")}: ${new Date(result.testedAt).toLocaleString()}`,
      "",
      `${ct("validationDetails")}:`,
      `  ${ct("httpCheck")}: ${vp(result.validationDetails.httpPassed, "http")}`,
      `  ${ct("latencyCheck")}: ${vp(result.validationDetails.latencyPassed, "latency")}`,
      `  ${ct("contentCheck")}: ${vp(result.validationDetails.contentPassed, "content")}`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(resultText);
      toast.success(t("copySuccess"));
    } catch (error) {
      console.error("Copy failed:", error);
      toast.error(t("copyFailed"));
    }
  };

  return (
    <div className={`rounded-md border p-4 ${colors.bg} ${colors.border}`}>
      {/* Header with status */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <span className={`font-semibold ${colors.text}`}>{statusLabel}</span>
          <Badge variant="outline" className={colors.text}>
            {result.subStatus}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                <ExternalLink className="h-4 w-4 mr-1" />
                {t("viewDetails")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {icon}
                  <span>{t("resultCard.dialogTitle")}</span>
                </DialogTitle>
                <DialogDescription>{result.message}</DialogDescription>
              </DialogHeader>
              <TestResultDetails result={result} onCopy={handleCopyResult} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Message */}
      <p className={`text-sm mb-3 ${colors.text}`}>{result.message}</p>

      {/* Three-tier validation indicators */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <ValidationIndicator
          label={t("resultCard.labels.http")}
          passed={result.validationDetails.httpPassed}
          value={result.httpStatusCode ? `${result.httpStatusCode}` : undefined}
        />
        <ValidationIndicator
          label={t("resultCard.labels.latency")}
          passed={result.validationDetails.latencyPassed}
          value={`${result.latencyMs}ms`}
        />
        <ValidationIndicator
          label={t("resultCard.labels.content")}
          passed={result.validationDetails.contentPassed}
          value={result.validationDetails.contentTarget}
        />
      </div>

      {/* Quick stats */}
      <div className="flex flex-wrap gap-4 text-xs">
        {result.model && (
          <div className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            <span className="text-muted-foreground">{t("resultCard.labels.model")}:</span>
            <span>{result.model}</span>
          </div>
        )}
        {result.firstByteMs !== undefined && (
          <div className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            <span className="text-muted-foreground">{t("resultCard.labels.firstByte")}:</span>
            <span>{result.firstByteMs}ms</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span className="text-muted-foreground">{t("resultCard.labels.totalLatency")}:</span>
          <span>{result.latencyMs}ms</span>
        </div>
      </div>

      {/* Error message if failed */}
      {result.errorMessage && (
        <div className="mt-3 p-2 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs">
          <span className="font-medium">{t("resultCard.labels.error")}:</span> {result.errorMessage}
        </div>
      )}

      {/* Content preview if success */}
      {result.content && result.status !== "red" && (
        <div className="mt-3 p-2 rounded bg-white/50 dark:bg-black/20 text-xs">
          <span className="font-medium text-muted-foreground">
            {t("resultCard.labels.responsePreview")}:
          </span>
          <pre className="mt-1 whitespace-pre-wrap break-words text-foreground">
            {result.content.slice(0, 150)}
            {result.content.length > 150 && "..."}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * Validation indicator component for each tier
 */
function ValidationIndicator({
  label,
  passed,
  value,
}: {
  label: string;
  passed: boolean;
  value?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center p-2 rounded-md ${
        passed ? "bg-green-100/50 dark:bg-green-900/20" : "bg-red-100/50 dark:bg-red-900/20"
      }`}
    >
      <div className="flex items-center gap-1 text-xs font-medium">
        {passed ? (
          <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
        ) : (
          <XCircle className="h-3 w-3 text-red-600 dark:text-red-400" />
        )}
        <span>{label}</span>
      </div>
      {value && <span className="text-xs text-muted-foreground truncate max-w-full">{value}</span>}
    </div>
  );
}

/**
 * Detailed test result view in dialog
 */
function TestResultDetails({
  result,
  onCopy,
}: {
  result: UnifiedTestResultData;
  onCopy: () => void;
}) {
  const t = useTranslations("settings.providers.form.apiTest");

  return (
    <div className="space-y-6 mt-4">
      {/* Status badges */}
      <div className="flex gap-2 flex-wrap">
        <Badge
          variant={
            result.status === "green"
              ? "default"
              : result.status === "yellow"
                ? "secondary"
                : "destructive"
          }
        >
          {t(`resultCard.status.${result.status}`)}
        </Badge>
        <Badge variant="outline">{result.subStatus}</Badge>
        {result.model && <Badge variant="outline">{result.model}</Badge>}
        {result.httpStatusCode && <Badge variant="outline">HTTP {result.httpStatusCode}</Badge>}
      </div>

      {/* Validation Details */}
      <div className="space-y-2">
        <h4 className="font-semibold text-sm">{t("resultCard.validation.title")}</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ValidationDetailCard
            title={t("resultCard.validation.http.title")}
            passed={result.validationDetails.httpPassed}
            statusCodeLabel={t("resultCard.validation.http.statusCode")}
            statusCode={result.validationDetails.httpStatusCode}
            judgmentLabel={t("resultCard.judgment")}
            judgmentText={
              result.validationDetails.httpPassed
                ? t("resultCard.validation.http.passed")
                : t("resultCard.validation.http.failed")
            }
          />
          <ValidationDetailCard
            title={t("resultCard.validation.latency.title")}
            passed={result.validationDetails.latencyPassed}
            statusCodeLabel={t("resultCard.validation.latency.actual")}
            statusCode={`${result.validationDetails.latencyMs || result.latencyMs}ms`}
            judgmentLabel={t("resultCard.judgment")}
            judgmentText={
              result.validationDetails.latencyPassed
                ? t("resultCard.validation.latency.passed")
                : t("resultCard.validation.latency.failed")
            }
          />
          <ValidationDetailCard
            title={t("resultCard.validation.content.title")}
            passed={result.validationDetails.contentPassed}
            statusCodeLabel={t("resultCard.validation.content.target")}
            statusCode={`"${result.validationDetails.contentTarget || "N/A"}"`}
            judgmentLabel={t("resultCard.judgment")}
            judgmentText={
              result.validationDetails.contentPassed
                ? t("resultCard.validation.content.passed")
                : t("resultCard.validation.content.failed")
            }
          />
        </div>
      </div>

      {/* Timing Info */}
      <div className="space-y-2">
        <h4 className="font-semibold text-sm">{t("resultCard.timing.title")}</h4>
        <div className="rounded-md border bg-muted/50 p-3 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">{t("resultCard.timing.totalLatency")}:</span>{" "}
            <span className="font-mono">{result.latencyMs}ms</span>
          </div>
          {result.firstByteMs !== undefined && (
            <div>
              <span className="text-muted-foreground">{t("resultCard.timing.firstByte")}:</span>{" "}
              <span className="font-mono">{result.firstByteMs}ms</span>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">{t("resultCard.timing.testedAt")}:</span>{" "}
            <span className="font-mono">{new Date(result.testedAt).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Token Usage */}
      {result.usage && (
        <div className="space-y-2">
          <h4 className="font-semibold text-sm">{t("resultCard.tokenUsage.title")}</h4>
          <div className="rounded-md border bg-muted/50 p-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{t("resultCard.tokenUsage.input")}:</span>{" "}
                <span className="font-mono">{result.usage.inputTokens}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("resultCard.tokenUsage.output")}:</span>{" "}
                <span className="font-mono">{result.usage.outputTokens}</span>
              </div>
              {result.usage.cacheCreationInputTokens !== undefined && (
                <div>
                  <span className="text-muted-foreground">
                    {t("resultCard.tokenUsage.cacheCreation")}:
                  </span>{" "}
                  <span className="font-mono">{result.usage.cacheCreationInputTokens}</span>
                </div>
              )}
              {result.usage.cacheReadInputTokens !== undefined && (
                <div>
                  <span className="text-muted-foreground">
                    {t("resultCard.tokenUsage.cacheRead")}:
                  </span>{" "}
                  <span className="font-mono">{result.usage.cacheReadInputTokens}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Raw Response Body - Full response for user inspection */}
      {(result.rawResponse || result.content) && (
        <div className="space-y-2">
          <h4 className="font-semibold text-sm">{t("resultCard.rawResponse.title")}</h4>
          <div className="rounded-md border bg-muted/50 p-3 max-h-96 overflow-y-auto">
            <pre className="text-xs whitespace-pre-wrap break-words font-mono">
              {result.rawResponse || result.content}
            </pre>
          </div>
          <p className="text-xs text-muted-foreground">{t("resultCard.rawResponse.hint")}</p>
        </div>
      )}

      {/* Error Details */}
      {result.errorMessage && (
        <div className="space-y-2">
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <XCircle className="h-4 w-4 text-destructive" />
            {t("resultCard.errorDetails.title")}
          </h4>
          <div className="rounded-md border bg-destructive/10 p-3 max-h-40 overflow-y-auto">
            <div className="text-xs space-y-1">
              {result.errorType && (
                <div>
                  <span className="font-medium">{t("resultCard.errorDetails.type")}:</span>{" "}
                  {result.errorType}
                </div>
              )}
              <pre className="text-destructive whitespace-pre-wrap break-words font-mono">
                {result.errorMessage}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCopy} className="flex-1">
          <Copy className="h-4 w-4 mr-2" />
          {t("copyResult")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Validation detail card for each tier
 */
function ValidationDetailCard({
  title,
  passed,
  statusCodeLabel,
  statusCode,
  judgmentLabel,
  judgmentText,
}: {
  title: string;
  passed: boolean;
  statusCodeLabel: string;
  statusCode: string | number | undefined;
  judgmentLabel: string;
  judgmentText: string;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        passed
          ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
          : "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        {passed ? (
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
        ) : (
          <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
        )}
        <span className="font-medium text-sm">{title}</span>
      </div>
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          {statusCodeLabel}: {statusCode || "N/A"}
        </div>
        <div className="text-xs text-muted-foreground">
          {judgmentLabel}: {judgmentText}
        </div>
      </div>
    </div>
  );
}
