"use client";

import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getDistinctProviderGroupsAction } from "@/actions/request-filters";
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

interface GroupMultiSelectProps {
  selectedGroupTags: string[];
  onChange: (groupTags: string[]) => void;
  disabled?: boolean;
}

export function GroupMultiSelect({
  selectedGroupTags,
  onChange,
  disabled = false,
}: GroupMultiSelectProps) {
  const t = useTranslations("settings.requestFilters.dialog");
  const [open, setOpen] = useState(false);
  const [groupTags, setGroupTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadGroups() {
      setLoading(true);
      const result = await getDistinctProviderGroupsAction();
      if (result.ok) {
        setGroupTags(result.data);
      }
      setLoading(false);
    }
    loadGroups();
  }, []);

  const toggleGroup = (groupTag: string) => {
    if (selectedGroupTags.includes(groupTag)) {
      onChange(selectedGroupTags.filter((tag) => tag !== groupTag));
    } else {
      onChange([...selectedGroupTags, groupTag]);
    }
  };

  const selectAll = () => onChange(groupTags);
  const clearAll = () => onChange([]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between bg-muted/50 border-border hover:bg-white/10 hover:border-white/20"
        >
          {selectedGroupTags.length === 0 ? (
            <span className="text-muted-foreground">{t("selectGroups")}</span>
          ) : (
            <div className="flex gap-2 items-center">
              <span className="truncate">
                {t("groupsSelected", { count: selectedGroupTags.length })}
              </span>
              <Badge variant="secondary" className="ml-auto bg-[#E25706]/20 text-[#E25706]">
                {selectedGroupTags.length}
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
        className="w-[400px] p-0 bg-card border-border"
        align="start"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={true} className="bg-transparent">
          <CommandInput placeholder={t("searchGroups")} className="border-border" />
          <CommandList className="max-h-[300px] overflow-y-auto">
            <CommandEmpty>{loading ? t("loading") : t("noGroupsFound")}</CommandEmpty>

            {!loading && (
              <>
                <CommandGroup>
                  <div className="flex gap-2 p-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={selectAll}
                      className="flex-1 bg-muted/50 border-border hover:bg-white/10"
                      type="button"
                    >
                      {t("selectAll")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={clearAll}
                      disabled={selectedGroupTags.length === 0}
                      className="flex-1 bg-muted/50 border-border hover:bg-white/10"
                      type="button"
                    >
                      {t("clear")}
                    </Button>
                  </div>
                </CommandGroup>

                <CommandGroup>
                  {groupTags.map((groupTag) => (
                    <CommandItem
                      key={groupTag}
                      value={groupTag}
                      onSelect={() => toggleGroup(groupTag)}
                      className="cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedGroupTags.includes(groupTag)}
                        className="mr-2 border-white/20"
                      />
                      <div className="flex-1">
                        <span className="font-mono">{groupTag}</span>
                      </div>
                      {selectedGroupTags.includes(groupTag) && (
                        <Check className="h-4 w-4 text-[#E25706]" />
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
