"use client";

import {
  AlertTriangle,
  Check,
  Code2,
  HelpCircle,
  Package,
  Tag,
  Terminal,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ClientVersionStats } from "@/lib/client-version-checker";
import { getClientTypeDisplayName } from "@/lib/ua-parser";
import { formatDateDistance } from "@/lib/utils/date-format";

interface ClientVersionStatsTableProps {
  data: ClientVersionStats[];
}

/**
 * Get icon component for client type
 */
function getClientTypeIcon(clientType: string): React.ComponentType<{ className?: string }> {
  const icons: Record<string, React.ComponentType<{ className?: string }>> = {
    "claude-vscode": Code2,
    "claude-cli": Terminal,
    "claude-cli-unknown": HelpCircle,
    "anthropic-sdk-typescript": Package,
  };
  return icons[clientType] || HelpCircle;
}

export function ClientVersionStatsTable({ data }: ClientVersionStatsTableProps) {
  const locale = useLocale();
  const t = useTranslations("settings.clientVersions.table");
  const tCommon = useTranslations("settings.common");

  // Calculate totals
  const totalClients = data.length;
  const totalUsers = data.reduce((sum, client) => sum + client.totalUsers, 0);
  const clientsWithGA = data.filter((c) => c.gaVersion).length;

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white/[0.02] border border-border/50">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Package className="h-4 w-4" />
            <span>{t("stats.clientTypes")}</span>
          </div>
          <p className="text-lg font-mono font-bold text-foreground">{totalClients}</p>
        </div>
        <div className="p-4 rounded-xl bg-white/[0.02] border border-border/50">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Users className="h-4 w-4" />
            <span>{t("stats.totalUsers")}</span>
          </div>
          <p className="text-lg font-mono font-bold text-foreground">{totalUsers}</p>
        </div>
        <div className="p-4 rounded-xl bg-white/[0.02] border border-border/50">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Tag className="h-4 w-4" />
            <span>{t("stats.withGA")}</span>
          </div>
          <p className="text-lg font-mono font-bold text-foreground">{clientsWithGA}</p>
        </div>
        <div className="p-4 rounded-xl bg-white/[0.02] border border-border/50">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Check className="h-4 w-4" />
            <span>{t("stats.coverage")}</span>
          </div>
          <p className="text-lg font-mono font-bold text-foreground">
            {totalClients > 0 ? Math.round((clientsWithGA / totalClients) * 100) : 0}%
          </p>
        </div>
      </div>

      {/* Client Type Tables */}
      {data.map((clientStats) => {
        const displayName = getClientTypeDisplayName(clientStats.clientType);
        const IconComponent = getClientTypeIcon(clientStats.clientType);

        return (
          <div key={clientStats.clientType} className="space-y-3">
            {/* Client Type Header */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-border/50">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-[#E25706]/10 shrink-0">
                  <IconComponent className="h-4 w-4 text-[#E25706]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{displayName}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("internalType")}
                    <code className="text-[10px] ml-1 px-1.5 py-0.5 rounded bg-muted/50 font-mono">
                      {clientStats.clientType}
                    </code>
                    <span className="mx-2">|</span>
                    {t("currentGA")}
                    <Badge variant="outline" className="ml-1 text-[10px] h-5 border-border">
                      {clientStats.gaVersion || tCommon("none")}
                    </Badge>
                  </p>
                </div>
              </div>
              <Badge
                variant="secondary"
                className="bg-white/5 text-muted-foreground border-0 font-mono"
              >
                {t("usersCount", { count: clientStats.totalUsers })}
              </Badge>
            </div>

            {/* Users Table */}
            <div className="rounded-xl border border-border/50 overflow-hidden bg-black/10">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead className="text-xs text-muted-foreground font-medium">
                      {t("user")}
                    </TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium">
                      {t("version")}
                    </TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium">
                      {t("lastActive")}
                    </TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium">
                      {t("status")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientStats.users.length === 0 ? (
                    <TableRow className="border-border/50 hover:bg-white/[0.02]">
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        {t("noUsers")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    clientStats.users.map((user) => (
                      <TableRow
                        key={`${user.userId}-${user.version}`}
                        className="border-border/50 hover:bg-white/[0.02]"
                      >
                        <TableCell className="font-medium text-sm">{user.username}</TableCell>
                        <TableCell>
                          <code className="text-xs px-2 py-1 rounded bg-muted/50 font-mono text-muted-foreground">
                            {user.version}
                          </code>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateDistance(new Date(user.lastSeen), new Date(), locale)}
                        </TableCell>
                        <TableCell>
                          {user.isLatest ? (
                            <Badge
                              variant="default"
                              className="bg-green-500/10 text-green-400 border border-green-500/20 gap-1 hover:bg-green-500/20"
                            >
                              <Check className="h-3 w-3" />
                              {t("latest")}
                            </Badge>
                          ) : user.needsUpgrade ? (
                            <Badge
                              variant="destructive"
                              className="bg-red-500/10 text-red-400 border border-red-500/20 gap-1 hover:bg-red-500/20"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {t("needsUpgrade")}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-white/5 text-muted-foreground border-border gap-1"
                            >
                              <HelpCircle className="h-3 w-3" />
                              {t("unknown")}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
