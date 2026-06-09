"use client";

import { Check, ChevronsUpDown, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
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

interface ModelMembersSelectProps {
  value: string[];
  onChange: (next: string[]) => void;
  availableModels: string[];
  placeholder?: string;
  searchPlaceholder?: string;
  noResultsLabel?: string;
  selectedLabel?: string;
  disabled?: boolean;
}

export function ModelMembersSelect({
  value,
  onChange,
  availableModels,
  placeholder = "",
  searchPlaceholder,
  noResultsLabel,
  selectedLabel,
  disabled = false,
}: ModelMembersSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const trimmedSearch = search.trim();

  const filteredModels = useMemo(() => {
    const query = trimmedSearch.toLowerCase();
    return availableModels.filter((m) => !query || m.toLowerCase().includes(query));
  }, [availableModels, trimmedSearch]);

  const showCustom =
    trimmedSearch.length > 0 &&
    !availableModels.some((m) => m.toLowerCase() === trimmedSearch.toLowerCase());

  const hasContent = filteredModels.length > 0 || showCustom;

  const toggle = (model: string) => {
    onChange(value.includes(model) ? value.filter((m) => m !== model) : [...value, model]);
    setSearch("");
  };

  const remove = (model: string) => {
    onChange(value.filter((m) => m !== model));
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setSearch("");
    setOpen(next);
  };

  const triggerText = value.length === 0 ? placeholder : (selectedLabel ?? String(value.length));

  return (
    <div className="space-y-2">
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
              value.length === 0 && "text-muted-foreground"
            )}
          >
            <span className="truncate">{triggerText}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={searchPlaceholder}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-64 overflow-y-auto">
              {!hasContent && (
                <p className="py-6 text-center text-sm text-muted-foreground">{noResultsLabel}</p>
              )}
              {filteredModels.length > 0 && (
                <CommandGroup>
                  {filteredModels.map((model) => (
                    <CommandItem key={model} value={model} onSelect={() => toggle(model)}>
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value.includes(model) ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {model}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {showCustom && (
                <CommandGroup>
                  <CommandItem value={trimmedSearch} onSelect={() => toggle(trimmedSearch)}>
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value.includes(trimmedSearch) ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {trimmedSearch}
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((model) => (
            <Badge key={model} variant="secondary" className="gap-1 pr-1 text-xs">
              {model}
              <button
                type="button"
                onClick={() => remove(model)}
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20"
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
