"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUserKeysList } from "@/lib/api-client/v1/keys/hooks";
import { useUsersList } from "@/lib/api-client/v1/users/hooks";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { Key } from "@/types/key";
import type { UsageLogFilters } from "./types";

interface IdentityFiltersProps {
  isAdmin: boolean;
  filters: UsageLogFilters;
  onFiltersChange: (filters: UsageLogFilters) => void;
  initialKeys: Key[];
  isKeysLoading?: boolean;
  onKeysChange?: (keys: Key[]) => void;
  onUsersChange?: (users: Array<{ id: number; name: string }>) => void;
}

export function IdentityFilters({
  isAdmin,
  filters,
  onFiltersChange,
  initialKeys,
  isKeysLoading: _isKeysLoading = false,
  onKeysChange,
  onUsersChange,
}: IdentityFiltersProps) {
  const t = useTranslations("dashboard");

  const [userSearchTerm, setUserSearchTerm] = useState("");
  const debouncedUserSearchTerm = useDebounce(userSearchTerm, 300);
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);

  // Use v1 users list with search term filtering server-side.
  const { data: usersResponse, isLoading: isUsersLoading } = useUsersList(
    isAdmin
      ? debouncedUserSearchTerm.trim()
        ? { searchTerm: debouncedUserSearchTerm.trim() }
        : undefined
      : { limit: 0 }
  );
  const availableUsers = useMemo(
    () => usersResponse?.items?.map((u) => ({ id: u.id, name: u.name })) ?? [],
    [usersResponse]
  );

  useEffect(() => {
    if (isAdmin) onUsersChange?.(availableUsers);
  }, [availableUsers, isAdmin, onUsersChange]);

  // Reset search term when popover closes.
  useEffect(() => {
    if (!isAdmin) return;
    if (!userPopoverOpen) {
      setUserSearchTerm("");
    }
  }, [isAdmin, userPopoverOpen]);

  const userMap = useMemo(
    () => new Map(availableUsers.map((user) => [user.id, user.name])),
    [availableUsers]
  );

  // Keys list — only fetched when a userId is selected.
  const { data: keysResponse, isLoading: isKeysLoading } = useUserKeysList(filters.userId ?? 0);
  const keys = useMemo<Key[]>(
    () => (filters.userId ? ((keysResponse?.items ?? []) as unknown as Key[]) : initialKeys),
    [keysResponse, filters.userId, initialKeys]
  );

  useEffect(() => {
    if (filters.userId) onKeysChange?.(keys);
  }, [keys, filters.userId, onKeysChange]);

  const handleUserChange = (userId: string) => {
    const newUserId = userId ? parseInt(userId, 10) : undefined;
    const newFilters = { ...filters, userId: newUserId, keyId: undefined };
    onFiltersChange(newFilters);

    if (!newUserId) {
      onKeysChange?.([]);
    }
  };

  const handleKeyChange = (value: string) => {
    onFiltersChange({
      ...filters,
      keyId: value && value !== "__all__" ? parseInt(value, 10) : undefined,
    });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* User selector (Admin only) */}
      {isAdmin && (
        <div className="space-y-2">
          <Label>{t("logs.filters.user")}</Label>
          <Popover open={userPopoverOpen} onOpenChange={setUserPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={userPopoverOpen}
                type="button"
                className="w-full justify-between"
              >
                {filters.userId ? (
                  (userMap.get(filters.userId) ?? filters.userId.toString())
                ) : (
                  <span className="text-muted-foreground">
                    {isUsersLoading ? t("logs.stats.loading") : t("logs.filters.allUsers")}
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
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder={t("logs.filters.searchUser")}
                  value={userSearchTerm}
                  onValueChange={(value) => setUserSearchTerm(value)}
                />
                <CommandList className="max-h-[250px] overflow-y-auto">
                  <CommandEmpty>
                    {isUsersLoading ? t("logs.stats.loading") : t("logs.filters.noUserFound")}
                  </CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value={t("logs.filters.allUsers")}
                      onSelect={() => {
                        handleUserChange("");
                        setUserPopoverOpen(false);
                      }}
                      className="cursor-pointer"
                    >
                      <span className="flex-1">{t("logs.filters.allUsers")}</span>
                      {!filters.userId && <Check className="h-4 w-4 text-primary" />}
                    </CommandItem>
                    {availableUsers.map((user) => (
                      <CommandItem
                        key={user.id}
                        value={user.name}
                        onSelect={() => {
                          handleUserChange(user.id.toString());
                          setUserPopoverOpen(false);
                        }}
                        className="cursor-pointer"
                      >
                        <span className="flex-1">{user.name}</span>
                        {filters.userId === user.id && <Check className="h-4 w-4 text-primary" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Key selector */}
      <div className="space-y-2">
        <Label>{t("logs.filters.apiKey")}</Label>
        <Select
          value={filters.keyId?.toString() || "__all__"}
          onValueChange={handleKeyChange}
          disabled={isKeysLoading || (isAdmin && !filters.userId && keys.length === 0)}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                isKeysLoading
                  ? t("logs.stats.loading")
                  : isAdmin && !filters.userId && keys.length === 0
                    ? t("logs.filters.selectUserFirst")
                    : t("logs.filters.allKeys")
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("logs.filters.allKeys")}</SelectItem>
            {keys.map((key) => (
              <SelectItem key={key.id} value={key.id.toString()}>
                {key.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
