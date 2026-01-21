"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Copy, Edit2, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getProviderEndpoints } from "@/actions/provider-endpoints";
import { editProvider, getUnmaskedProviderKey, removeProvider } from "@/actions/providers";
import { FormErrorBoundary } from "@/components/form-error-boundary";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PROVIDER_LIMITS } from "@/lib/constants/provider.constants";
import { getProviderTypeConfig, getProviderTypeTranslationKey } from "@/lib/provider-type-utils";
import { copyToClipboard, isClipboardSupported } from "@/lib/utils/clipboard";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import type { ProviderDisplay, ProviderStatisticsMap, ProviderType } from "@/types/provider";
import type { User } from "@/types/user";
import { ProviderForm } from "./forms/provider-form";
import { InlineEditPopover } from "./inline-edit-popover";

function buildDefaultProviderName(input: {
  vendorWebsiteDomain: string;
  providerType: ProviderType;
}): string {
  const base = input.vendorWebsiteDomain.trim() || "vendor";
  return `${base}-${input.providerType}`.slice(0, 64);
}

export function VendorKeysCompactList(props: {
  vendorId: number;
  vendorWebsiteDomain: string;
  vendorWebsiteUrl?: string | null;
  providers: ProviderDisplay[];
  currentUser?: User;
  enableMultiProviderTypes: boolean;
  statistics?: ProviderStatisticsMap;
  statisticsLoading?: boolean;
  currencyCode?: CurrencyCode;
}) {
  const t = useTranslations("settings.providers");
  const tForm = useTranslations("settings.providers.form");
  const tList = useTranslations("settings.providers.list");

  const canEdit = props.currentUser?.role === "admin";

  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);

  const defaultProviderType: ProviderType = props.providers[0]?.providerType ?? "claude";
  const vendorAllowedTypes: ProviderType[] = ["claude", "codex", "gemini", "openai-compatible"];
  const statistics = props.statistics ?? {};
  const statisticsLoading = props.statisticsLoading ?? false;
  const currencyCode = props.currencyCode ?? "USD";

  return (
    <div className="border-b">
      <div className="px-6 py-1.5 bg-muted/10 font-medium text-sm text-muted-foreground flex items-center justify-between">
        <span>{t("vendorKeys")}</span>
        {canEdit ? (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-7 gap-1">
                <Plus className="h-3.5 w-3.5" />
                {t("addVendorKey")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-full sm:max-w-5xl lg:max-w-6xl max-h-[90vh] flex flex-col">
              <FormErrorBoundary>
                <ProviderForm
                  mode="create"
                  enableMultiProviderTypes={props.enableMultiProviderTypes}
                  hideUrl
                  hideWebsiteUrl
                  allowedProviderTypes={vendorAllowedTypes}
                  preset={{
                    name: buildDefaultProviderName({
                      vendorWebsiteDomain: props.vendorWebsiteDomain,
                      providerType: defaultProviderType,
                    }),
                    providerType: defaultProviderType,
                    websiteUrl: props.vendorWebsiteUrl ?? "",
                  }}
                  urlResolver={async (type) => {
                    if (props.vendorId <= 0) return null;
                    const endpoints = await getProviderEndpoints({
                      vendorId: props.vendorId,
                      providerType: type,
                    });
                    const enabled = endpoints.find((e) => e.isEnabled);
                    return (enabled ?? endpoints[0])?.url ?? null;
                  }}
                  onSuccess={() => {
                    setCreateOpen(false);
                    queryClient.invalidateQueries({ queryKey: ["providers"] });
                    queryClient.invalidateQueries({ queryKey: ["provider-vendors"] });
                  }}
                />
              </FormErrorBoundary>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {props.providers.length === 0 ? (
        <div className="px-6 py-6 text-center text-sm text-muted-foreground">
          {t("noProviders")}
        </div>
      ) : (
        <div className="px-6 py-1">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-7 w-10">
                  <span className="sr-only">{tForm("providerType")}</span>
                </TableHead>
                <TableHead className="h-7 min-w-[140px]">{tForm("name.label")}</TableHead>
                <TableHead className="h-7">{tForm("key.label")}</TableHead>
                <TableHead className="hidden md:table-cell h-7 w-[90px] text-right">
                  {tList("priority")}
                </TableHead>
                <TableHead className="hidden md:table-cell h-7 w-[90px] text-right">
                  {tList("weight")}
                </TableHead>
                <TableHead className="hidden md:table-cell h-7 w-[110px] text-right">
                  {tList("costMultiplier")}
                </TableHead>
                <TableHead className="hidden lg:table-cell h-7 w-[140px] text-right">
                  {tList("todayUsageLabel")}
                </TableHead>
                <TableHead className="h-7 w-[140px] text-right">{t("columnActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.providers.map((provider) => (
                <VendorKeyRow
                  key={provider.id}
                  provider={provider}
                  canEdit={canEdit}
                  statistics={statistics[provider.id]}
                  statisticsLoading={statisticsLoading}
                  currencyCode={currencyCode}
                  allowedProviderTypes={vendorAllowedTypes}
                  enableMultiProviderTypes={props.enableMultiProviderTypes}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function VendorKeyRow(props: {
  provider: ProviderDisplay;
  canEdit: boolean;
  statistics?: {
    todayCost: string;
    todayCalls: number;
    lastCallTime: string | null;
    lastCallModel: string | null;
  };
  statisticsLoading: boolean;
  currencyCode: CurrencyCode;
  allowedProviderTypes: ProviderType[];
  enableMultiProviderTypes: boolean;
}) {
  const t = useTranslations("settings.providers");
  const tList = useTranslations("settings.providers.list");
  const tInline = useTranslations("settings.providers.inlineEdit");
  const tTypes = useTranslations("settings.providers.types");

  const queryClient = useQueryClient();
  const router = useRouter();

  const validatePriority = (raw: string) => {
    if (raw.length === 0) return tInline("priorityInvalid");
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 2147483647)
      return tInline("priorityInvalid");
    return null;
  };

  const validateWeight = (raw: string) => {
    if (raw.length === 0) return tInline("weightInvalid");
    const value = Number(raw);
    if (
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < PROVIDER_LIMITS.WEIGHT.MIN ||
      value > PROVIDER_LIMITS.WEIGHT.MAX
    )
      return tInline("weightInvalid");
    return null;
  };

  const validateCostMultiplier = (raw: string) => {
    if (raw.length === 0) return tInline("costMultiplierInvalid");
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return tInline("costMultiplierInvalid");
    return null;
  };

  const createSaveHandler = (fieldName: "priority" | "weight" | "cost_multiplier") => {
    return async (value: number) => {
      try {
        const res = await editProvider(props.provider.id, { [fieldName]: value });
        if (res.ok) {
          toast.success(tInline("saveSuccess"));
          queryClient.invalidateQueries({ queryKey: ["providers"] });
          queryClient.invalidateQueries({ queryKey: ["provider-vendors"] });
          router.refresh();
          return true;
        }
        toast.error(tInline("saveFailed"), { description: res.error || tList("unknownError") });
        return false;
      } catch (error) {
        console.error(`Failed to update ${fieldName}:`, error);
        toast.error(tInline("saveFailed"), { description: tList("unknownError") });
        return false;
      }
    };
  };

  const handleSavePriority = createSaveHandler("priority");
  const handleSaveWeight = createSaveHandler("weight");
  const handleSaveCostMultiplier = createSaveHandler("cost_multiplier");

  const typeConfig = getProviderTypeConfig(props.provider.providerType);
  const TypeIcon = typeConfig.icon;
  const typeLabel = tTypes(`${getProviderTypeTranslationKey(props.provider.providerType)}.label`);

  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [unmaskedKey, setUnmaskedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clipboardAvailable, setClipboardAvailable] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    setClipboardAvailable(isClipboardSupported());
  }, []);

  const toggleMutation = useMutation({
    mutationFn: async (checked: boolean) => {
      const res = await editProvider(props.provider.id, { is_enabled: checked });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-vendors"] });
      router.refresh();
    },
    onError: () => {
      toast.error(t("toggleFailed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await removeProvider(props.provider.id);
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-vendors"] });
      setDeleteDialogOpen(false);
      toast.success(tList("deleteSuccess"), {
        description: tList("deleteSuccessDesc", { name: props.provider.name }),
      });
      router.refresh();
    },
    onError: () => {
      toast.error(tList("deleteFailed"));
    },
  });

  const handleShowKey = async () => {
    setKeyDialogOpen(true);
    setUnmaskedKey(null);
    setCopied(false);
    try {
      const result = await getUnmaskedProviderKey(props.provider.id);
      if (result.ok) {
        setUnmaskedKey(result.data.key);
      } else {
        toast.error(tList("getKeyFailed"), {
          description: result.error || tList("unknownError"),
        });
        setKeyDialogOpen(false);
      }
    } catch {
      toast.error(tList("getKeyFailed"));
      setKeyDialogOpen(false);
    }
  };

  const handleCopy = async () => {
    if (!unmaskedKey) return;

    const success = await copyToClipboard(unmaskedKey);
    if (!success) {
      toast.error(tList("copyFailed"));
      return;
    }

    setCopied(true);
    toast.success(tList("keyCopied"));
    setTimeout(() => setCopied(false), 3000);
  };

  const handleCloseDialog = () => {
    setKeyDialogOpen(false);
    setUnmaskedKey(null);
    setCopied(false);
  };

  return (
    <>
      <TableRow className="h-8 group">
        <TableCell className="py-1">
          <div className="flex items-center gap-2">
            <div
              className={`h-6 w-6 rounded-md flex items-center justify-center ${typeConfig.bgColor}`}
              title={typeLabel}
            >
              <TypeIcon className={`h-4 w-4 ${typeConfig.iconColor}`} />
            </div>
            <span className="text-sm font-medium">{typeLabel}</span>
          </div>
        </TableCell>
        <TableCell className="py-1 min-w-0">
          <div className="text-sm font-medium truncate" title={props.provider.name}>
            {props.provider.name}
          </div>
        </TableCell>
        <TableCell className="py-1">
          {props.canEdit ? (
            <button
              type="button"
              className="font-mono text-xs text-muted-foreground hover:text-foreground"
              onClick={handleShowKey}
            >
              {props.provider.maskedKey}
            </button>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              {props.provider.maskedKey}
            </span>
          )}
        </TableCell>
        <TableCell className="hidden md:table-cell py-1 text-right text-sm tabular-nums">
          {props.canEdit ? (
            <InlineEditPopover
              value={props.provider.priority}
              label={tInline("priorityLabel")}
              type="integer"
              validator={validatePriority}
              onSave={handleSavePriority}
            />
          ) : (
            <span className="text-xs">{props.provider.priority}</span>
          )}
        </TableCell>
        <TableCell className="hidden md:table-cell py-1 text-right text-sm tabular-nums">
          {props.canEdit ? (
            <InlineEditPopover
              value={props.provider.weight}
              label={tInline("weightLabel")}
              type="integer"
              validator={validateWeight}
              onSave={handleSaveWeight}
            />
          ) : (
            <span className="text-xs">{props.provider.weight}</span>
          )}
        </TableCell>
        <TableCell className="hidden md:table-cell py-1 text-right text-sm tabular-nums">
          {props.canEdit ? (
            <InlineEditPopover
              value={props.provider.costMultiplier}
              label={tInline("costMultiplierLabel")}
              validator={validateCostMultiplier}
              onSave={handleSaveCostMultiplier}
              suffix="x"
              type="number"
            />
          ) : (
            <span className="text-xs">{props.provider.costMultiplier}x</span>
          )}
        </TableCell>
        <TableCell className="hidden lg:table-cell py-1 text-right">
          {props.statisticsLoading ? (
            <span className="text-xs text-muted-foreground">{tList("keyLoading")}</span>
          ) : (
            <div className="flex flex-col items-end">
              <span className="text-xs tabular-nums">
                {tList("todayUsageCount", {
                  count: props.statistics?.todayCalls ?? props.provider.todayCallCount ?? 0,
                })}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                {formatCurrency(
                  parseFloat(
                    props.statistics?.todayCost ?? props.provider.todayTotalCostUsd ?? "0"
                  ),
                  props.currencyCode
                )}
              </span>
            </div>
          )}
        </TableCell>
        <TableCell className="py-1 text-right">
          <div className="flex items-center justify-end gap-2">
            {props.canEdit ? (
              <Dialog open={editOpen} onOpenChange={setEditOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={t("editProvider")}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-full sm:max-w-5xl lg:max-w-6xl max-h-[90vh] flex flex-col">
                  <FormErrorBoundary>
                    <ProviderForm
                      mode="edit"
                      provider={props.provider}
                      enableMultiProviderTypes={props.enableMultiProviderTypes}
                      hideUrl
                      hideWebsiteUrl
                      allowedProviderTypes={
                        props.allowedProviderTypes.includes(props.provider.providerType)
                          ? props.allowedProviderTypes
                          : [...props.allowedProviderTypes, props.provider.providerType]
                      }
                      onSuccess={() => {
                        setEditOpen(false);
                        queryClient.invalidateQueries({ queryKey: ["providers"] });
                        queryClient.invalidateQueries({ queryKey: ["provider-vendors"] });
                        router.refresh();
                      }}
                    />
                  </FormErrorBoundary>
                </DialogContent>
              </Dialog>
            ) : null}
            {props.canEdit && (
              <Switch
                checked={props.provider.isEnabled}
                onCheckedChange={(checked) => toggleMutation.mutate(checked)}
                className="scale-75 data-[state=checked]:bg-green-500"
              />
            )}
            {props.canEdit && (
              <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{tList("confirmDeleteTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {tList("confirmDeleteMessage", { name: props.provider.name })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleteMutation.isPending}>
                      {tList("cancelButton")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      disabled={deleteMutation.isPending}
                      onClick={(e) => {
                        e.preventDefault();
                        deleteMutation.mutate();
                      }}
                    >
                      {deleteMutation.isPending && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {tList("deleteButton")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </TableCell>
      </TableRow>

      <Dialog
        open={keyDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tList("viewFullKey")}</DialogTitle>
            <DialogDescription>{tList("viewFullKeyDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono bg-muted px-3 py-2 rounded text-sm break-all">
                {unmaskedKey || tList("keyLoading")}
              </code>
              {clipboardAvailable && (
                <Button onClick={handleCopy} disabled={!unmaskedKey} size="icon" variant="outline">
                  {copied ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
            {!clipboardAvailable && (
              <p className="text-xs text-muted-foreground">{tList("clipboardUnavailable")}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
