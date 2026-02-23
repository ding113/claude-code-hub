"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FolderGit2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { reclusterProviderVendors } from "@/actions/providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ReclusterChange = {
  providerId: number;
  providerName: string;
  oldVendorId: number;
  oldVendorDomain: string;
  newVendorDomain: string;
};

type ReclusterResult = {
  preview: {
    providersMoved: number;
    vendorsCreated: number;
    vendorsToDelete: number;
    skippedInvalidUrl: number;
  };
  changes: ReclusterChange[];
  applied: boolean;
};

const MAX_DISPLAY_CHANGES = 10;

export function ReclusterVendorsDialog() {
  const queryClient = useQueryClient();
  const t = useTranslations("settings.providers.recluster");
  const tCommon = useTranslations("settings.common");
  const tErrors = useTranslations("errors");

  const [open, setOpen] = useState(false);
  const [previewData, setPreviewData] = useState<ReclusterResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isApplying, setIsApplying] = useState(false);

  const getActionErrorMessage = (result: {
    errorCode?: string;
    errorParams?: Record<string, string | number>;
    error?: string | null;
  }): string => {
    if (result.errorCode) {
      try {
        return tErrors(result.errorCode, result.errorParams);
      } catch {
        return t("error");
      }
    }

    if (result.error) {
      try {
        return tErrors(result.error);
      } catch {
        return t("error");
      }
    }

    return t("error");
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      // Load preview when dialog opens
      startTransition(async () => {
        try {
          const result = await reclusterProviderVendors({ confirm: false });
          if (result.ok) {
            setPreviewData(result.data);
          } else {
            toast.error(getActionErrorMessage(result));
            setOpen(false);
          }
        } catch (error) {
          console.error("reclusterProviderVendors preview failed", error);
          toast.error(t("error"));
          setOpen(false);
        }
      });
    } else {
      // Clear preview when dialog closes
      setPreviewData(null);
    }
  };

  const handleApply = async () => {
    setIsApplying(true);
    try {
      const result = await reclusterProviderVendors({ confirm: true });
      if (result.ok) {
        toast.success(t("success", { count: result.data.preview.providersMoved }));
        queryClient.invalidateQueries({ queryKey: ["providers"] });
        queryClient.invalidateQueries({ queryKey: ["provider-vendors"] });
        queryClient.invalidateQueries({ queryKey: ["provider-endpoints"] });
        setOpen(false);
      } else {
        toast.error(getActionErrorMessage(result));
      }
    } catch (error) {
      console.error("reclusterProviderVendors apply failed", error);
      toast.error(t("error"));
    } finally {
      setIsApplying(false);
    }
  };

  const hasChanges = previewData && previewData.preview.providersMoved > 0;
  const displayedChanges = previewData?.changes.slice(0, MAX_DISPLAY_CHANGES) ?? [];
  const remainingCount = (previewData?.changes.length ?? 0) - MAX_DISPLAY_CHANGES;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FolderGit2 className="h-4 w-4" />
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] max-h-[80dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {isPending ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : previewData ? (
            <>
              {/* Statistics Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label={t("providersMoved")}
                  value={previewData.preview.providersMoved}
                  highlight={previewData.preview.providersMoved > 0}
                />
                <StatCard label={t("vendorsCreated")} value={previewData.preview.vendorsCreated} />
                <StatCard
                  label={t("vendorsToDelete")}
                  value={previewData.preview.vendorsToDelete}
                />
                <StatCard label={t("skipped")} value={previewData.preview.skippedInvalidUrl} />
              </div>

              {/* No Changes Message */}
              {!hasChanges && (
                <div className="text-sm text-muted-foreground text-center py-4">
                  {t("noChanges")}
                </div>
              )}

              {/* Changes Table */}
              {hasChanges && (
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("providerHeader")}</TableHead>
                        <TableHead>{t("vendorChangeHeader")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedChanges.map((change) => (
                        <TableRow key={change.providerId}>
                          <TableCell>
                            <span className="font-medium">{change.providerName}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge
                                variant="outline"
                                className="font-mono text-xs max-w-[120px] truncate"
                              >
                                {change.oldVendorDomain || "-"}
                              </Badge>
                              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                              <Badge
                                variant="default"
                                className="font-mono text-xs max-w-[120px] truncate"
                              >
                                {change.newVendorDomain}
                              </Badge>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {remainingCount > 0 && (
                    <div className="px-4 py-2 text-sm text-muted-foreground border-t">
                      {t("moreChanges", { count: remainingCount })}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isApplying}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleApply} disabled={isPending || isApplying || !hasChanges}>
            {isApplying && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <div
        className={`text-2xl font-bold tabular-nums ${highlight && value > 0 ? "text-primary" : ""}`}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}
