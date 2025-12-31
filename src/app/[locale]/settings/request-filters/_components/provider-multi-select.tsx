"use client";

import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { listProvidersForFilterAction } from "@/actions/request-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface ProviderMultiSelectProps {
  selectedProviderIds: number[];
  onChange: (providerIds: number[]) => void;
  disabled?: boolean;
}

export function ProviderMultiSelect({
  selectedProviderIds,
  onChange,
  disabled = false,
}: ProviderMultiSelectProps) {
  const t = useTranslations("settings.requestFilters.dialog");
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProviders() {
      setLoading(true);
      const result = await listProvidersForFilterAction();
      if (result.ok) {
        setProviders(result.data);
      }
      setLoading(false);
    }
    loadProviders();
  }, []);

  const toggleProvider = (providerId: number) => {
    if (selectedProviderIds.includes(providerId)) {
      onChange(selectedProviderIds.filter((id) => id !== providerId));
    } else {
      onChange([...selectedProviderIds, providerId]);
    }
  };

  const selectAll = () => onChange(providers.map((p) => p.id));
  const clearAll = () => onChange([]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between"
        >
          {selectedProviderIds.length === 0 ? (
            <span className="text-muted-foreground">{t("selectProviders")}</span>
          ) : (
            <div className="flex gap-2 items-center">
              <span className="truncate">
                {t("providersSelected", { count: selectedProviderIds.length })}
              </span>
              <Badge variant="secondary" className="ml-auto">
                {selectedProviderIds.length}
              </Badge>
            </div>
          )}
          {loading ? (
            <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[400px] p-0"
        align="start"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={true}>
          <CommandInput placeholder={t("searchProviders")} />
          <CommandList className="max-h-[300px] overflow-y-auto">
            <CommandEmpty>{loading ? t("loading") : t("noProvidersFound")}</CommandEmpty>

            {!loading && (
              <>
                <CommandGroup>
                  <div className="flex gap-2 p-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={selectAll}
                      className="flex-1"
                      type="button"
                    >
                      {t("selectAll")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={clearAll}
                      disabled={selectedProviderIds.length === 0}
                      className="flex-1"
                      type="button"
                    >
                      {t("clear")}
                    </Button>
                  </div>
                </CommandGroup>

                <CommandGroup>
                  {providers.map((provider) => (
                    <CommandItem
                      key={provider.id}
                      value={`${provider.name} ${provider.id}`}
                      onSelect={() => toggleProvider(provider.id)}
                      className="cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedProviderIds.includes(provider.id)}
                        className="mr-2"
                      />
                      <div className="flex-1">
                        <span className="font-medium">{provider.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          (ID: {provider.id})
                        </span>
                      </div>
                      {selectedProviderIds.includes(provider.id) && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
