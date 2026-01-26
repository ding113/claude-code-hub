"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getUsageLogSessionIdSuggestions } from "@/actions/usage-logs";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SESSION_ID_SUGGESTION_MIN_LEN } from "@/lib/constants/usage-logs.constants";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { ProviderDisplay } from "@/types/provider";
import { useLazyEndpoints, useLazyModels } from "../../_hooks/use-lazy-filter-options";
import type { UsageLogFilters } from "./types";

interface RequestFiltersProps {
  isAdmin: boolean;
  filters: UsageLogFilters;
  onFiltersChange: (filters: UsageLogFilters) => void;
  providers: ProviderDisplay[];
  isProvidersLoading?: boolean;
}

export function RequestFilters({
  isAdmin,
  filters,
  onFiltersChange,
  providers,
  isProvidersLoading = false,
}: RequestFiltersProps) {
  const t = useTranslations("dashboard");

  const [providerPopoverOpen, setProviderPopoverOpen] = useState(false);
  const [sessionIdPopoverOpen, setSessionIdPopoverOpen] = useState(false);
  const [isSessionIdsLoading, setIsSessionIdsLoading] = useState(false);
  const [availableSessionIds, setAvailableSessionIds] = useState<string[]>([]);
  const debouncedSessionIdSearchTerm = useDebounce(filters.sessionId ?? "", 300);
  const sessionIdSearchRequestIdRef = useRef(0);
  const lastLoadedSessionIdSuggestionsKeyRef = useRef<string | undefined>(undefined);
  const isMountedRef = useRef(true);

  const {
    data: models,
    isLoading: isModelsLoading,
    onOpenChange: onModelsOpenChange,
  } = useLazyModels();

  const {
    data: endpoints,
    isLoading: isEndpointsLoading,
    onOpenChange: onEndpointsOpenChange,
  } = useLazyEndpoints();

  const providerMap = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers]
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadSessionIdsForFilter = useCallback(
    async (term: string) => {
      const requestId = ++sessionIdSearchRequestIdRef.current;
      setIsSessionIdsLoading(true);
      const requestKey = [
        term,
        isAdmin ? (filters.userId ?? "").toString() : "",
        (filters.keyId ?? "").toString(),
        (filters.providerId ?? "").toString(),
        isAdmin ? "1" : "0",
      ].join("|");
      lastLoadedSessionIdSuggestionsKeyRef.current = requestKey;

      try {
        const result = await getUsageLogSessionIdSuggestions({
          term,
          userId: isAdmin ? filters.userId : undefined,
          keyId: filters.keyId,
          providerId: filters.providerId,
        });

        if (!isMountedRef.current || requestId !== sessionIdSearchRequestIdRef.current) return;

        if (result.ok) {
          setAvailableSessionIds(result.data);
        } else {
          console.error("Failed to load sessionId suggestions:", result.error);
          setAvailableSessionIds([]);
        }
      } catch (error) {
        if (!isMountedRef.current || requestId !== sessionIdSearchRequestIdRef.current) return;
        console.error("Failed to load sessionId suggestions:", error);
        setAvailableSessionIds([]);
      } finally {
        if (isMountedRef.current && requestId === sessionIdSearchRequestIdRef.current) {
          setIsSessionIdsLoading(false);
        }
      }
    },
    [isAdmin, filters.keyId, filters.providerId, filters.userId]
  );

  useEffect(() => {
    if (!sessionIdPopoverOpen) return;

    const term = debouncedSessionIdSearchTerm.trim();
    if (term.length < SESSION_ID_SUGGESTION_MIN_LEN) {
      setAvailableSessionIds([]);
      lastLoadedSessionIdSuggestionsKeyRef.current = undefined;
      return;
    }

    const requestKey = [
      term,
      isAdmin ? (filters.userId ?? "").toString() : "",
      (filters.keyId ?? "").toString(),
      (filters.providerId ?? "").toString(),
      isAdmin ? "1" : "0",
    ].join("|");
    if (requestKey === lastLoadedSessionIdSuggestionsKeyRef.current) return;
    void loadSessionIdsForFilter(term);
  }, [
    sessionIdPopoverOpen,
    debouncedSessionIdSearchTerm,
    isAdmin,
    filters.userId,
    filters.keyId,
    filters.providerId,
    loadSessionIdsForFilter,
  ]);

  useEffect(() => {
    if (!sessionIdPopoverOpen) {
      setAvailableSessionIds([]);
      lastLoadedSessionIdSuggestionsKeyRef.current = undefined;
    }
  }, [sessionIdPopoverOpen]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Provider selector (Admin only) */}
      {isAdmin && (
        <div className="space-y-2">
          <Label>{t("logs.filters.provider")}</Label>
          <Popover open={providerPopoverOpen} onOpenChange={setProviderPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={providerPopoverOpen}
                disabled={isProvidersLoading}
                type="button"
                className="w-full justify-between"
              >
                {filters.providerId ? (
                  (providerMap.get(filters.providerId) ?? filters.providerId.toString())
                ) : (
                  <span className="text-muted-foreground">
                    {isProvidersLoading ? t("logs.stats.loading") : t("logs.filters.allProviders")}
                  </span>
                )}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[320px] p-0"
              align="start"
              onWheel={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
            >
              <Command shouldFilter={true}>
                <CommandInput placeholder={t("logs.filters.searchProvider")} />
                <CommandList className="max-h-[250px] overflow-y-auto">
                  <CommandEmpty>
                    {isProvidersLoading
                      ? t("logs.stats.loading")
                      : t("logs.filters.noProviderFound")}
                  </CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value={t("logs.filters.allProviders")}
                      onSelect={() => {
                        onFiltersChange({
                          ...filters,
                          providerId: undefined,
                        });
                        setProviderPopoverOpen(false);
                      }}
                      className="cursor-pointer"
                    >
                      <span className="flex-1">{t("logs.filters.allProviders")}</span>
                      {!filters.providerId && <Check className="h-4 w-4 text-primary" />}
                    </CommandItem>
                    {providers.map((provider) => (
                      <CommandItem
                        key={provider.id}
                        value={provider.name}
                        onSelect={() => {
                          onFiltersChange({
                            ...filters,
                            providerId: provider.id,
                          });
                          setProviderPopoverOpen(false);
                        }}
                        className="cursor-pointer"
                      >
                        <span className="flex-1">{provider.name}</span>
                        {filters.providerId === provider.id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Model selector */}
      <div className="space-y-2">
        <Label>{t("logs.filters.model")}</Label>
        <Select
          value={filters.model || "all"}
          onValueChange={(value: string) =>
            onFiltersChange({ ...filters, model: value === "all" ? undefined : value })
          }
          onOpenChange={onModelsOpenChange}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={isModelsLoading ? t("logs.stats.loading") : t("logs.filters.allModels")}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("logs.filters.allModels")}</SelectItem>
            {models.map((model) => (
              <SelectItem key={model} value={model}>
                {model}
              </SelectItem>
            ))}
            {isModelsLoading && (
              <div className="p-2 text-center text-muted-foreground text-sm">
                {t("logs.stats.loading")}
              </div>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Endpoint selector */}
      <div className="space-y-2">
        <Label>{t("logs.filters.endpoint")}</Label>
        <Select
          value={filters.endpoint || "all"}
          onValueChange={(value: string) =>
            onFiltersChange({ ...filters, endpoint: value === "all" ? undefined : value })
          }
          onOpenChange={onEndpointsOpenChange}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                isEndpointsLoading ? t("logs.stats.loading") : t("logs.filters.allEndpoints")
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("logs.filters.allEndpoints")}</SelectItem>
            {endpoints.map((endpoint) => (
              <SelectItem key={endpoint} value={endpoint}>
                {endpoint}
              </SelectItem>
            ))}
            {isEndpointsLoading && (
              <div className="p-2 text-center text-muted-foreground text-sm">
                {t("logs.stats.loading")}
              </div>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Session ID with suggestions */}
      <div className="space-y-2">
        <Label>{t("logs.filters.sessionId")}</Label>
        <Popover open={sessionIdPopoverOpen} onOpenChange={setSessionIdPopoverOpen}>
          <PopoverAnchor asChild>
            <Input
              value={filters.sessionId ?? ""}
              placeholder={t("logs.filters.searchSessionId")}
              onFocus={() => {
                const term = (filters.sessionId ?? "").trim();
                setSessionIdPopoverOpen(term.length >= SESSION_ID_SUGGESTION_MIN_LEN);
              }}
              onChange={(e) => {
                const next = e.target.value.trim();
                onFiltersChange({ ...filters, sessionId: next || undefined });
                setSessionIdPopoverOpen(next.length >= SESSION_ID_SUGGESTION_MIN_LEN);
              }}
            />
          </PopoverAnchor>
          <PopoverContent
            className="w-[320px] p-0"
            align="start"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <Command shouldFilter={false}>
              <CommandList className="max-h-[250px] overflow-y-auto">
                <CommandEmpty>
                  {isSessionIdsLoading ? t("logs.stats.loading") : t("logs.filters.noSessionFound")}
                </CommandEmpty>
                <CommandGroup>
                  {availableSessionIds.map((sessionId) => (
                    <CommandItem
                      key={sessionId}
                      value={sessionId}
                      onSelect={() => {
                        onFiltersChange({ ...filters, sessionId });
                        setSessionIdPopoverOpen(false);
                      }}
                      className="cursor-pointer"
                    >
                      <span className="flex-1 font-mono text-xs truncate">{sessionId}</span>
                      {filters.sessionId === sessionId && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
