"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  Edit2,
  ExternalLink,
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
  getProviderEndpoints,
  getProviderVendors,
  getVendorTypeCircuitInfo,
  probeProviderEndpoint,
  removeProviderEndpoint,
  removeProviderVendor,
  resetVendorTypeCircuit,
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getProviderTypeConfig, getProviderTypeTranslationKey } from "@/lib/provider-type-utils";
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

        if (!vendor && vendorProviders.length === 0) return null;

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
  const tTypes = useTranslations("settings.providers.types");
  const [activeType, setActiveType] = useState<ProviderType>("claude");

  const providerTypes: ProviderType[] = ["claude", "codex", "gemini", "openai-compatible"];

  return (
    <div>
      <div className="px-6 py-3 bg-muted/10 border-b font-medium text-sm text-muted-foreground flex items-center justify-between">
        <span>{t("endpoints")}</span>
      </div>

      <div className="p-6">
        <div className="flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 bg-muted p-1 rounded-md">
              {providerTypes.map((type) => {
                const typeConfig = getProviderTypeConfig(type);
                const TypeIcon = typeConfig.icon;
                const typeKey = getProviderTypeTranslationKey(type);
                const label = tTypes(`${typeKey}.label`);
                return (
                  <Button
                    key={type}
                    variant={activeType === type ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setActiveType(type)}
                    className="h-7 text-xs capitalize"
                  >
                    <span
                      className={`mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded ${typeConfig.bgColor}`}
                    >
                      <TypeIcon className={`h-3.5 w-3.5 ${typeConfig.iconColor}`} />
                    </span>
                    {label}
                  </Button>
                );
              })}
            </div>

            <AddEndpointButton vendorId={vendorId} providerType={activeType} />
          </div>

          <VendorTypeCircuitControl vendorId={vendorId} providerType={activeType} />

          <EndpointsTable vendorId={vendorId} providerType={activeType} />
        </div>
      </div>
    </div>
  );
}

function VendorTypeCircuitControl({
  vendorId,
  providerType,
}: {
  vendorId: number;
  providerType: ProviderType;
}) {
  const t = useTranslations("settings.providers");
  const queryClient = useQueryClient();

  const { data: circuitInfo, isLoading } = useQuery({
    queryKey: ["vendor-circuit", vendorId, providerType],
    queryFn: async () => {
      const res = await getVendorTypeCircuitInfo({ vendorId, providerType });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await resetVendorTypeCircuit({ vendorId, providerType });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-circuit", vendorId, providerType] });
      toast.success(t("vendorTypeCircuitUpdated"));
    },
    onError: () => {
      toast.error(t("toggleFailed"));
    },
  });

  if (isLoading || !circuitInfo) return null;

  return (
    <div className="flex items-center justify-between bg-muted/20 p-3 rounded-md border">
      <div className="flex items-center gap-2">
        <Activity
          className={`h-4 w-4 ${circuitInfo.circuitState === "open" ? "text-destructive" : "text-green-500"}`}
        />
        <span className="text-sm font-medium">{t("vendorTypeCircuit")}</span>
        {circuitInfo.circuitState === "open" && (
          <Badge variant="destructive" className="ml-2 text-xs">
            {t("circuitBroken")}
          </Badge>
        )}
      </div>

      {circuitInfo.circuitState === "open" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending}
        >
          {resetMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("manualCircuitClose")}
        </Button>
      ) : null}
    </div>
  );
}

function EndpointsTable({
  vendorId,
  providerType,
}: {
  vendorId: number;
  providerType: ProviderType;
}) {
  const t = useTranslations("settings.providers");

  const { data: endpoints = [], isLoading } = useQuery({
    queryKey: ["provider-endpoints", vendorId, providerType],
    queryFn: async () => {
      const endpoints = await getProviderEndpoints({ vendorId, providerType });
      return endpoints;
    },
  });

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
            <TableHead>{t("columnUrl")}</TableHead>
            <TableHead>{t("status")}</TableHead>
            <TableHead className="w-[220px]">{t("latency")}</TableHead>
            <TableHead className="text-right">{t("columnActions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {endpoints.map((endpoint) => (
            <EndpointRow key={endpoint.id} endpoint={endpoint} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EndpointRow({ endpoint }: { endpoint: ProviderEndpoint }) {
  const t = useTranslations("settings.providers");
  const tCommon = useTranslations("settings.common");
  const queryClient = useQueryClient();
  const [isProbing, setIsProbing] = useState(false);

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

  return (
    <TableRow>
      <TableCell className="font-mono text-xs max-w-[200px] truncate" title={endpoint.url}>
        {endpoint.url}
        {endpoint.label && <div className="text-muted-foreground font-sans">{endpoint.label}</div>}
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

function AddEndpointButton({
  vendorId,
  providerType,
}: {
  vendorId: number;
  providerType: ProviderType;
}) {
  const t = useTranslations("settings.providers");
  const tCommon = useTranslations("settings.common");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!open) setUrl("");
  }, [open]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const endpointUrl = formData.get("url") as string;
    const label = formData.get("label") as string;

    try {
      const res = await addProviderEndpoint({
        vendorId,
        providerType,
        url: endpointUrl,
        label: label || null,
        sortOrder: 0,
        isEnabled: true,
      });

      if (res.ok) {
        toast.success(t("endpointAddSuccess"));
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: ["provider-endpoints", vendorId, providerType] });
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
          <DialogDescription>{t("addEndpointDesc", { providerType })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
            <Input id="label" name="label" placeholder={t("endpointLabelPlaceholder")} />
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
    const label = formData.get("label") as string;
    const isEnabled = formData.get("isEnabled") === "on";

    try {
      const res = await editProviderEndpoint({
        endpointId: endpoint.id,
        url,
        label: label || null,
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
          <div className="space-y-2">
            <Label htmlFor="label">{t("endpointLabelOptional")}</Label>
            <Input id="label" name="label" defaultValue={endpoint.label || ""} />
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
