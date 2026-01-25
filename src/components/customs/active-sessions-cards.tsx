"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronRight, Clock, Cpu, Key, Loader2, User, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { getActiveSessions } from "@/actions/active-sessions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/routing";
import { cn, formatTokenAmount } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import type { ActiveSessionInfo } from "@/types/session";

const REFRESH_INTERVAL = 5000;

async function fetchActiveSessions(): Promise<ActiveSessionInfo[]> {
  const result = await getActiveSessions();
  if (!result.ok) {
    throw new Error(result.error || "Failed to fetch active sessions");
  }
  return result.data;
}

function formatDuration(durationMs: number | undefined): string {
  if (!durationMs) return "-";
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(Number(durationMs) / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

interface ActiveSessionCardProps {
  session: ActiveSessionInfo;
  currencyCode: CurrencyCode;
}

function ActiveSessionCard({ session, currencyCode }: ActiveSessionCardProps) {
  const isError = session.status === "error" || (session.statusCode && session.statusCode >= 400);
  const isInProgress = session.status === "in_progress";

  return (
    <Link href={`/dashboard/sessions/${session.sessionId}/messages`} className="block group">
      <Card
        className={cn(
          "w-[280px] shrink-0 transition-all duration-200 hover:shadow-md hover:border-primary/30",
          isError && "border-destructive/40 bg-destructive/5",
          isInProgress && "border-blue-500/40 bg-blue-500/5"
        )}
      >
        <CardContent className="p-4 space-y-3">
          {/* Status indicator + User */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {isInProgress ? (
                <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin shrink-0" />
              ) : isError ? (
                <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
              ) : (
                <div className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
              )}
              <div className="flex items-center gap-1.5 min-w-0">
                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium text-sm truncate" title={session.userName}>
                  {session.userName}
                </span>
              </div>
            </div>
            <Badge variant="outline" className="text-xs shrink-0">
              <Clock className="h-3 w-3 mr-1" />
              {formatDuration(session.durationMs)}
            </Badge>
          </div>

          {/* Model + Provider */}
          <div className="flex items-center gap-1.5 text-xs">
            <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-mono truncate" title={session.model ?? undefined}>
              {session.model}
            </span>
            {session.providerName && (
              <span className="text-muted-foreground truncate">@ {session.providerName}</span>
            )}
          </div>

          {/* Key */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Key className="h-3 w-3 shrink-0" />
            <span className="font-mono truncate" title={session.keyName}>
              {session.keyName}
            </span>
          </div>

          {/* Tokens + Cost */}
          <div className="flex items-center justify-between text-xs pt-2 border-t">
            <div className="font-mono text-muted-foreground">
              {session.inputTokens !== undefined && (
                <span className="mr-2">{formatTokenAmount(session.inputTokens)} in</span>
              )}
              {session.outputTokens !== undefined && (
                <span>{formatTokenAmount(session.outputTokens)} out</span>
              )}
            </div>
            {session.costUsd && (
              <span className="font-mono font-medium">
                {formatCurrency(session.costUsd, currencyCode, 4)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ActiveSessionCardSkeleton() {
  return (
    <Card className="w-[280px] shrink-0">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-16" />
        </div>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-32" />
        <div className="flex items-center justify-between pt-2 border-t">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

interface ActiveSessionsCardsProps {
  currencyCode?: CurrencyCode;
  className?: string;
}

export function ActiveSessionsCards({ currencyCode = "USD", className }: ActiveSessionsCardsProps) {
  const tc = useTranslations("customs");

  const { data = [], isLoading } = useQuery<ActiveSessionInfo[], Error>({
    queryKey: ["active-sessions"],
    queryFn: fetchActiveSessions,
    refetchInterval: REFRESH_INTERVAL,
  });

  return (
    <Card className={cn("border-border/50", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{tc("activeSessions.title")}</CardTitle>
              <CardDescription className="text-xs">
                {tc("activeSessions.summary", { count: data.length, minutes: 5 })}
              </CardDescription>
            </div>
          </div>
          <Link
            href="/dashboard/sessions"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {tc("activeSessions.viewAll")}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && data.length === 0 ? (
          <ScrollArea className="w-full">
            <div className="flex gap-3 pb-3">
              {[1, 2, 3].map((i) => (
                <ActiveSessionCardSkeleton key={i} />
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
            {tc("activeSessions.empty")}
          </div>
        ) : (
          <ScrollArea className="w-full">
            <div className="flex gap-3 pb-3">
              {data.map((session) => (
                <ActiveSessionCard
                  key={session.sessionId}
                  session={session}
                  currencyCode={currencyCode}
                />
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
