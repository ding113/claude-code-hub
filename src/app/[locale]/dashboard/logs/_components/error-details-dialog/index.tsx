"use client";

import { FileText, Gauge, GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { hasSessionMessages } from "@/actions/active-sessions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ProviderChainItem } from "@/types/message";
import type { SpecialSetting } from "@/types/special-settings";
import type { BillingModelSource } from "@/types/system-config";
import { LogicTraceTab, PerformanceTab, SummaryTab } from "./components";

interface ErrorDetailsDialogProps {
  statusCode: number | null;
  errorMessage: string | null;
  providerChain: ProviderChainItem[] | null;
  sessionId: string | null;
  requestSequence?: number | null;
  blockedBy?: string | null;
  blockedReason?: string | null;
  originalModel?: string | null;
  currentModel?: string | null;
  userAgent?: string | null;
  messagesCount?: number | null;
  endpoint?: string | null;
  billingModelSource?: BillingModelSource;
  specialSettings?: SpecialSetting[] | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheCreation5mInputTokens?: number | null;
  cacheCreation1hInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheTtlApplied?: string | null;
  costUsd?: string | null;
  costMultiplier?: string | null;
  context1mApplied?: boolean | null;
  durationMs?: number | null;
  ttfbMs?: number | null;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
  scrollToRedirect?: boolean;
}

type TabValue = "summary" | "logic-trace" | "performance";

export function ErrorDetailsDialog({
  statusCode,
  errorMessage,
  providerChain,
  sessionId,
  requestSequence,
  blockedBy,
  blockedReason,
  originalModel,
  currentModel,
  userAgent,
  messagesCount,
  endpoint,
  billingModelSource = "original",
  specialSettings,
  inputTokens,
  outputTokens,
  cacheCreationInputTokens,
  cacheCreation5mInputTokens,
  cacheCreation1hInputTokens,
  cacheReadInputTokens,
  cacheTtlApplied,
  costUsd,
  costMultiplier,
  context1mApplied,
  durationMs,
  ttfbMs,
  externalOpen,
  onExternalOpenChange,
  scrollToRedirect,
}: ErrorDetailsDialogProps) {
  const t = useTranslations("dashboard.logs.details");
  const [internalOpen, setInternalOpen] = useState(false);
  const [hasMessages, setHasMessages] = useState(false);
  const [checkingMessages, setCheckingMessages] = useState(false);
  const [activeTab, setActiveTab] = useState<TabValue>("summary");
  const messageCheckRequestIdRef = useRef(0);

  // Support external and internal control
  const isControlled = externalOpen !== undefined;
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = useCallback(
    (value: boolean) => {
      if (isControlled) {
        onExternalOpenChange?.(value);
      } else {
        setInternalOpen(value);
      }
    },
    [isControlled, onExternalOpenChange]
  );

  const isInProgress = statusCode === null;

  // Check if session has messages data
  useEffect(() => {
    if (open && sessionId) {
      const requestId = ++messageCheckRequestIdRef.current;
      setCheckingMessages(true);
      hasSessionMessages(sessionId, requestSequence ?? undefined)
        .then((result) => {
          if (requestId !== messageCheckRequestIdRef.current) return;
          if (result.ok) {
            setHasMessages(result.data);
          }
        })
        .catch((err) => {
          if (requestId !== messageCheckRequestIdRef.current) return;
          console.error("Failed to check session messages:", err);
        })
        .finally(() => {
          if (requestId === messageCheckRequestIdRef.current) {
            setCheckingMessages(false);
          }
        });
    } else {
      setHasMessages(false);
      setCheckingMessages(false);
    }
  }, [open, sessionId, requestSequence]);

  // Handle scrollToRedirect - switch to metadata tab when redirect info needs focus
  useEffect(() => {
    if (open && scrollToRedirect) {
      // Switch to summary tab where model redirect info is displayed
      setActiveTab("summary");
      // Scroll to model redirect section after DOM render
      const timer = setTimeout(() => {
        const element = document.getElementById("model-redirect-section");
        element?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open, scrollToRedirect]);

  // Reset tab when dialog closes
  useEffect(() => {
    if (!open) {
      setActiveTab("summary");
    }
  }, [open]);

  /**
   * Get status badge className based on HTTP status code
   */
  const getStatusBadgeClassName = () => {
    if (isInProgress) {
      return "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600";
    }

    if (!statusCode) {
      return "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600";
    }

    if (statusCode >= 200 && statusCode < 300) {
      return "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700";
    }

    if (statusCode >= 300 && statusCode < 400) {
      return "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700";
    }

    if (statusCode >= 400 && statusCode < 500) {
      return "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700";
    }

    if (statusCode >= 500) {
      return "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700";
    }

    return "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600";
  };

  // Shared props for all tabs
  const sharedProps = {
    statusCode,
    errorMessage,
    providerChain,
    sessionId,
    requestSequence,
    blockedBy,
    blockedReason,
    originalModel,
    currentModel,
    userAgent,
    messagesCount,
    endpoint,
    billingModelSource,
    specialSettings,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheCreation5mInputTokens,
    cacheCreation1hInputTokens,
    cacheReadInputTokens,
    cacheTtlApplied,
    costUsd,
    costMultiplier,
    context1mApplied,
    durationMs,
    ttfbMs,
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" className="h-auto p-0 font-normal hover:bg-transparent">
          <Badge variant="outline" className={getStatusBadgeClassName()}>
            {isInProgress ? t("inProgress") : statusCode}
          </Badge>
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[95vw] sm:w-[480px] md:w-[540px] lg:w-[600px] xl:w-[640px] sm:max-w-none overflow-y-auto px-4 sm:px-6"
      >
        <SheetHeader className="pb-2">
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>

        <div className="pb-8">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as TabValue)}
            className="w-full"
          >
            <TabsList className="w-full grid grid-cols-3 h-auto p-1">
              <TabsTrigger
                value="summary"
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1.5 text-xs sm:text-sm",
                  "data-[state=active]:bg-background"
                )}
              >
                <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                <span className="hidden sm:inline">{t("tabs.summary")}</span>
              </TabsTrigger>
              <TabsTrigger
                value="logic-trace"
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1.5 text-xs sm:text-sm",
                  "data-[state=active]:bg-background"
                )}
              >
                <GitBranch className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                <span className="hidden sm:inline">{t("tabs.logicTrace")}</span>
              </TabsTrigger>
              <TabsTrigger
                value="performance"
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1.5 text-xs sm:text-sm",
                  "data-[state=active]:bg-background"
                )}
              >
                <Gauge className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                <span className="hidden sm:inline">{t("tabs.performance")}</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="mt-4">
              <SummaryTab
                {...sharedProps}
                hasMessages={hasMessages}
                checkingMessages={checkingMessages}
                onViewLogicTrace={() => setActiveTab("logic-trace")}
              />
            </TabsContent>

            <TabsContent value="logic-trace" className="mt-4">
              <LogicTraceTab {...sharedProps} />
            </TabsContent>

            <TabsContent value="performance" className="mt-4">
              <PerformanceTab {...sharedProps} />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
