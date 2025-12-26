"use client";

import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { getModelPricesV2Paginated } from "@/actions/model-prices-v2";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { ModelPriceSourceV2, ModelPriceV2 } from "@/types/model-price-v2";
import { ModelSearch } from "./model-search";
import { OverrideBadge } from "./override-badge";
import { PriceEditorDialog } from "./price-editor-dialog";
import { PriceSourceFilter } from "./price-source-filter";
import { PriceSyncPanel } from "./price-sync-panel";
import { PriceTable } from "./price-table";

const PAGE_SIZE = 200;

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

function PriceManagerContent() {
  const t = useTranslations("prices-v2");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [source, setSource] = useState<ModelPriceSourceV2 | "all">("all");
  const [overridesOnly, setOverridesOnly] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ModelPriceV2 | null>(null);
  const [createModelName, setCreateModelName] = useState<string>("");

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
  } = useInfiniteQuery({
    queryKey: ["prices-v2"],
    queryFn: async ({ pageParam }) => {
      const res = await getModelPricesV2Paginated({ page: pageParam, pageSize: PAGE_SIZE });
      if (!res.ok) {
        throw new Error(res.error);
      }
      return res.data;
    },
    getNextPageParam: (lastPage) => {
      return lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined;
    },
    initialPageParam: 1,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  const allPrices = useMemo(() => data?.pages.flatMap((page) => page.data) ?? [], [data]);

  const hasFilters = Boolean(debouncedSearch.trim()) || source !== "all" || overridesOnly;

  const filteredPrices = useMemo(() => {
    let result = allPrices;

    const term = debouncedSearch.trim().toLowerCase();
    if (term) {
      result = result.filter((p) => p.modelName.toLowerCase().includes(term));
    }

    if (source !== "all") {
      result = result.filter((p) => p.source === source);
    }

    if (overridesOnly) {
      result = result.filter((p) => p.isUserOverride);
    }

    return [...result].sort((a, b) => a.modelName.localeCompare(b.modelName));
  }, [allPrices, debouncedSearch, source, overridesOnly]);

  const handleRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["prices-v2"] });
    await queryClient.invalidateQueries({ queryKey: ["remote-config-sync", "prices-override"] });
  };

  const openCreate = () => {
    setEditing(null);
    setCreateModelName("");
    setEditorOpen(true);
  };

  const openEdit = (price: ModelPriceV2) => {
    setEditing(price);
    setCreateModelName(price.modelName);
    setEditorOpen(true);
  };

  const clearFilters = () => {
    setSearch("");
    setSource("all");
    setOverridesOnly(false);
  };

  return (
    <div className="space-y-6">
      <Section title={t("sections.sync.title")} description={t("sections.sync.description")}>
        <PriceSyncPanel />
      </Section>

      <Section
        title={t("sections.table.title")}
        description={t("sections.table.description")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching}>
              <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {t("actions.refresh")}
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("actions.createOverride")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <PriceSourceFilter value={source} onChange={setSource} disabled={isLoading} />
              <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                <Checkbox
                  checked={overridesOnly}
                  onCheckedChange={(v) => setOverridesOnly(v === true)}
                  disabled={isLoading}
                  id="overridesOnly"
                />
                <label htmlFor="overridesOnly" className="text-sm text-muted-foreground">
                  {t("filters.overridesOnly")}
                </label>
                {overridesOnly ? <OverrideBadge isUserOverride /> : null}
              </div>
              <ModelSearch value={search} onChange={setSearch} disabled={isLoading} />
              {hasFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters} disabled={isLoading}>
                  <X className="h-4 w-4" />
                  {t("filters.clear")}
                </Button>
              ) : null}
            </div>

            <div className="text-xs text-muted-foreground">{t("tips.unitHint")}</div>
            <div className="text-xs text-muted-foreground">{t("tips.overrideHint")}</div>
          </div>

          {isError ? (
            <div className="text-sm text-destructive">
              {error instanceof Error ? error.message : t("errors.loadFailed")}
            </div>
          ) : null}

          <PriceTable
            prices={filteredPrices}
            loading={isLoading}
            hasFilters={hasFilters}
            hasNextPage={Boolean(hasNextPage)}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            onEdit={openEdit}
          />

          {!isLoading && allPrices.length === 0 ? (
            <div className="text-xs text-muted-foreground">{tc("noData")}</div>
          ) : null}
        </div>
      </Section>

      <PriceEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        price={editing}
        modelName={createModelName}
        onModelNameChange={setCreateModelName}
        onSaved={async () => {
          await handleRefresh();
          toast.success(t("messages.saveSuccess"));
        }}
      />
    </div>
  );
}

export function PriceManager() {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <PriceManagerContent />
    </QueryClientProvider>
  );
}
