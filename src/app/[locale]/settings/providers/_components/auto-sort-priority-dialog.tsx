"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ListOrdered, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { autoSortProviderPriority } from "@/actions/providers";
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

type AutoSortResult = {
  groups: Array<{
    costMultiplier: number;
    priority: number;
    providers: Array<{ id: number; name: string }>;
  }>;
  changes: Array<{
    providerId: number;
    name: string;
    oldPriority: number;
    newPriority: number;
    costMultiplier: number;
  }>;
  summary: {
    totalProviders: number;
    changedCount: number;
    groupCount: number;
  };
  applied: boolean;
};

export function AutoSortPriorityDialog() {
  const queryClient = useQueryClient();
  const t = useTranslations("settings.providers.autoSort");
  const tCommon = useTranslations("settings.common");
  const tErrors = useTranslations("errors");

  const [open, setOpen] = useState(false);
  const [previewData, setPreviewData] = useState<AutoSortResult | null>(null);
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
          const result = await autoSortProviderPriority({ confirm: false });
          if (result.ok) {
            setPreviewData(result.data);
          } else {
            toast.error(getActionErrorMessage(result));
            setOpen(false);
          }
        } catch (error) {
          console.error("autoSortProviderPriority preview failed", error);
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
      const result = await autoSortProviderPriority({ confirm: true });
      if (result.ok) {
        toast.success(t("success", { count: result.data.summary.changedCount }));
        queryClient.invalidateQueries({ queryKey: ["providers"] });
        setOpen(false);
      } else {
        toast.error(getActionErrorMessage(result));
      }
    } catch (error) {
      console.error("autoSortProviderPriority apply failed", error);
      toast.error(t("error"));
    } finally {
      setIsApplying(false);
    }
  };

  const hasChanges = previewData && previewData.summary.changedCount > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ListOrdered className="h-4 w-4" />
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
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
              {/* Summary */}
              <div className="text-sm text-muted-foreground">
                {hasChanges
                  ? t("changeCount", { count: previewData.summary.changedCount })
                  : t("noChanges")}
              </div>

              {/* Groups Preview Table */}
              {previewData.groups.length > 0 && (
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[140px]">{t("costMultiplierHeader")}</TableHead>
                        <TableHead className="w-[100px]">{t("priorityHeader")}</TableHead>
                        <TableHead>{t("providersHeader")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.groups.map((group) => (
                        <TableRow key={group.costMultiplier}>
                          <TableCell className="font-mono">{group.costMultiplier}x</TableCell>
                          <TableCell>
                            <Badge variant="outline">{group.priority}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {group.providers.map((provider) => (
                                <Badge key={provider.id} variant="secondary">
                                  {provider.name}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Changes Detail */}
              {hasChanges && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">{t("changesTitle")}</h4>
                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("providerHeader")}</TableHead>
                          <TableHead className="w-[180px] text-center">
                            {t("priorityChangeHeader")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewData.changes.map((change) => (
                          <TableRow key={change.providerId}>
                            <TableCell>
                              <span className="font-medium">{change.name}</span>
                              <span className="text-muted-foreground text-xs ml-2">
                                ({change.costMultiplier}x)
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-center gap-2">
                                <Badge variant="outline" className="font-mono">
                                  {change.oldPriority}
                                </Badge>
                                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                <Badge variant="default" className="font-mono">
                                  {change.newPriority}
                                </Badge>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
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
