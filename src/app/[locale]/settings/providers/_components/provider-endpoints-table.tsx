"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Edit2, Loader2, MoreHorizontal, Play, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  addProviderEndpoint,
  editProviderEndpoint,
  getProviderEndpoints,
  getProviderEndpointsByVendor,
  probeProviderEndpoint,
  removeProviderEndpoint,
} from "@/actions/provider-endpoints";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getAllProviderTypes,
  getProviderTypeConfig,
  getProviderTypeTranslationKey,
} from "@/lib/provider-type-utils";
import { getErrorMessage } from "@/lib/utils/error-messages";
import type { ProviderEndpoint, ProviderType } from "@/types/provider";
import { EndpointLatencySparkline } from "./endpoint-latency-sparkline";
import { UrlPreview } from "./forms/url-preview";

// ============================================================================
// Types
// ============================================================================

export interface ProviderEndpointsTableProps {
  /** Vendor ID to fetch endpoints for */
  vendorId: number;
  /** Optional: filter endpoints by providerType. If undefined, shows all types. */
  providerType?: ProviderType;
  /** If true, hides add/edit/delete actions (view-only mode) */
  readOnly?: boolean;
  /** If true, hides the type column (useful when filtering by single type) */
  hideTypeColumn?: boolean;
  /** Custom query key suffix for cache isolation */
  queryKeySuffix?: string;
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Reusable endpoint CRUD table component.
 * Supports filtering by providerType and read-only mode for ProviderForm reuse.
 */
export function ProviderEndpointsTable({
  vendorId,
  providerType,
  readOnly = false,
  hideTypeColumn = false,
  queryKeySuffix,
}: ProviderEndpointsTableProps) {
  const t = useTranslations("settings.providers");
  const tTypes = useTranslations("settings.providers.types");

  // Build query key based on whether we filter by type
  const queryKey = providerType
    ? ["provider-endpoints", vendorId, providerType, queryKeySuffix].filter(
        (value) => value != null
      )
    : ["provider-endpoints", vendorId, queryKeySuffix].filter((value) => value != null);

  const { data: rawEndpoints = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (providerType) {
        return await getProviderEndpoints({ vendorId, providerType });
      }
      return await getProviderEndpointsByVendor({ vendorId });
    },
  });

  // Sort endpoints by type order (from getAllProviderTypes) then by sortOrder
  const endpoints = useMemo(() => {
    const typeOrder = getAllProviderTypes();
    const typeIndexMap = new Map(typeOrder.map((t, i) => [t, i]));

    return [...rawEndpoints].sort((a, b) => {
      const aTypeIndex = typeIndexMap.get(a.providerType) ?? 999;
      const bTypeIndex = typeIndexMap.get(b.providerType) ?? 999;
      if (aTypeIndex !== bTypeIndex) {
        return aTypeIndex - bTypeIndex;
      }
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
  }, [rawEndpoints]);

  if (isLoading) {
    return <div className="text-center py-4 text-sm text-muted-foreground">{t("keyLoading")}</div>;
  }

  if (endpoints.length === 0) {
    return (
      <div className="text-center py-8 border rounded-md border-dashed">
        <p className="text-sm text-muted-foreground">{t("noEndpoints")}</p>
        <p className="text-xs text-muted-foreground mt-1">{t("noEndpointsDesc")}</p>
      </div>
    );
  }

  return (
    <div className="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            {!hideTypeColumn && <TableHead className="w-[60px]">{t("columnType")}</TableHead>}
            <TableHead>{t("columnUrl")}</TableHead>
            <TableHead>{t("status")}</TableHead>
            <TableHead className="w-[220px]">{t("latency")}</TableHead>
            {!readOnly && <TableHead className="text-right">{t("columnActions")}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {endpoints.map((endpoint) => (
            <EndpointRow
              key={endpoint.id}
              endpoint={endpoint}
              tTypes={tTypes}
              readOnly={readOnly}
              hideTypeColumn={hideTypeColumn}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ============================================================================
// EndpointRow
// ============================================================================

function EndpointRow({
  endpoint,
  tTypes,
  readOnly,
  hideTypeColumn,
}: {
  endpoint: ProviderEndpoint;
  tTypes: ReturnType<typeof useTranslations>;
  readOnly: boolean;
  hideTypeColumn: boolean;
}) {
  const t = useTranslations("settings.providers");
  const tCommon = useTranslations("settings.common");
  const queryClient = useQueryClient();
  const [isProbing, setIsProbing] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const typeConfig = getProviderTypeConfig(endpoint.providerType);
  const TypeIcon = typeConfig.icon;
  const typeKey = getProviderTypeTranslationKey(endpoint.providerType);
  const typeLabel = tTypes(`${typeKey}.label`);

  const probeMutation = useMutation({
    mutationFn: async () => {
      const res = await probeProviderEndpoint({ endpointId: endpoint.id });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onMutate: () => setIsProbing(true),
    onSettled: () => setIsProbing(false),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["provider-endpoints"] });
      if (data?.result.ok) {
        toast.success(t("probeSuccess"));
      } else {
        toast.error(
          data?.result.errorMessage
            ? `${t("probeFailed")}: ${data.result.errorMessage}`
            : t("probeFailed")
        );
      }
    },
    onError: () => {
      toast.error(t("probeFailed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await removeProviderEndpoint({ endpointId: endpoint.id });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-endpoints"] });
      queryClient.invalidateQueries({ queryKey: ["provider-vendors"] });
      toast.success(t("endpointDeleteSuccess"));
    },
    onError: () => {
      toast.error(t("endpointDeleteFailed"));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (nextEnabled: boolean) => {
      const res = await editProviderEndpoint({
        endpointId: endpoint.id,
        isEnabled: nextEnabled,
      });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onMutate: () => setIsToggling(true),
    onSettled: () => setIsToggling(false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-endpoints"] });
      toast.success(t("endpointUpdateSuccess"));
    },
    onError: () => {
      toast.error(t("endpointUpdateFailed"));
    },
  });

  return (
    <TableRow>
      {!hideTypeColumn && (
        <TableCell>
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded ${typeConfig.bgColor}`}
                >
                  <TypeIcon className={`h-4 w-4 ${typeConfig.iconColor}`} />
                </span>
              </TooltipTrigger>
              <TooltipContent>{typeLabel}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TableCell>
      )}
      <TableCell className="font-mono text-xs max-w-[200px] truncate" title={endpoint.url}>
        {endpoint.url}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {endpoint.isEnabled ? (
            <Badge
              variant="secondary"
              className="text-green-600 bg-green-500/10 hover:bg-green-500/20"
            >
              {t("enabledStatus")}
            </Badge>
          ) : (
            <Badge variant="outline">{t("disabledStatus")}</Badge>
          )}
          {!readOnly && (
            <Switch
              checked={endpoint.isEnabled}
              onCheckedChange={(checked) => toggleMutation.mutate(checked)}
              disabled={isToggling}
              aria-label={t("enabledStatus")}
            />
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <EndpointLatencySparkline endpointId={endpoint.id} limit={12} />
          {endpoint.lastProbedAt ? (
            <span className="text-muted-foreground text-[10px] whitespace-nowrap">
              {formatDistanceToNow(new Date(endpoint.lastProbedAt), { addSuffix: true })}
            </span>
          ) : (
            <span className="text-muted-foreground text-[10px]">-</span>
          )}
        </div>
      </TableCell>
      {!readOnly && (
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => probeMutation.mutate()}
              disabled={isProbing}
            >
              {isProbing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>

            <EditEndpointDialog endpoint={endpoint} />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => {
                    if (confirm(t("confirmDeleteEndpoint"))) {
                      deleteMutation.mutate();
                    }
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {tCommon("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

// ============================================================================
// AddEndpointButton
// ============================================================================

export interface AddEndpointButtonProps {
  vendorId: number;
  /** If provided, locks the type selector to this value */
  providerType?: ProviderType;
  /** Custom query key suffix for cache invalidation */
  queryKeySuffix?: string;
}

export function AddEndpointButton({
  vendorId,
  providerType: fixedProviderType,
  queryKeySuffix,
}: AddEndpointButtonProps) {
  const t = useTranslations("settings.providers");
  const tErrors = useTranslations("errors");
  const tTypes = useTranslations("settings.providers.types");
  const tCommon = useTranslations("settings.common");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [isEnabled, setIsEnabled] = useState(true);
  const [providerType, setProviderType] = useState<ProviderType>(fixedProviderType ?? "claude");

  const selectableTypes: ProviderType[] = getAllProviderTypes().filter(
    (type) => !["claude-auth", "gemini-cli"].includes(type)
  );

  useEffect(() => {
    if (!open) {
      setUrl("");
      setLabel("");
      setSortOrder(0);
      setIsEnabled(true);
      setProviderType(fixedProviderType ?? "claude");
    }
  }, [open, fixedProviderType]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const endpointUrl = formData.get("url") as string;
    const endpointLabel = formData.get("label") as string;
    const endpointSortOrder = Number.parseInt(formData.get("sortOrder") as string, 10) || 0;

    try {
      const res = await addProviderEndpoint({
        vendorId,
        providerType,
        url: endpointUrl,
        label: endpointLabel.trim() || null,
        sortOrder: endpointSortOrder,
        isEnabled,
      });

      if (res.ok) {
        toast.success(t("endpointAddSuccess"));
        setOpen(false);
        // Invalidate both specific and general queries
        queryClient.invalidateQueries({ queryKey: ["provider-endpoints", vendorId] });
        if (fixedProviderType) {
          queryClient.invalidateQueries({
            queryKey: ["provider-endpoints", vendorId, fixedProviderType, queryKeySuffix].filter(
              (value) => value != null
            ),
          });
        }
      } else {
        toast.error(
          res.errorCode
            ? getErrorMessage(tErrors, res.errorCode, res.errorParams)
            : t("endpointAddFailed")
        );
      }
    } catch (_err) {
      toast.error(t("endpointAddFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const showTypeSelector = !fixedProviderType;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-7 gap-1">
          <Plus className="h-3.5 w-3.5" />
          {t("addEndpoint")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("addEndpoint")}</DialogTitle>
          <DialogDescription>{t("addEndpointDescGeneric")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {showTypeSelector && (
            <div className="space-y-2">
              <Label htmlFor="providerType">{t("columnType")}</Label>
              <Select
                value={providerType}
                onValueChange={(value) => setProviderType(value as ProviderType)}
              >
                <SelectTrigger id="providerType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectableTypes.map((type) => {
                    const typeConfig = getProviderTypeConfig(type);
                    const TypeIcon = typeConfig.icon;
                    const typeKey = getProviderTypeTranslationKey(type);
                    const label = tTypes(`${typeKey}.label`);
                    return (
                      <SelectItem key={type} value={type}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex h-5 w-5 items-center justify-center rounded ${typeConfig.bgColor}`}
                          >
                            <TypeIcon className={`h-3.5 w-3.5 ${typeConfig.iconColor}`} />
                          </span>
                          {label}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="url">{t("endpointUrlLabel")}</Label>
            <Input
              id="url"
              name="url"
              placeholder={t("endpointUrlPlaceholder")}
              required
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="label">{t("endpointLabelOptional")}</Label>
            <Input
              id="label"
              name="label"
              placeholder={t("endpointLabelPlaceholder")}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sortOrder">{t("sortOrder")}</Label>
              <Input
                id="sortOrder"
                name="sortOrder"
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(Number.parseInt(e.target.value, 10) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("enabledStatus")}</Label>
              <div className="flex items-center h-9">
                <Switch id="isEnabled" checked={isEnabled} onCheckedChange={setIsEnabled} />
              </div>
            </div>
          </div>

          <UrlPreview baseUrl={url} providerType={providerType} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tCommon("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// EditEndpointDialog
// ============================================================================

function EditEndpointDialog({ endpoint }: { endpoint: ProviderEndpoint }) {
  const t = useTranslations("settings.providers");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("settings.common");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEnabled, setIsEnabled] = useState(endpoint.isEnabled);

  useEffect(() => {
    if (open) {
      setIsEnabled(endpoint.isEnabled);
    }
  }, [open, endpoint.isEnabled]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const url = formData.get("url") as string;
    const label = formData.get("label") as string;
    const sortOrder = Number.parseInt(formData.get("sortOrder") as string, 10) || 0;

    try {
      const res = await editProviderEndpoint({
        endpointId: endpoint.id,
        url,
        label: label.trim() || null,
        sortOrder,
        isEnabled,
      });

      if (res.ok) {
        toast.success(t("endpointUpdateSuccess"));
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: ["provider-endpoints"] });
      } else {
        toast.error(
          res.errorCode
            ? getErrorMessage(tErrors, res.errorCode, res.errorParams)
            : t("endpointUpdateFailed")
        );
      }
    } catch (_err) {
      toast.error(t("endpointUpdateFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Edit2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("editEndpoint")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url">{t("endpointUrlLabel")}</Label>
            <Input id="url" name="url" defaultValue={endpoint.url} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label">{t("endpointLabelOptional")}</Label>
            <Input
              id="label"
              name="label"
              placeholder={t("endpointLabelPlaceholder")}
              defaultValue={endpoint.label ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sortOrder">{t("sortOrder")}</Label>
              <Input
                id="sortOrder"
                name="sortOrder"
                type="number"
                min={0}
                defaultValue={endpoint.sortOrder ?? 0}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("enabledStatus")}</Label>
              <div className="flex items-center h-9">
                <Switch id="isEnabled" checked={isEnabled} onCheckedChange={setIsEnabled} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tCommon("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// ProviderEndpointsSection (convenience wrapper)
// ============================================================================

export interface ProviderEndpointsSectionProps {
  vendorId: number;
  providerType?: ProviderType;
  readOnly?: boolean;
  hideTypeColumn?: boolean;
  queryKeySuffix?: string;
}

/**
 * Section wrapper that includes header with Add button and the table.
 * Use this for full section rendering (like in VendorCard).
 */
export function ProviderEndpointsSection({
  vendorId,
  providerType,
  readOnly = false,
  hideTypeColumn = false,
  queryKeySuffix,
}: ProviderEndpointsSectionProps) {
  const t = useTranslations("settings.providers");

  return (
    <div>
      <div className="px-6 py-3 bg-muted/10 border-b font-medium text-sm text-muted-foreground flex items-center justify-between">
        <span>{t("endpoints")}</span>
        {!readOnly && (
          <AddEndpointButton
            vendorId={vendorId}
            providerType={providerType}
            queryKeySuffix={queryKeySuffix}
          />
        )}
      </div>

      <div className="p-6">
        <ProviderEndpointsTable
          vendorId={vendorId}
          providerType={providerType}
          readOnly={readOnly}
          hideTypeColumn={hideTypeColumn}
          queryKeySuffix={queryKeySuffix}
        />
      </div>
    </div>
  );
}
