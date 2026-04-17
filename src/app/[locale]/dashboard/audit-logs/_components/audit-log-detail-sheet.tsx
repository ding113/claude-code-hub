"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { IpDetailsDialog } from "@/app/[locale]/dashboard/_components/ip-details-dialog";
import { Badge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AuditLogRow } from "@/types/audit-log";

interface AuditLogDetailSheetProps {
  log: AuditLogRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 items-start gap-2 py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="col-span-2 text-sm font-medium break-all">{children}</div>
    </div>
  );
}

export function AuditLogDetailSheet({ log, open, onOpenChange }: AuditLogDetailSheetProps) {
  const t = useTranslations("auditLogs");
  const [ipDialogOpen, setIpDialogOpen] = useState(false);
  const [ipDialogValue, setIpDialogValue] = useState<string | null>(null);

  if (!log) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-[95vw] sm:w-[540px] md:w-[640px] lg:w-[720px] sm:max-w-none overflow-y-auto px-4 sm:px-6"
        >
          <SheetHeader className="pb-2">
            <SheetTitle>{t("detail.title")}</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  const beforeText = formatJson(log.beforeValue);
  const afterText = formatJson(log.afterValue);

  const operatorName = log.operatorUserName ?? t("adminTokenOperator");

  const categoryLabel = (() => {
    const key = `categories.${log.actionCategory}` as const;
    try {
      return t(key);
    } catch {
      return log.actionCategory;
    }
  })();

  const openIpDialog = (ip: string) => {
    setIpDialogValue(ip);
    setIpDialogOpen(true);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-[95vw] sm:w-[540px] md:w-[640px] lg:w-[720px] sm:max-w-none overflow-y-auto px-4 sm:px-6"
        >
          <SheetHeader className="pb-2">
            <SheetTitle>{t("detail.title")}</SheetTitle>
          </SheetHeader>

          <div className="space-y-4 pb-8">
            <div>
              <Row label={t("columns.time")}>
                <RelativeTime date={log.createdAt} fallback="-" format="full" />
              </Row>
              <Row label={t("columns.category")}>
                <Badge variant="outline">{categoryLabel}</Badge>
              </Row>
              <Row label={t("columns.action")}>
                <span className="font-mono text-xs">{log.actionType}</span>
              </Row>
              <Row label={t("columns.status")}>
                {log.success ? (
                  <Badge
                    variant="outline"
                    className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800"
                  >
                    {t("filters.succeeded")}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800"
                  >
                    {t("filters.failed")}
                  </Badge>
                )}
              </Row>
            </div>

            <Separator />

            <div>
              <Row label={t("columns.target")}>
                <div className="space-y-0.5">
                  {log.targetType && (
                    <div className="text-xs text-muted-foreground font-mono">{log.targetType}</div>
                  )}
                  <div>{log.targetName ?? "—"}</div>
                  {log.targetId && (
                    <div className="text-xs text-muted-foreground font-mono">
                      {t("detail.targetIdLabel", { id: log.targetId })}
                    </div>
                  )}
                </div>
              </Row>
            </div>

            <Separator />

            <div>
              <Row label={t("columns.operator")}>
                <div className="space-y-0.5">
                  <div>{operatorName}</div>
                  {log.operatorKeyName && (
                    <div className="text-xs text-muted-foreground font-mono">
                      {t("detail.keyLabel", { name: log.operatorKeyName })}
                    </div>
                  )}
                  {log.operatorUserId != null && (
                    <div className="text-xs text-muted-foreground font-mono">
                      {t("detail.userIdLabel", { id: log.operatorUserId })}
                    </div>
                  )}
                </div>
              </Row>

              <Row label={t("columns.ip")}>
                {log.operatorIp ? (
                  <button
                    type="button"
                    className="font-mono text-sm underline decoration-dotted hover:decoration-solid"
                    onClick={() => openIpDialog(log.operatorIp as string)}
                  >
                    {log.operatorIp}
                  </button>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Row>

              <Row label={t("detail.userAgent")}>
                {log.userAgent ? (
                  <span className="font-mono text-xs break-all">{log.userAgent}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Row>
            </div>

            {log.errorMessage && (
              <>
                <Separator />
                <div>
                  <div className="text-sm font-semibold mb-2">{t("detail.errorMessage")}</div>
                  <pre className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md p-3 text-xs text-red-800 dark:text-red-200 whitespace-pre-wrap break-all">
                    {log.errorMessage}
                  </pre>
                </div>
              </>
            )}

            <Separator />

            <div>
              <div className="text-sm font-semibold mb-2">{t("detail.before")}</div>
              {beforeText ? (
                <pre className="bg-muted/50 border rounded-md p-3 text-xs whitespace-pre-wrap break-all overflow-x-auto">
                  {beforeText}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground">{t("detail.noChange")}</p>
              )}
            </div>

            <div>
              <div className="text-sm font-semibold mb-2">{t("detail.after")}</div>
              {afterText ? (
                <pre className="bg-muted/50 border rounded-md p-3 text-xs whitespace-pre-wrap break-all overflow-x-auto">
                  {afterText}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground">{t("detail.noChange")}</p>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <IpDetailsDialog ip={ipDialogValue} open={ipDialogOpen} onOpenChange={setIpDialogOpen} />
    </>
  );
}
