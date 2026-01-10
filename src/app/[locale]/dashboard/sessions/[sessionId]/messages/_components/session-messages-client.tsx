"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Info,
  Menu,
  Monitor,
  MoreVertical,
  XCircle,
} from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getSessionDetails, terminateActiveSession } from "@/actions/active-sessions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePathname, useRouter } from "@/i18n/routing";
import type { CurrencyCode } from "@/lib/utils/currency";
import { RequestListSidebar } from "./request-list-sidebar";
import { type SessionMessages, SessionMessagesDetailsTabs } from "./session-details-tabs";
import { isSessionMessages } from "./session-messages-guards";
import { SessionStats } from "./session-stats";

async function fetchSystemSettings(): Promise<{
  currencyDisplay: CurrencyCode;
}> {
  const response = await fetch("/api/system-settings");
  if (!response.ok) {
    throw new Error("Failed to fetch system settings");
  }
  return response.json();
}

export function SessionMessagesClient() {
  const t = useTranslations("dashboard.sessions");

  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const sessionId = params.sessionId as string;

  // URL state
  const seqParam = searchParams.get("seq");
  const selectedSeq = (() => {
    if (!seqParam) return null;
    const parsed = Number.parseInt(seqParam, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  })();

  // Data State
  const [messages, setMessages] = useState<SessionMessages | null>(null);
  const [requestBody, setRequestBody] = useState<unknown | null>(null);
  const [response, setResponse] = useState<string | null>(null);
  const [requestHeaders, setRequestHeaders] = useState<Record<string, string> | null>(null);
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string> | null>(null);
  const [specialSettings, setSpecialSettings] =
    useState<
      Extract<
        Awaited<ReturnType<typeof getSessionDetails>>,
        { ok: true }
      >["data"]["specialSettings"]
    >(null);
  const [requestMeta, setRequestMeta] = useState<{
    clientUrl: string | null;
    upstreamUrl: string | null;
    method: string | null;
  }>({ clientUrl: null, upstreamUrl: null, method: null });
  const [responseMeta, setResponseMeta] = useState<{
    upstreamUrl: string | null;
    statusCode: number | null;
  }>({ upstreamUrl: null, statusCode: null });
  const [sessionStats, setSessionStats] =
    useState<
      Extract<Awaited<ReturnType<typeof getSessionDetails>>, { ok: true }>["data"]["sessionStats"]
    >(null);
  const [currentSequence, setCurrentSequence] = useState<number | null>(null);
  const [prevSequence, setPrevSequence] = useState<number | null>(null);
  const [nextSequence, setNextSequence] = useState<number | null>(null);

  // UI State
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedRequest, setCopiedRequest] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);
  const [showTerminateDialog, setShowTerminateDialog] = useState(false);
  const [isTerminating, setIsTerminating] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileStatsOpen, setIsMobileStatsOpen] = useState(false);

  const resetDetailsState = useCallback(() => {
    setMessages(null);
    setRequestBody(null);
    setResponse(null);
    setRequestHeaders(null);
    setResponseHeaders(null);
    setSpecialSettings(null);
    setRequestMeta({ clientUrl: null, upstreamUrl: null, method: null });
    setResponseMeta({ upstreamUrl: null, statusCode: null });
    setSessionStats(null);
    setCurrentSequence(null);
    setPrevSequence(null);
    setNextSequence(null);
  }, []);

  const { data: systemSettings } = useQuery({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
  });

  const currencyCode = systemSettings?.currencyDisplay || "USD";

  const handleSelectRequest = useCallback(
    (seq: number) => {
      const params = new URLSearchParams(window.location.search);
      params.set("seq", seq.toString());
      router.replace(`${pathname}?${params.toString()}`);
      setIsMobileMenuOpen(false);
    },
    [router, pathname]
  );

  useEffect(() => {
    let cancelled = false;

    const fetchDetails = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await getSessionDetails(sessionId, selectedSeq ?? undefined);
        if (cancelled) return;

        if (result.ok) {
          setRequestBody(result.data.requestBody);
          const maybeMessages = result.data.messages;
          setMessages(isSessionMessages(maybeMessages) ? maybeMessages : null);
          setResponse(result.data.response);
          setRequestHeaders(result.data.requestHeaders);
          setResponseHeaders(result.data.responseHeaders);
          setSpecialSettings(result.data.specialSettings);
          setRequestMeta(result.data.requestMeta);
          setResponseMeta(result.data.responseMeta);
          setSessionStats(result.data.sessionStats);
          setCurrentSequence(result.data.currentSequence);
          setPrevSequence(result.data.prevSequence);
          setNextSequence(result.data.nextSequence);
        } else {
          resetDetailsState();
          setError(result.error || t("status.fetchFailed"));
        }
      } catch (err) {
        if (cancelled) return;
        resetDetailsState();
        setError(err instanceof Error ? err.message : t("status.unknownError"));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchDetails();

    return () => {
      cancelled = true;
    };
  }, [resetDetailsState, sessionId, selectedSeq, t]);

  const canExportRequest =
    !isLoading && error === null && requestHeaders !== null && requestBody !== null;
  const exportSequence = selectedSeq ?? currentSequence;

  const getRequestExportJson = () => {
    return JSON.stringify(
      {
        sessionId,
        sequence: exportSequence,
        meta: requestMeta,
        headers: requestHeaders,
        body: requestBody,
        specialSettings,
      },
      null,
      2
    );
  };

  const handleCopyRequest = async () => {
    if (!canExportRequest) return;
    try {
      await navigator.clipboard.writeText(getRequestExportJson());
      setCopiedRequest(true);
      setTimeout(() => setCopiedRequest(false), 2000);
      toast.success(t("actions.copied"));
    } catch (err) {
      console.error(t("errors.copyFailed"), err);
      toast.error(t("errors.copyFailed"));
    }
  };

  const handleCopyResponse = async () => {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(response);
      setCopiedResponse(true);
      setTimeout(() => setCopiedResponse(false), 2000);
      toast.success(t("actions.copied"));
    } catch (err) {
      console.error(t("errors.copyFailed"), err);
      toast.error(t("errors.copyFailed"));
    }
  };

  const handleDownloadRequest = () => {
    if (!canExportRequest) return;
    const jsonStr = getRequestExportJson();
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const seqPart = exportSequence !== null ? `-seq-${exportSequence}` : "";
    a.download = `session-${sessionId.substring(0, 8)}${seqPart}-request.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleTerminateSession = async () => {
    setIsTerminating(true);
    try {
      const result = await terminateActiveSession(sessionId);
      if (result.ok) {
        toast.success(t("actions.terminateSuccess"));
        router.push("/dashboard/sessions");
      } else {
        toast.error(result.error || t("actions.terminateFailed"));
      }
    } catch (_error) {
      toast.error(t("actions.terminateFailed"));
    } finally {
      setIsTerminating(false);
      setShowTerminateDialog(false);
    }
  };

  return (
    <div className="flex h-full bg-background">
      {/* Mobile Sidebar (Requests) */}
      <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-[300px]">
          <SheetHeader className="p-4 border-b">
            <SheetTitle>{t("requestList.title")}</SheetTitle>
          </SheetHeader>
          <div className="h-full">
            <RequestListSidebar
              sessionId={sessionId}
              selectedSeq={selectedSeq ?? currentSequence}
              onSelect={handleSelectRequest}
              className="border-none w-full"
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile Stats (Right Sheet) */}
      {sessionStats && (
        <Sheet open={isMobileStatsOpen} onOpenChange={setIsMobileStatsOpen}>
          <SheetContent side="right" className="w-[300px] overflow-y-auto">
            <SheetHeader className="pb-4">
              <SheetTitle>{t("details.overview")}</SheetTitle>
            </SheetHeader>
            <SessionStats stats={sessionStats} currencyCode={currencyCode} />
          </SheetContent>
        </Sheet>
      )}

      {/* Desktop Left Sidebar (Requests) */}
      <aside className="hidden md:flex flex-col border-r bg-muted/10 h-full transition-all duration-300 ease-in-out relative group">
        <div className={sidebarCollapsed ? "w-16" : "w-72"}>
          <RequestListSidebar
            sessionId={sessionId}
            selectedSeq={selectedSeq ?? currentSequence}
            onSelect={handleSelectRequest}
            collapsed={sidebarCollapsed}
            className="h-full"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="absolute -right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full border bg-background shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-10"
        >
          <MoreVertical className="h-3 w-3" />
        </Button>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Header */}
        <header className="flex-none h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6 flex items-center justify-between z-10">
          <div className="flex items-center gap-4 min-w-0">
            {/* Mobile Menu Toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 -ml-2 text-muted-foreground"
                onClick={() => router.back()}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                {t("actions.back")}
              </Button>
              <span className="text-muted-foreground/40">/</span>
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="font-semibold text-foreground truncate">{t("details.title")}</h1>
                <Badge
                  variant="outline"
                  className="font-mono font-normal text-xs bg-muted/50 truncate max-w-[100px] sm:max-w-none"
                >
                  {sessionId}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Desktop Actions */}
            <div className="hidden sm:flex items-center gap-2">
              {canExportRequest && (
                <>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={t("actions.copyMessages")}
                          onClick={handleCopyRequest}
                        >
                          {copiedRequest ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                          <span className="sr-only">{t("actions.copyMessages")}</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("actions.copyMessages")}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={t("actions.downloadMessages")}
                          onClick={handleDownloadRequest}
                        >
                          <Download className="h-4 w-4" />
                          <span className="sr-only">{t("actions.downloadMessages")}</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("actions.downloadMessages")}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}

              {sessionStats && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8"
                  onClick={() => setShowTerminateDialog(true)}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  {t("actions.terminate")}
                </Button>
              )}
            </div>

            {/* Mobile Actions Dropdown */}
            <div className="sm:hidden flex items-center gap-2">
              {/* Info Toggle for Mobile */}
              {sessionStats && (
                <Button variant="ghost" size="icon" onClick={() => setIsMobileStatsOpen(true)}>
                  <Info className="h-5 w-5" />
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canExportRequest && (
                    <>
                      <DropdownMenuItem onClick={handleCopyRequest}>
                        <Copy className="h-4 w-4 mr-2" /> {t("actions.copyMessages")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleDownloadRequest}>
                        <Download className="h-4 w-4 mr-2" /> {t("actions.downloadMessages")}
                      </DropdownMenuItem>
                    </>
                  )}
                  {sessionStats && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setShowTerminateDialog(true)}
                    >
                      <XCircle className="h-4 w-4 mr-2" /> {t("actions.terminate")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* 3-Column Content Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Center: Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
            <div className="max-w-5xl mx-auto space-y-6">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-32 text-muted-foreground animate-pulse">
                  <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
                  <p>{t("status.loading")}</p>
                </div>
              ) : error ? (
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-8 text-center">
                  <XCircle className="h-8 w-8 text-destructive mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-destructive">{t("status.error")}</h3>
                  <p className="text-muted-foreground mt-2">{error}</p>
                </div>
              ) : (
                <>
                  {/* Nav & Info Banner */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!prevSequence}
                        onClick={() => prevSequence && handleSelectRequest(prevSequence)}
                      >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        {t("details.prevRequest")}
                      </Button>
                      <Badge variant="secondary">#{selectedSeq ?? currentSequence ?? "-"}</Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!nextSequence}
                        onClick={() => nextSequence && handleSelectRequest(nextSequence)}
                        className="flex-row-reverse"
                      >
                        <ArrowLeft className="h-4 w-4 ml-2 rotate-180" />
                        {t("details.nextRequest")}
                      </Button>
                    </div>

                    {sessionStats?.userAgent && (
                      <div className="bg-muted/30 rounded-lg p-3 flex items-start gap-3 border text-sm text-muted-foreground">
                        <Monitor className="h-4 w-4 mt-0.5 text-blue-500 shrink-0" />
                        <code className="break-all font-mono text-xs">
                          {sessionStats.userAgent}
                        </code>
                      </div>
                    )}
                  </div>

                  {/* Main Content - No more extra Card wrapper */}
                  <SessionMessagesDetailsTabs
                    messages={messages}
                    requestBody={requestBody}
                    specialSettings={specialSettings}
                    response={response}
                    requestHeaders={requestHeaders}
                    responseHeaders={responseHeaders}
                    requestMeta={requestMeta}
                    responseMeta={responseMeta}
                    onCopyResponse={handleCopyResponse}
                    isResponseCopied={copiedResponse}
                  />

                  {/* Empty State */}
                  {!sessionStats?.userAgent &&
                    !messages &&
                    !requestBody &&
                    !response &&
                    !requestHeaders && (
                      <div className="text-center py-20 border-2 border-dashed rounded-xl bg-muted/10">
                        <div className="text-muted-foreground text-lg mb-2 font-medium">
                          {t("details.noDetailedData")}
                        </div>
                        <p className="text-sm text-muted-foreground">{t("details.storageTip")}</p>
                      </div>
                    )}
                </>
              )}
            </div>
          </div>

          {/* Right Sidebar: Stats (Desktop Only) */}
          {sessionStats && (
            <aside className="w-80 border-l bg-muted/5 overflow-y-auto hidden xl:block p-6">
              <h3 className="font-semibold mb-4 text-sm uppercase tracking-wider text-muted-foreground">
                {t("details.overview")}
              </h3>
              <SessionStats stats={sessionStats} currencyCode={currencyCode} />
            </aside>
          )}
        </div>
      </main>

      {/* Terminate Dialog */}
      <AlertDialog open={showTerminateDialog} onOpenChange={setShowTerminateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.terminateSessionTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {t("actions.terminateSessionDescription")}
                <div className="mt-2 p-2 bg-muted rounded font-mono text-xs break-all">
                  {sessionId}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isTerminating}>{t("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleTerminateSession}
              disabled={isTerminating}
            >
              {isTerminating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isTerminating ? t("actions.terminating") : t("actions.confirmTerminate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Helper icons
function Loader2(props: React.ComponentProps<"svg">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
