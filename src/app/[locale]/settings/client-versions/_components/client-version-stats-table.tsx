"use client";

import { AlertTriangle, Check, Code2, HelpCircle, Package, Terminal } from "lucide-react";
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
 * 获取客户端类型对应的图标组件
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

  return (
    <div className="space-y-8">
      {data.map((clientStats) => {
        const displayName = getClientTypeDisplayName(clientStats.clientType);
        const IconComponent = getClientTypeIcon(clientStats.clientType);

        return (
          <div key={clientStats.clientType} className="space-y-3">
            {/* 客户端类型标题 */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <IconComponent className="h-5 w-5 text-blue-600" />
                  {displayName}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t("internalType")}
                  <code className="text-xs">{clientStats.clientType}</code>
                  {" · "}
                  {t("currentGA")}
                  <Badge variant="outline" className="ml-2">
                    {clientStats.gaVersion || tCommon("none")}
                  </Badge>
                </p>
              </div>
              <Badge variant="secondary">
                {t("usersCount", { count: clientStats.totalUsers })}
              </Badge>
            </div>

            {/* 用户版本列表 */}
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("user")}</TableHead>
                    <TableHead>{t("version")}</TableHead>
                    <TableHead>{t("lastActive")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientStats.users.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        {t("noUsers")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    clientStats.users.map((user) => (
                      <TableRow key={`${user.userId}-${user.version}`}>
                        <TableCell className="font-medium">{user.username}</TableCell>
                        <TableCell>
                          <code className="rounded bg-muted px-2 py-1 text-sm">{user.version}</code>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateDistance(new Date(user.lastSeen), new Date(), locale)}
                        </TableCell>
                        <TableCell>
                          {user.isLatest ? (
                            <Badge
                              variant="default"
                              className="bg-green-500 hover:bg-green-600 gap-1"
                            >
                              <Check className="h-3 w-3" />
                              {t("latest")}
                            </Badge>
                          ) : user.needsUpgrade ? (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              {t("needsUpgrade")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1">
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
