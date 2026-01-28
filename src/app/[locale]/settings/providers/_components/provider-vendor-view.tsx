"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Edit2,
  ExternalLink,
  InfoIcon,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  addProviderEndpoint,
  editProviderEndpoint,
  getProviderEndpointsByVendor,
  getProviderVendors,
  probeProviderEndpoint,
  removeProviderEndpoint,
  removeProviderVendor,
} from "@/actions/provider-endpoints";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { CurrencyCode } from "@/lib/utils/currency";
import { getErrorMessage } from "@/lib/utils/error-messages";
import type {
  ProviderDisplay,
  ProviderEndpoint,
  ProviderType,
  ProviderVendor,
} from "@/types/provider";
import type { User } from "@/types/user";
import { EndpointLatencySparkline } from "./endpoint-latency-sparkline";
import { UrlPreview } from "./forms/url-preview";
import { VendorKeysCompactList } from "./vendor-keys-compact-list";

interface ProviderVendorViewProps {
  providers: ProviderDisplay[];
  currentUser?: User;
  enableMultiProviderTypes: boolean;
  healthStatus: Record<number, any>;
  statistics: Record<number, any>;
  statisticsLoading: boolean;
  currencyCode: CurrencyCode;
}

export function ProviderVendorView(props: ProviderVendorViewProps) {
  const {
    providers,
    currentUser,
    enableMultiProviderTypes,
    statistics,
    statisticsLoading,
    currencyCode,
  } = props;

  const { data: vendors = [], isLoading: isVendorsLoading } = useQuery({
    queryKey: ["provider-vendors"],
    queryFn: async () => await getProviderVendors(),
    staleTime: 60000,
  });

  const providersByVendor = useMemo(() => {
    const grouped: Record<number, ProviderDisplay[]> = {};
    const orphaned: ProviderDisplay[] = [];

    providers.forEach((p) => {
      const vendorId = p.providerVendorId;
      if (!vendorId || vendorId <= 0) {
        orphaned.push(p);
      } else {
        if (!grouped[vendorId]) {
          grouped[vendorId] = [];
        }
        grouped[vendorId].push(p);
      }
    });

    if (orphaned.length > 0) {
      grouped[-1] = orphaned;
    }

    return grouped;
  }, [providers]);

  const allVendorIds = useMemo(() => {
    const ids = new Set<number>(vendors.map((v) => v.id));
    Object.keys(providersByVendor).forEach((id) => ids.add(Number(id)));
    return Array.from(ids).sort((a, b) => a - b);
  }, [vendors, providersByVendor]);

  if (isVendorsLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {allVendorIds.map((vendorId) => {
        const vendor = vendors.find((v) => v.id === vendorId);
        const vendorProviders = providersByVendor[vendorId] || [];

        if (vendorProviders.length === 0) return null;

        return (
          <VendorCard
            key={vendorId}
            vendor={vendor}
            vendorId={vendorId}
            providers={vendorProviders}
            currentUser={currentUser}
            enableMultiProviderTypes={enableMultiProviderTypes}
            statistics={statistics}
            statisticsLoading={statisticsLoading}
            currencyCode={currencyCode}
          />
        );
      })}
    </div>
  );
}

