"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ModelComboboxProps {
  value: string;
  onChange: (value: string) => void;
  availableModels: string[];
  existingModels?: string[];
  placeholder?: string;
  searchPlaceholder?: string;
  wildcardLabel?: string;
  getCustomLabel?: (value: string) => string;
  noResultsLabel?: string;
  disabled?: boolean;
}

export function ModelCombobox({
  value,
  onChange,
  availableModels,
  existingModels = [],
  placeholder = "",
  searchPlaceholder,
  wildcardLabel,
  getCustomLabel,
  noResultsLabel,
  disabled = false,
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const trimmedSearch = search.trim();

  const filteredModels = useMemo(() => {
    const query = trimmedSearch.toLowerCase();
    return availableModels.filter(
      (m) => m !== "*" && !existingModels.includes(m) && (!query || m.toLowerCase().includes(query))
    );
  }, [availableModels, existingModels, trimmedSearch]);

  const showWildcard =
    !existingModels.includes("*") &&
    (!trimmedSearch ||
      "*".includes(trimmedSearch) ||
      "wildcard".includes(trimmedSearch.toLowerCase()));

  const showCustom =
    trimmedSearch.length > 0 &&
    trimmedSearch !== "*" &&
    !availableModels.includes(trimmedSearch) &&
    !existingModels.includes(trimmedSearch);

  const hasContent = showWildcard || filteredModels.length > 0 || showCustom;

  const handleSelect = (selected: string) => {
    onChange(selected);
    setSearch("");
    setOpen(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setSearch("");
    setOpen(next);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between font-normal",
            !value && "text-muted-foreground"
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList>
            {!hasContent && (
              <p className="py-6 text-center text-sm text-muted-foreground">{noResultsLabel}</p>
            )}
            {(showWildcard || filteredModels.length > 0) && (
              <CommandGroup>
                {showWildcard && (
                  <CommandItem value="*" onSelect={() => handleSelect("*")}>
                    <Check
                      className={cn("mr-2 h-4 w-4", value === "*" ? "opacity-100" : "opacity-0")}
                    />
                    <span>*</span>
                    {wildcardLabel && (
                      <span className="ml-2 text-xs text-muted-foreground">{wildcardLabel}</span>
                    )}
                  </CommandItem>
                )}
                {filteredModels.map((model) => (
                  <CommandItem key={model} value={model} onSelect={() => handleSelect(model)}>
                    <Check
                      className={cn("mr-2 h-4 w-4", value === model ? "opacity-100" : "opacity-0")}
                    />
                    {model}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showCustom && (
              <CommandGroup>
                <CommandItem value={trimmedSearch} onSelect={() => handleSelect(trimmedSearch)}>
                  {getCustomLabel ? getCustomLabel(trimmedSearch) : trimmedSearch}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
