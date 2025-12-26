"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Shield, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { VendorBundle } from "@/actions/vendors";
import { deleteVendor } from "@/actions/vendors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BalanceSection } from "./vendor-form/balance-section";
import { BasicSection } from "./vendor-form/basic-section";
import { EndpointsSection } from "./vendor-form/endpoints-section";
import { KeysSection } from "./vendor-form/keys-section";

interface VendorCardProps {
  bundle: VendorBundle;
}

export function VendorCard({ bundle }: VendorCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("vendors");
  const [open, setOpen] = useState(false);
  const [deletePending, startDeleteTransition] = useTransition();

  const vendor = bundle.vendor;

  const badges = useMemo(() => {
    const items: { key: string; label: string; variant: "default" | "secondary" | "outline" }[] =
      [];
    items.push({
      key: "category",
      label: t(`category.options.${vendor.category}`),
      variant: "outline",
    });
    items.push({
      key: "managed",
      label: vendor.isManaged ? t("status.managed") : t("status.unmanaged"),
      variant: vendor.isManaged ? "secondary" : "outline",
    });
    items.push({
      key: "enabled",
      label: vendor.isEnabled ? t("status.enabled") : t("status.disabled"),
      variant: vendor.isEnabled ? "default" : "outline",
    });
    return items;
  }, [vendor, t]);

  const onAfterMutation = async () => {
    await queryClient.invalidateQueries({ queryKey: ["vendors"] });
    await queryClient.invalidateQueries({ queryKey: ["remote-config-sync"] });
    router.refresh();
  };

  const handleDelete = () => {
    startDeleteTransition(async () => {
      const res = await deleteVendor(vendor.id);
      if (!res.ok) {
        toast.error(t("errors.deleteFailed"), { description: res.error });
        return;
      }
      toast.success(t("messages.deleteSuccess"));
      await onAfterMutation();
    });
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3 hover:bg-muted/50 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-medium text-foreground truncate">{vendor.name}</div>
            <div className="text-xs text-muted-foreground font-mono truncate">{vendor.slug}</div>
            {vendor.balanceCheckEnabled ? (
              <Badge variant="outline" className="gap-1">
                <Shield className="h-3 w-3" />
                {t("sections.balance.title")}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {badges.map((b) => (
              <Badge key={b.key} variant={b.variant} className="capitalize">
                {b.label}
              </Badge>
            ))}
            {vendor.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="font-mono">
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={deletePending}>
                <Trash2 className="h-4 w-4" />
                {t("actions.delete")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("actions.delete")}</AlertDialogTitle>
                <AlertDialogDescription>{vendor.name}</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex justify-end gap-2">
                <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>{t("actions.delete")}</AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialog>

          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {open ? t("actions.collapseAll") : t("actions.expandAll")}
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>

      <CollapsibleContent className="px-4 py-4 border-b bg-muted/10">
        <Tabs defaultValue="basic">
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="basic">{t("sections.vendorList.title")}</TabsTrigger>
            <TabsTrigger value="endpoints">{t("sections.endpoints.title")}</TabsTrigger>
            <TabsTrigger value="keys">{t("sections.keys.title")}</TabsTrigger>
            <TabsTrigger value="balance">{t("sections.balance.title")}</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="mt-4">
            <BasicSection vendor={vendor} onSaved={onAfterMutation} />
          </TabsContent>
          <TabsContent value="endpoints" className="mt-4">
            <EndpointsSection
              vendor={vendor}
              endpoints={bundle.endpoints}
              onChanged={onAfterMutation}
            />
          </TabsContent>
          <TabsContent value="keys" className="mt-4">
            <KeysSection
              vendor={vendor}
              endpoints={bundle.endpoints}
              keys={bundle.keys}
              lowThresholdUsd={vendor.balanceCheckLowThresholdUsd}
              onChanged={onAfterMutation}
            />
          </TabsContent>
          <TabsContent value="balance" className="mt-4">
            <BalanceSection vendor={vendor} onSaved={onAfterMutation} />
          </TabsContent>
        </Tabs>
      </CollapsibleContent>
    </Collapsible>
  );
}
