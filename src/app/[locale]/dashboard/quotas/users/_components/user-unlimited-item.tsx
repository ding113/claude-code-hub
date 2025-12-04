"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getContrastTextColor, getGroupColor } from "@/lib/utils/color";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import type { UserKeyWithUsage, UserQuotaWithUsage } from "./types";

interface UserUnlimitedItemProps {
  user: UserQuotaWithUsage;
  currencyCode?: CurrencyCode;
}

const MAX_INLINE_KEYS = 3;

function KeyChip({
  keyData,
  currencyCode,
}: {
  keyData: UserKeyWithUsage;
  currencyCode: CurrencyCode;
}) {
  return (
    <Badge variant="outline" className="font-mono text-xs">
      {keyData.name} · {formatCurrency(keyData.totalUsage, currencyCode)}
    </Badge>
  );
}

export function UserUnlimitedItem({ user, currencyCode = "USD" }: UserUnlimitedItemProps) {
  const t = useTranslations("quota.users");
  const topKeys = [...user.keys]
    .sort((a, b) => b.todayUsage - a.todayUsage || b.totalUsage - a.totalUsage)
    .slice(0, MAX_INLINE_KEYS);

  return (
    <Card className="border bg-card">
      <CardContent className="space-y-2 p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-base sm:text-lg">{user.name}</span>
              <Badge variant={user.role === "admin" ? "default" : "secondary"} className="text-xs">
                {t(`role.${user.role}`)}
              </Badge>
              {user.providerGroup &&
                (() => {
                  const bgColor = getGroupColor(user.providerGroup);
                  return (
                    <Badge
                      className="text-xs"
                      style={{ backgroundColor: bgColor, color: getContrastTextColor(bgColor) }}
                    >
                      {user.providerGroup}
                    </Badge>
                  );
                })()}
            </div>
            {user.note && <p className="text-sm text-muted-foreground line-clamp-2">{user.note}</p>}
          </div>

          <div className="text-right space-y-1">
            <p className="text-xs text-muted-foreground">{t("totalCostAllTime")}</p>
            <p className="text-lg font-semibold">{formatCurrency(user.totalUsage, currencyCode)}</p>
            <p className="text-xs text-muted-foreground">{t("unlimited")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="text-foreground font-medium">{t("keys")}:</span>
          {topKeys.length === 0 && <span className="text-muted-foreground">{t("noKeys")}</span>}
          {topKeys.map((key) => (
            <KeyChip key={key.id} keyData={key} currencyCode={currencyCode} />
          ))}
          {user.keys.length > MAX_INLINE_KEYS && (
            <Badge variant="secondary" className="text-xs">
              +{user.keys.length - MAX_INLINE_KEYS} {t("more")}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