function VendorCard({
  vendor,
  vendorId,
  providers,
  currentUser,
  enableMultiProviderTypes,
  statistics,
  statisticsLoading,
  currencyCode,
}: {
  vendor?: ProviderVendor;
  vendorId: number;
  providers: ProviderDisplay[];
  currentUser?: User;
  enableMultiProviderTypes: boolean;
  statistics: Record<number, any>;
  statisticsLoading: boolean;
  currencyCode: CurrencyCode;
}) {
  const t = useTranslations("settings.providers");

  const displayName =
    vendorId === -1
      ? t("orphanedProviders")
      : vendor?.displayName || vendor?.websiteDomain || t("vendorFallbackName", { id: vendorId });
  const websiteUrl = vendor?.websiteUrl;
  const faviconUrl = vendor?.faviconUrl;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-muted/30 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 border bg-background">
              <AvatarImage src={faviconUrl || ""} />
              <AvatarFallback>{displayName.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle className="flex items-center gap-2">
                {displayName}
                {vendorId > 0 && (
                  <TooltipProvider>
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("vendorAggregationRule")}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {websiteUrl && (
                  <a
                    href={websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </CardTitle>
              <CardDescription>
                {providers.length} {t("vendorKeys")}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {vendorId > 0 && <DeleteVendorDialog vendor={vendor} vendorId={vendorId} />}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <VendorKeysCompactList
          vendorId={vendorId}
          vendorWebsiteDomain={vendor?.websiteDomain ?? ""}
          vendorWebsiteUrl={vendor?.websiteUrl ?? null}
          providers={providers}
          currentUser={currentUser}
          enableMultiProviderTypes={enableMultiProviderTypes}
          statistics={statistics}
          statisticsLoading={statisticsLoading}
          currencyCode={currencyCode}
        />

        {enableMultiProviderTypes && vendorId > 0 && <VendorEndpointsSection vendorId={vendorId} />}
      </CardContent>
    </Card>
  );
}

function VendorEndpointsSection({ vendorId }: { vendorId: number }) {
  const t = useTranslations("settings.providers");

  return (
    <div>
      <div className="px-6 py-3 bg-muted/10 border-b font-medium text-sm text-muted-foreground flex items-center justify-between">
        <span>{t("endpoints")}</span>
        <AddEndpointButton vendorId={vendorId} />
      </div>

      <div className="p-6">
        <EndpointsTable vendorId={vendorId} />
      </div>
    </div>
  );
}

function EndpointsTable({ vendorId }: { vendorId: number }) {
  const t = useTranslations("settings.providers");
  const tTypes = useTranslations("settings.providers.types");

  const { data: rawEndpoints = [], isLoading } = useQuery({
    queryKey: ["provider-endpoints", vendorId],
    queryFn: async () => {
      const endpoints = await getProviderEndpointsByVendor({ vendorId });
      return endpoints;
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
            <TableHead className="w-[60px]">{t("columnType")}</TableHead>
            <TableHead>{t("columnUrl")}</TableHead>
            <TableHead>{t("status")}</TableHead>
            <TableHead className="w-[220px]">{t("latency")}</TableHead>
            <TableHead className="text-right">{t("columnActions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {endpoints.map((endpoint) => (
            <EndpointRow key={endpoint.id} endpoint={endpoint} tTypes={tTypes} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EndpointRow({
  endpoint,
  tTypes,
}: {
  endpoint: ProviderEndpoint;
  tTypes: ReturnType<typeof useTranslations>;
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
          <Switch
            checked={endpoint.isEnabled}
            onCheckedChange={(checked) => toggleMutation.mutate(checked)}
            disabled={isToggling}
            aria-label={t("enabledStatus")}
          />
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
    </TableRow>
  );
}

function AddEndpointButton({ vendorId }: { vendorId: number }) {
  const t = useTranslations("settings.providers");
  const tTypes = useTranslations("settings.providers.types");
  const tCommon = useTranslations("settings.common");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [url, setUrl] = useState("");
  const [providerType, setProviderType] = useState<ProviderType>("claude");

  // Get provider types for the selector (exclude claude-auth and gemini-cli which are internal)
  const selectableTypes: ProviderType[] = ["claude", "codex", "gemini", "openai-compatible"];

  useEffect(() => {
    if (!open) {
      setUrl("");
      setProviderType("claude");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const endpointUrl = formData.get("url") as string;

    try {
      const res = await addProviderEndpoint({
        vendorId,
        providerType,
        url: endpointUrl,
        label: null,
        sortOrder: 0,
        isEnabled: true,
      });

      if (res.ok) {
        toast.success(t("endpointAddSuccess"));
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: ["provider-endpoints", vendorId] });
      } else {
        toast.error(res.error || t("endpointAddFailed"));
      }
    } catch (_err) {
      toast.error(t("endpointAddFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

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

function EditEndpointDialog({ endpoint }: { endpoint: ProviderEndpoint }) {
  const t = useTranslations("settings.providers");
  const tCommon = useTranslations("settings.common");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const url = formData.get("url") as string;
    const isEnabled = formData.get("isEnabled") === "on";

    try {
      const res = await editProviderEndpoint({
        endpointId: endpoint.id,
        url,
        isEnabled,
      });

      if (res.ok) {
        toast.success(t("endpointUpdateSuccess"));
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: ["provider-endpoints"] });
      } else {
        toast.error(res.error || t("endpointUpdateFailed"));
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
          <div className="flex items-center space-x-2">
            <Switch id="isEnabled" name="isEnabled" defaultChecked={endpoint.isEnabled} />
            <Label htmlFor="isEnabled">{t("enabledStatus")}</Label>
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

function DeleteVendorDialog({ vendor, vendorId }: { vendor?: ProviderVendor; vendorId: number }) {
  const t = useTranslations("settings.providers");
  const tCommon = useTranslations("settings.common");
  const tErrors = useTranslations("errors");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"confirm" | "double-confirm">("confirm");
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await removeProviderVendor({ vendorId });

      if (res.ok) {
        toast.success(t("vendorDeleteSuccess"));
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: ["provider-vendors"] });
      } else {
        toast.error(
          res.errorCode ? getErrorMessage(tErrors, res.errorCode) : t("vendorDeleteFailed")
        );
      }
    } catch (_err) {
      toast.error(t("vendorDeleteFailed"));
    } finally {
      setIsDeleting(false);
    }
  };

  const displayName = vendor?.displayName || t("vendorFallbackName", { id: vendorId });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) setStep("confirm");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {step === "confirm"
              ? t("deleteVendorConfirmTitle")
              : t("deleteVendorDoubleConfirmTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {step === "confirm"
              ? t("deleteVendorConfirmDesc", { name: displayName })
              : t("deleteVendorDoubleConfirmDesc", { name: displayName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{tCommon("cancel")}</AlertDialogCancel>
          {step === "confirm" ? (
            <Button variant="destructive" onClick={() => setStep("double-confirm")}>
              {t("deleteVendor")}
            </Button>
          ) : (
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tCommon("confirm")}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
