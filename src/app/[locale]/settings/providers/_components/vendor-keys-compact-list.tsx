"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getProviderEndpoints } from "@/actions/provider-endpoints";
import {
  addProvider,
  editProvider,
  getUnmaskedProviderKey,
  removeProvider,
} from "@/actions/providers";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { getProviderTypeTranslationKey } from "@/lib/provider-type-utils";
import { copyToClipboard, isClipboardSupported } from "@/lib/utils/clipboard";
import type { ProviderDisplay, ProviderType } from "@/types/provider";
import type { User } from "@/types/user";

function buildKeyProviderName(input: {
  vendorWebsiteDomain: string;
  providerType: ProviderType;
  apiKey: string;
}): string {
  const keySuffix = input.apiKey.trim().slice(-4);
  const base = input.vendorWebsiteDomain.trim() || "vendor";
  const type = input.providerType;
  const suffix = keySuffix ? `-${keySuffix}` : "";
  return `${base}-${type}${suffix}`.slice(0, 64);
}

export function VendorKeysCompactList(props: {
  vendorId: number;
  vendorWebsiteDomain: string;
  vendorWebsiteUrl?: string | null;
  providers: ProviderDisplay[];
  currentUser?: User;
  enableMultiProviderTypes: boolean;
}) {
  const t = useTranslations("settings.providers");
  const tCommon = useTranslations("settings.common");
  const tForm = useTranslations("settings.providers.form");
  const tTypes = useTranslations("settings.providers.types");

  const canEdit = props.currentUser?.role === "admin";

  const [addOpen, setAddOpen] = useState(false);
  const [addKeyValue, setAddKeyValue] = useState("");
  const [addProviderType, setAddProviderType] = useState<ProviderType>(
    props.providers[0]?.providerType ?? "claude"
  );

  const queryClient = useQueryClient();

  useEffect(() => {
    if (!addOpen) {
      setAddKeyValue("");
      setAddProviderType(props.providers[0]?.providerType ?? "claude");
    }
  }, [addOpen, props.providers]);

  const { data: endpoints = [], isLoading: isEndpointsLoading } = useQuery({
    queryKey: ["provider-endpoints", props.vendorId, addProviderType],
    queryFn: async () =>
      await getProviderEndpoints({ vendorId: props.vendorId, providerType: addProviderType }),
    enabled: addOpen,
    staleTime: 30_000,
  });

  const firstEndpointUrl = useMemo(() => {
    const enabled = endpoints.find((e) => e.isEnabled);
    return (enabled ?? endpoints[0])?.url ?? null;
  }, [endpoints]);

  const addKeyMutation = useMutation({
    mutationFn: async () => {
      const apiKey = addKeyValue.trim();
      if (!apiKey) {
        throw new Error(tForm("key.placeholder"));
      }

      if (!firstEndpointUrl) {
        throw new Error(t("noEndpoints"));
      }

      const name = buildKeyProviderName({
        vendorWebsiteDomain: props.vendorWebsiteDomain,
        providerType: addProviderType,
        apiKey,
      });

      const res = await addProvider({
        name,
        url: firstEndpointUrl,
        key: apiKey,
        provider_type: addProviderType,
        website_url: props.vendorWebsiteUrl ?? null,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      if (!res.ok) {
        throw new Error(res.error || t("addVendorKeyFailed"));
      }
    },
    onSuccess: () => {
      toast.success(t("addVendorKeySuccess"));
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-vendors"] });
      setAddOpen(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("addVendorKeyFailed"));
    },
  });

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addKeyMutation.mutate();
  };

  const providerTypeItems: ProviderType[] = ["claude", "codex", "gemini", "openai-compatible"];

  return (
    <div className="border-b">
      <div className="px-6 py-1.5 bg-muted/10 font-medium text-sm text-muted-foreground flex items-center justify-between">
        <span>{t("vendorKeys")}</span>
        {canEdit && (
          <Button size="sm" className="h-7 gap-1" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t("addVendorKey")}
          </Button>
        )}
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
                <TableHead className="h-7 w-[160px]">{tForm("providerType")}</TableHead>
                <TableHead className="h-7">{tForm("key.label")}</TableHead>
                <TableHead className="h-7 w-[120px] text-right">{t("columnActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.providers.map((provider) => (
                <VendorKeyRow key={provider.id} provider={provider} canEdit={canEdit} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("addVendorKey")}</DialogTitle>
            <DialogDescription>{t("addVendorKeyDesc")}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddSubmit} className="space-y-4">
            {props.enableMultiProviderTypes && (
              <div className="space-y-2">
                <Label htmlFor="vendor-key-provider-type">{tForm("providerType")}</Label>
                <Select
                  value={addProviderType}
                  onValueChange={(value) => setAddProviderType(value as ProviderType)}
                >
                  <SelectTrigger id="vendor-key-provider-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providerTypeItems.map((type) => (
                      <SelectItem key={type} value={type}>
                        {tTypes(`${getProviderTypeTranslationKey(type)}.label`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="vendor-key-api-key">{tForm("key.label")}</Label>
              <Input
                id="vendor-key-api-key"
                value={addKeyValue}
                onChange={(e) => setAddKeyValue(e.target.value)}
                placeholder={tForm("key.placeholder")}
                disabled={addKeyMutation.isPending}
                required
              />
            </div>

            {!isEndpointsLoading && !firstEndpointUrl && (
              <div className="text-xs text-muted-foreground">{t("noEndpointsDesc")}</div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  addKeyMutation.isPending ||
                  isEndpointsLoading ||
                  !firstEndpointUrl ||
                  addKeyValue.trim().length === 0
                }
              >
                {addKeyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {tCommon("create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VendorKeyRow(props: { provider: ProviderDisplay; canEdit: boolean }) {
  const t = useTranslations("settings.providers");
  const tList = useTranslations("settings.providers.list");
  const tTypes = useTranslations("settings.providers.types");

  const queryClient = useQueryClient();

  const typeLabel = tTypes(`${getProviderTypeTranslationKey(props.provider.providerType)}.label`);

  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [unmaskedKey, setUnmaskedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clipboardAvailable, setClipboardAvailable] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

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
      <TableRow className="h-8">
        <TableCell className="py-1 text-sm font-medium">{typeLabel}</TableCell>
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
        <TableCell className="py-1 text-right">
          <div className="flex items-center justify-end gap-2">
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
                    className="h-7 w-7 text-destructive hover:text-destructive"
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
