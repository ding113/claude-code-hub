"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { VendorBundle } from "@/actions/vendors";
import { createVendor, getVendors } from "@/actions/vendors";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import type { VendorCategory } from "@/types/vendor";
import { SyncPanel } from "./sync-panel";
import { VendorList } from "./vendor-list";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: 30000,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return makeQueryClient();
  }
  // Browser: reuse existing client
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

function VendorManagerContent() {
  const t = useTranslations("vendors");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [refreshing, startRefreshTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [createPending, startCreateTransition] = useTransition();

  const { data: bundles = [], isLoading } = useQuery<VendorBundle[]>({
    queryKey: ["vendors"],
    queryFn: getVendors,
  });

  const sortedBundles = useMemo(() => {
    return [...bundles].sort((a, b) => a.vendor.slug.localeCompare(b.vendor.slug));
  }, [bundles]);

  const handleRefresh = () => {
    startRefreshTransition(async () => {
      await queryClient.invalidateQueries({ queryKey: ["vendors"] });
      await queryClient.invalidateQueries({ queryKey: ["remote-config-sync"] });
    });
  };

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<VendorCategory>("official");
  const [tags, setTags] = useState<string[]>([]);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [faviconUrl, setFaviconUrl] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [isManaged, setIsManaged] = useState(false);

  const resetCreateForm = () => {
    setSlug("");
    setName("");
    setCategory("official");
    setTags([]);
    setWebsiteUrl("");
    setFaviconUrl("");
    setIsEnabled(true);
    setIsManaged(false);
  };

  const handleCreate = () => {
    startCreateTransition(async () => {
      const res = await createVendor({
        slug,
        name,
        category,
        tags,
        websiteUrl: websiteUrl.trim() ? websiteUrl.trim() : null,
        faviconUrl: faviconUrl.trim() ? faviconUrl.trim() : null,
        isEnabled,
        isManaged,
      });

      if (!res.ok) {
        toast.error(t("errors.saveFailed"), { description: res.error });
        return;
      }

      toast.success(t("messages.createSuccess"));
      setCreateOpen(false);
      resetCreateForm();
      await queryClient.invalidateQueries({ queryKey: ["vendors"] });
    });
  };

  return (
    <div className="space-y-6">
      <Section
        title={t("sections.sync.title")}
        description={t("sections.sync.description")}
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {t("actions.refresh")}
          </Button>
        }
      >
        <SyncPanel />
      </Section>

      <Section
        title={t("sections.vendorList.title")}
        description={t("sections.vendorList.description")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {t("actions.refresh")}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("actions.newVendor")}
            </Button>
          </div>
        }
      >
        {isLoading ? <VendorsSkeleton /> : <VendorList bundles={sortedBundles} />}
      </Section>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetCreateForm();
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("actions.newVendor")}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>{t("form.vendor.slug.label")}</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder={t("form.vendor.slug.placeholder")}
                disabled={createPending}
              />
              <p className="text-xs text-muted-foreground">{t("form.vendor.slug.help")}</p>
            </div>

            <div className="grid gap-2">
              <Label>{t("form.vendor.name.label")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("form.vendor.name.placeholder")}
                disabled={createPending}
              />
            </div>

            <div className="grid gap-2">
              <Label>{t("category.label")}</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as VendorCategory)}
                disabled={createPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("category.placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="official">{t("category.options.official")}</SelectItem>
                  <SelectItem value="relay">{t("category.options.relay")}</SelectItem>
                  <SelectItem value="self_hosted">{t("category.options.self_hosted")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>{t("form.vendor.tags.label")}</Label>
              <TagInput
                value={tags}
                onChange={setTags}
                placeholder={t("form.vendor.tags.placeholder")}
                disabled={createPending}
              />
              <p className="text-xs text-muted-foreground">{t("form.vendor.tags.help")}</p>
            </div>

            <div className="grid gap-2">
              <Label>{t("form.vendor.websiteUrl.label")}</Label>
              <Input
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder={t("form.vendor.websiteUrl.placeholder")}
                disabled={createPending}
              />
            </div>

            <div className="grid gap-2">
              <Label>{t("form.vendor.faviconUrl.label")}</Label>
              <Input
                value={faviconUrl}
                onChange={(e) => setFaviconUrl(e.target.value)}
                placeholder={t("form.vendor.faviconUrl.placeholder")}
                disabled={createPending}
              />
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">{t("form.vendor.isEnabled.label")}</div>
              </div>
              <Switch checked={isEnabled} onCheckedChange={setIsEnabled} disabled={createPending} />
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">{t("form.vendor.isManaged.label")}</div>
                <div className="text-xs text-muted-foreground">
                  {t("form.vendor.isManaged.help")}
                </div>
              </div>
              <Switch checked={isManaged} onCheckedChange={setIsManaged} disabled={createPending} />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCreateOpen(false);
                  resetCreateForm();
                }}
                disabled={createPending}
              >
                {t("actions.cancel")}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createPending || !slug.trim() || !name.trim()}
              >
                {createPending ? tc("loading") : t("actions.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function VendorManager() {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <VendorManagerContent />
    </QueryClientProvider>
  );
}

function VendorsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-24" />
          </div>
          <Skeleton className="h-9 w-full" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
