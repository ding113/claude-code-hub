"use client";

import { ArrowDownAZ, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface StatusToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  customSort: boolean;
  onToggleCustomSort: () => void;
  searchPlaceholder: string;
  customSortLabel: string;
  resetSortLabel: string;
  clearSearchLabel: string;
}

export function StatusToolbar({
  searchQuery,
  onSearchChange,
  customSort,
  onToggleCustomSort,
  searchPlaceholder,
  customSortLabel,
  resetSortLabel,
  clearSearchLabel,
}: StatusToolbarProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="pl-9 pr-9"
          aria-label={searchPlaceholder}
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={clearSearchLabel}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      <Button
        type="button"
        variant={customSort ? "default" : "outline"}
        size="sm"
        onClick={onToggleCustomSort}
        className={cn("gap-1.5 self-start sm:self-auto")}
      >
        <ArrowDownAZ className="size-4" />
        {customSort ? resetSortLabel : customSortLabel}
      </Button>
    </div>
  );
}
